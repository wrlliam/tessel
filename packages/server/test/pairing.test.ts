import { describe, expect, it } from 'vitest'
import { PairingCodes } from '../src/pairing.ts'

function clock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

describe('pairing codes', () => {
  it('issues 6-digit codes', () => {
    expect(new PairingCodes().get().code).toMatch(/^\d{6}$/)
  })

  it('accepts the right code once, then rotates', () => {
    const p = new PairingCodes()
    const { code } = p.get()
    expect(p.attempt('1.1.1.1', code)).toEqual({ ok: true })
    expect(p.get().code === code && p.attempt('1.1.1.1', code).ok).toBe(false)
  })

  it('rejects a wrong code', () => {
    const p = new PairingCodes()
    expect(p.attempt('1.1.1.1', wrong(p.get().code))).toEqual({ ok: false, reason: 'wrong-code' })
  })

  it('rate-limits an IP after repeated failures, then lets it try again later', () => {
    const c = clock()
    const p = new PairingCodes({
      now: c.now,
      maxFailuresPerIp: 3,
      windowMs: 60_000,
      codeTtlMs: 1e9,
    })
    const bad = wrong(p.get().code)
    for (let i = 0; i < 3; i++) p.attempt('2.2.2.2', bad)
    const limited = p.attempt('2.2.2.2', p.get().code)
    expect(limited).toMatchObject({ ok: false, reason: 'rate-limited' })
    expect(p.attempt('3.3.3.3', p.get().code).ok).toBe(true)
    c.advance(60_000)
    expect(p.attempt('2.2.2.2', p.get().code).ok).toBe(true)
  })

  it('rotates the code after too many failures across all IPs', () => {
    const p = new PairingCodes({ maxFailuresPerCode: 4 })
    const first = p.get().code
    for (let i = 0; i < 4; i++) p.attempt(`10.0.0.${i}`, wrong(first))
    expect(p.get().code).not.toBe(first)
  })

  it('expires codes', () => {
    const c = clock()
    const p = new PairingCodes({ now: c.now, codeTtlMs: 1000 })
    const seen: string[] = []
    p.onChange((code) => seen.push(code.code))
    const first = p.get().code
    c.advance(1000)
    expect(p.get().code).not.toBe(first)
    expect(seen).toHaveLength(1)
  })
})
