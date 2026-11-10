import { describe, expect, it } from 'vitest'
import { PairApprovals } from '../src/approvals.ts'

describe('PairApprovals', () => {
  it('expires requests nobody answers', async () => {
    let t = 0
    const a = new PairApprovals({ ttlMs: 1000, now: () => t })
    const r = a.open('Phone', '1.1.1.1')!
    t = 1500
    await a.wait(r.id, r.secret, 10)
    expect(a.claim(r.id, r.secret)?.outcome).toEqual({ status: 'expired' })
    expect(a.pending()).toEqual([])
  })

  it('keeps one request per address and caps how many wait', () => {
    const a = new PairApprovals({ maxPending: 2 })
    a.open('A', '1.1.1.1')
    a.open('A again', '1.1.1.1')
    expect(a.pending().map((p) => p.name)).toEqual(['A again'])
    expect(a.open('B', '2.2.2.2')).toBeDefined()
    expect(a.open('C', '3.3.3.3')).toBeUndefined()
  })
})
