// CPU, memory, disk and network for the System stats block. Each reading is compared with the
// one before, so CPU and network are "since last time", like a task manager.
import type { SystemStats } from '@tessel/core'
import { execFile } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { cpus, freemem, homedir, totalmem, uptime } from 'node:os'
import { parse } from 'node:path'

type Bytes = { rx: number; tx: number }

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout: 3000, windowsHide: true }, (err, out) =>
      resolve(err ? '' : out),
    ),
  )

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

export function createStats(os: NodeJS.Platform = process.platform) {
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

    return {
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
