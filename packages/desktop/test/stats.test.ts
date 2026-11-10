import { describe, expect, it } from 'vitest'
import {
  createStats,
  gpuSampler,
  parseIoregGpu,
  parseNvidiaSmi,
  parseNetstatE,
  parseNetstatIb,
  parseVmStat,
} from '../src/main/platform/stats.ts'
import { History } from '../src/main/history.ts'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

describe('system stats', () => {
  it('reads sane numbers', async () => {
    const stats = createStats()
    await stats()
    const s = await stats()
    for (const k of ['cpu', 'memory', 'disk'] as const) {
      expect(s[k]).toBeGreaterThanOrEqual(0)
      expect(s[k]).toBeLessThanOrEqual(100)
    }
    expect(s.memoryTotalGb).toBeGreaterThan(0)
  })

  it('counts macOS memory like Activity Monitor', () => {
    const text = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    75305.
Pages wired down:                             100.
Pages purgeable:                               10.
Anonymous pages:                              300.
Pages occupied by compressor:                 50.`
    expect(parseVmStat(text)).toBe((300 - 10 + 100 + 50) * 16384)
  })

  it('parses network counters', () => {
    const ib = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                         10     0       5000       10     0       5000     0
en0        1500  <Link#6>    aa:bb:cc:dd:ee:ff   100     0      20000      50     0       3000     0
en0        1500  192.168.1     192.168.1.5        100     -      20000      50     -       3000     -`
    expect(parseNetstatIb(ib)).toEqual({ rx: 20000, tx: 3000 })
    expect(
      parseNetstatE('Interface Statistics\n\n   Received  Sent\nBytes   12345   678\n'),
    ).toEqual({
      rx: 12345,
      tx: 678,
    })
  })
})

describe('graphics card', () => {
  it('reads Apple and Intel GPUs from ioreg', () => {
    const text = `| "PerformanceStatistics" = {"In use system memory"=361103360,"Renderer Utilization %"=10,"Device Utilization %"=12}`
    const r = parseIoregGpu(text)
    expect(r?.gpu).toBe(12)
    expect(r?.gpuMemoryUsedGb).toBeCloseTo(0.336, 2)
    expect(r?.gpuMemory).toBeUndefined()
    expect(parseIoregGpu('nothing here')).toBeUndefined()
  })

  it('reads the busiest NVIDIA card', () => {
    const r = parseNvidiaSmi('12, 1024, 8192, 51\n87, 4096, 8192, 74\n')
    expect(r).toEqual({ gpu: 87, gpuMemory: 50, gpuMemoryUsedGb: 4, gpuTemp: 74 })
    // Some cards report [N/A] for temperature.
    expect(parseNvidiaSmi('5, 512, 2048, [N/A]')).toEqual({
      gpu: 5,
      gpuMemory: 25,
      gpuMemoryUsedGb: 0.5,
    })
    expect(parseNvidiaSmi('')).toBeUndefined()
  })

  it('reads in the background and gives up on computers with nothing to read', async () => {
    let calls = 0
    const slow = gpuSampler(async () => {
      calls++
      return { gpu: calls * 10 }
    }, 0)
    expect(await slow()).toEqual({ gpu: 10 })
    // Later calls answer at once with the last reading while a new one is taken.
    expect(await slow()).toEqual({ gpu: 10 })
    await new Promise((r) => setTimeout(r, 0))
    expect(await slow()).toEqual({ gpu: 20 })

    let asked = 0
    const none = gpuSampler(async () => {
      asked++
      return undefined
    }, 0)
    for (let i = 0; i < 6; i++) {
      await none()
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(asked).toBe(3)
  })

  it('leaves GPU readings out when there are none', async () => {
    const s = await createStats(process.platform, async () => undefined)()
    expect(s.gpu).toBeUndefined()
    const t = await createStats(process.platform, async () => ({ gpu: 40, gpuTemp: 60 }))()
    expect(t.gpu).toBe(40)
    expect(t.gpuTemp).toBe(60)
  })
})

describe('chart history', () => {
  it('drops the oldest points past the time limit and pages backwards', async () => {
    let now = 0
    const h = new History(
      join(await mkdtemp(join(tmpdir(), 'hist-')), 'h.json'),
      () => 5,
      () => now,
    )
    for (let i = 0; i < 10; i++) {
      now = i * 60_000
      h.record('t', i)
    }
    // 5 minutes kept at minute 9: minutes 4 to 9.
    expect(h.page('t').points.map((p) => p[1])).toEqual([4, 5, 6, 7, 8, 9])
    const older = h.page('t', 7 * 60_000, 2)
    expect(older).toEqual({
      points: [
        [300_000, 5],
        [360_000, 6],
      ],
      more: true,
    })
    await h.flush()
    const again = new History(
      h['file'],
      () => 5,
      () => now,
    )
    await again.load()
    expect(again.recent('t', 2)).toEqual([8, 9])
    h.dispose()
  })
})
