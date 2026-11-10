import { describe, expect, it } from 'vitest'
import {
  createStats,
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
