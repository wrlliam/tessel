import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scheduler } from '../src/main/scheduler.ts'

afterEach(() => vi.useRealTimers())

describe('Scheduler', () => {
  it('fires each trigger at its time and skips bad patterns', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 9, 8, 59, 0) })
    const fired: string[] = []
    const s = new Scheduler((t) => fired.push(t.nodeId))
    s.set([
      { tileId: 't', nodeId: 'nine', pattern: '0 9 * * *' },
      { tileId: 't', nodeId: 'bad', pattern: 'nope' },
    ])
    expect(s.size).toBe(1)
    vi.advanceTimersByTime(61_000)
    expect(fired).toEqual(['nine'])
    s.stop()
  })

  it('replaces jobs on set and stops cleanly', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 9, 8, 59, 0) })
    const fired: string[] = []
    const s = new Scheduler((t) => fired.push(t.nodeId))
    s.set([{ tileId: 't', nodeId: 'old', pattern: '0 9 * * *' }])
    s.set([{ tileId: 't', nodeId: 'new', pattern: '0 9 * * *' }])
    s.stop()
    vi.advanceTimersByTime(61_000)
    expect(fired).toEqual([])
  })
})
