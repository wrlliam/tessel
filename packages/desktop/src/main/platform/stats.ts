// CPU, memory, disk and network for the System stats block. Each reading is compared with the
// one before, so CPU and network are "since last time", like a task manager.
import type { SystemStats } from '@tessel/core'
import { execFile } from 'node:child_process'
import { readdir, readFile, statfs } from 'node:fs/promises'
import { cpus, freemem, homedir, totalmem, uptime } from 'node:os'
import { parse } from 'node:path'
import { windowsGpuReader } from './windows-gpu.ts'

type Bytes = { rx: number; tx: number }

const run = (cmd: string, args: string[], timeout = 3000) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => resolve(err ? '' : out)),
  )

/** What we could learn about the graphics card. Anything unknown is left out. */
export interface GpuReading {
  /** Busy, 0 to 100. */
  gpu?: number
  /** Graphics memory in use, 0 to 100. */
  gpuMemory?: number
  gpuMemoryUsedGb?: number
  /** Degrees Celsius. */
  gpuTemp?: number
}

/** `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu`: the busiest card. */
export function parseNvidiaSmi(text: string): GpuReading | undefined {
  let best: GpuReading | undefined
  for (const line of text.trim().split('\n')) {
    // Blank fields and "[N/A]" become NaN, not 0.
    const [util, used, total, temp] = line
      .split(',')
      .map((x) => (x.trim() === '' ? NaN : Number(x.trim())))
    if (util === undefined || !Number.isFinite(util)) continue
    const r: GpuReading = { gpu: util }
    if (used !== undefined && total !== undefined && Number.isFinite(used) && total > 0) {
      r.gpuMemory = (used / total) * 100
      r.gpuMemoryUsedGb = used / 1024
    }
    if (temp !== undefined && Number.isFinite(temp)) r.gpuTemp = temp
    if (!best || util > (best.gpu ?? -1)) best = r
  }
  return best
}

/** macOS `ioreg -c IOAccelerator`: Apple and Intel GPUs report "Device Utilization %". */
export function parseIoregGpu(text: string): GpuReading | undefined {
  const utils = [...text.matchAll(/"Device Utilization %"=(\d+)/g)].map((m) => Number(m[1]))
  if (utils.length === 0) return undefined
  const mem = [...text.matchAll(/"In use system memory"=(\d+)/g)].map((m) => Number(m[1]))
  const r: GpuReading = { gpu: Math.max(...utils) }
  if (mem.length > 0) r.gpuMemoryUsedGb = mem.reduce((a, b) => a + b, 0) / 1024 ** 3
  return r
}

/** Linux AMD and Intel cards: busy %, VRAM and temperature from sysfs. */
async function sysfsGpu(): Promise<GpuReading | undefined> {
  const cards = (await readdir('/sys/class/drm').catch(() => [] as string[])).filter((c) =>
    /^card\d+$/.test(c),
  )
  const num = async (path: string) => {
    const text = (await readFile(path, 'utf8').catch(() => '')).trim()
    const n = Number(text)
    return text && Number.isFinite(n) ? n : undefined
  }
  for (const card of cards) {
    const dev = `/sys/class/drm/${card}/device`
    const busy = await num(`${dev}/gpu_busy_percent`)
    if (busy === undefined) continue
    const r: GpuReading = { gpu: busy }
    const used = await num(`${dev}/mem_info_vram_used`)
    const total = await num(`${dev}/mem_info_vram_total`)
    if (used !== undefined && total) {
      r.gpuMemory = (used / total) * 100
      r.gpuMemoryUsedGb = used / 1024 ** 3
    }
    const hwmon = (await readdir(`${dev}/hwmon`).catch(() => [] as string[]))[0]
    const milli = hwmon ? await num(`${dev}/hwmon/${hwmon}/temp1_input`) : undefined
    if (milli !== undefined) r.gpuTemp = milli / 1000
    return r
  }
  return undefined
}

const NVIDIA_QUERY = [
  '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu',
  '--format=csv,noheader,nounits',
]
let windowsGpu: (() => Promise<GpuReading | undefined>) | undefined

/** Fills the gaps in one reading from another, e.g. nvidia-smi's numbers with the driver's temperature. */
export function mergeGpu(
  primary: GpuReading | undefined,
  extra: GpuReading | undefined,
): GpuReading | undefined {
  if (!primary) return extra
  if (!extra) return primary
  const out: GpuReading = { ...extra }
  for (const [k, v] of Object.entries(primary) as Array<[keyof GpuReading, number | undefined]>)
    if (v !== undefined) out[k] = v
  return out
}

