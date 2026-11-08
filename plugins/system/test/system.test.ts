import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createSystemPlugin } from '../src/plugin.ts'

describe('system plugin', () => {
  it('reports system info', async () => {
    const h = createHarness(
      createSystemPlugin({
        cpu: () => 12.34,
        memory: () => ({ usedPercent: 50, freeGb: 7.96 }),
        uptimeMinutes: () => 90.4,
      }),
    )
    expect(await h.run('info', {})).toEqual({
      values: { cpu: 12.3, memory: 50, freeGb: 8, uptime: 90 },
    })
  })

  it('fires when CPU crosses the threshold, once per crossing', async () => {
    vi.useFakeTimers()
    const readings = [0, 50, 90, 95, 40, 85]
    const h = createHarness(
      createSystemPlugin({
        cpu: () => readings.shift() ?? 0,
        memory: () => ({ usedPercent: 0, freeGb: 0 }),
        uptimeMinutes: () => 0,
      }),
      { settings: { checkSeconds: 1 } },
    )
    await h.load()
    const sub = h.subscribe('highCpu', { threshold: 80 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(sub.events).toEqual([{ cpu: 90 }, { cpu: 85 }])
    sub.stop()
    vi.useRealTimers()
  })
})