/** One reading from whatever this computer offers; undefined when there's no way to tell. */
export async function readGpu(os: NodeJS.Platform): Promise<GpuReading | undefined> {
  if (os === 'darwin')
    return parseIoregGpu(await run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']))
  const nvidia = parseNvidiaSmi(await run('nvidia-smi', NVIDIA_QUERY))
  if (os === 'linux') return nvidia ?? (await sysfsGpu())
  if (os === 'win32') {
    // Any card (AMD, Intel, NVIDIA): use, memory and temperature from Windows itself.
    windowsGpu ??= windowsGpuReader()
    return mergeGpu(nvidia, await windowsGpu())
  }
  return nvidia
}

/**
 * Keeps the latest GPU reading fresh in the background, so a slow tool (PowerShell can take a
 * second or two) never holds up a stats tick. Gives up asking after a few empty answers.
 */
export function gpuSampler(read: () => Promise<GpuReading | undefined>, everyMs = 1000) {
  let last: GpuReading | undefined
  let at = 0
  let inFlight: Promise<void> | undefined
  let misses = 0
  const refresh = () =>
    (inFlight ??= read()
      .then((r) => {
        last = r
        misses = r ? 0 : misses + 1
      })
      .catch(() => {
        misses++
      })
      .finally(() => {
        at = Date.now()
        inFlight = undefined
      }))
  return async (): Promise<GpuReading | undefined> => {
    if (misses >= 3) return undefined
    if (at === 0) await refresh()
    else if (Date.now() - at >= everyMs) void refresh()
    return last
  }
}

/** Total bytes received and sent on every network interface except loopback. */
export async function networkBytes(os: NodeJS.Platform): Promise<Bytes | undefined> {
  if (os === 'linux') {
    const text = await readFile('/proc/net/dev', 'utf8').catch(() => '')
    let rx = 0
    let tx = 0
    for (const line of text.split('\n').slice(2)) {
      const [name, rest] = line.split(':')
      if (!rest || name?.trim() === 'lo') continue
      const f = rest.trim().split(/\s+/).map(Number)
      rx += f[0] ?? 0
      tx += f[8] ?? 0
    }
    return text ? { rx, tx } : undefined
  }
  if (os === 'darwin') return parseNetstatIb(await run('netstat', ['-ibn']))
  if (os === 'win32') return parseNetstatE(await run('netstat', ['-e']))
  return undefined
}

/** macOS `netstat -ib`: one <Link#> row per interface carries its byte counters. */
export function parseNetstatIb(text: string): Bytes | undefined {
  const lines = text.trim().split('\n')
  const head = lines[0]?.trim().split(/\s+/) ?? []
  const iIn = head.indexOf('Ibytes')
  const iOut = head.indexOf('Obytes')
  if (iIn < 0 || iOut < 0) return undefined
  let rx = 0
  let tx = 0
  for (const line of lines.slice(1)) {
    const f = line.trim().split(/\s+/)
    if (!f[2]?.startsWith('<Link#') || f[0]?.startsWith('lo')) continue
    // Rows without an address have one column fewer; count from the end instead.
    const shift = f.length - head.length
    rx += Number(f[iIn + shift]) || 0
    tx += Number(f[iOut + shift]) || 0
  }
  return { rx, tx }
}

/** Windows `netstat -e`: "Bytes  <received>  <sent>". */
export function parseNetstatE(text: string): Bytes | undefined {
  const m = /^\s*Bytes\s+(\d+)\s+(\d+)/m.exec(text)
  return m ? { rx: Number(m[1]), tx: Number(m[2]) } : undefined
}

/**
 * macOS `vm_stat`: memory in use the way Activity Monitor counts it (app memory, wired and
 * compressed), since the OS keeps "free" memory near zero by filling it with file cache.
 */
export function parseVmStat(text: string): number | undefined {
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1])
  const get = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(text)?.[1] ?? NaN)
  const used =
    get('Anonymous pages') -
    get('Pages purgeable') +
    get('Pages wired down') +
    get('Pages occupied by compressor')
  return Number.isFinite(size) && Number.isFinite(used) ? used * size : undefined
}

async function memoryAvailable(os: NodeJS.Platform): Promise<number> {
  // Linux counts its file cache as used; MemAvailable is what apps can still get.
  if (os === 'linux') {
    const m = /MemAvailable:\s+(\d+) kB/.exec(
      await readFile('/proc/meminfo', 'utf8').catch(() => ''),
    )
    if (m) return Number(m[1]) * 1024
  }
  if (os === 'darwin') {
    const used = parseVmStat(await run('vm_stat', []))
    if (used !== undefined) return Math.max(0, totalmem() - used)
  }
  return freemem()
}

const cpuTimes = () =>
  cpus().reduce(
    (acc, c) => {
      const t = c.times
      acc.idle += t.idle
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq
      return acc
    },
    { idle: 0, total: 0 },
  )

export function createStats(
  os: NodeJS.Platform = process.platform,
  gpu: () => Promise<GpuReading | undefined> = gpuSampler(() => readGpu(os)),
) {
  let lastCpu = cpuTimes()
  let lastNet: { at: number; bytes: Bytes } | undefined
  const gb = (n: number) => n / 1024 ** 3

  return async function systemStats(): Promise<SystemStats> {
    const cpu = cpuTimes()
    const dTotal = cpu.total - lastCpu.total
    const busy = dTotal > 0 ? (1 - (cpu.idle - lastCpu.idle) / dTotal) * 100 : 0
    lastCpu = cpu

    const total = totalmem()
    const free = await memoryAvailable(os)

    let disk = 0
    let diskFreeGb = 0
    try {
      const fs = await statfs(parse(homedir()).root || '/')
      const size = fs.blocks * fs.bsize
      diskFreeGb = gb(fs.bavail * fs.bsize)
      disk = size > 0 ? (1 - (fs.bavail * fs.bsize) / size) * 100 : 0
    } catch {
      // Unknown disk; leave at 0.
    }

    let downKbps = 0
    let upKbps = 0
    const bytes = await networkBytes(os)
    const at = Date.now()
    if (bytes && lastNet) {
      const secs = (at - lastNet.at) / 1000
      if (secs > 0) {
        downKbps = Math.max(0, (bytes.rx - lastNet.bytes.rx) / 1024 / secs)
        upKbps = Math.max(0, (bytes.tx - lastNet.bytes.tx) / 1024 / secs)
      }
    }
    if (bytes) lastNet = { at, bytes }
    const g = await gpu()

    return {
      ...g,
      cpu: Math.min(100, Math.max(0, busy)),
      memory: total > 0 ? ((total - free) / total) * 100 : 0,
      memoryUsedGb: gb(total - free),
      memoryTotalGb: gb(total),
      disk,
      diskFreeGb,
      downKbps,
      upKbps,
      uptimeHours: uptime() / 3600,
    }
  }
}
