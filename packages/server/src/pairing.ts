import { randomInt, timingSafeEqual } from 'node:crypto'

export interface PairingOptions {
  /** How long a code stays valid. */
  codeTtlMs?: number
  /** Failed attempts allowed per IP inside `windowMs`. */
  maxFailuresPerIp?: number
  windowMs?: number
  /** Failed attempts from all IPs before the code is replaced, so it cannot be brute-forced in parallel. */
  maxFailuresPerCode?: number
  now?: () => number
}

export interface PairingCode {
  code: string
  expiresAt: number
}

export type AttemptResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-code' }
  | { ok: false; reason: 'rate-limited'; retryAfterMs: number }

export class PairingCodes {
  private current!: PairingCode
  private failuresOnCode = 0
  private failuresByIp = new Map<string, number[]>()
  private listeners = new Set<(code: PairingCode) => void>()
  private readonly ttl: number
  private readonly maxPerIp: number
  private readonly window: number
  private readonly maxPerCode: number
  private readonly now: () => number

  constructor(opts: PairingOptions = {}) {
    this.ttl = opts.codeTtlMs ?? 5 * 60_000
    this.maxPerIp = opts.maxFailuresPerIp ?? 5
    this.window = opts.windowMs ?? 10 * 60_000
    this.maxPerCode = opts.maxFailuresPerCode ?? 20
    this.now = opts.now ?? Date.now
    this.rotate()
  }

  /** The code to show on the desktop. Rotates automatically once expired. */
  get(): PairingCode {
    if (this.now() >= this.current.expiresAt) this.rotate()
    return this.current
  }

  rotate() {
    this.current = {
      code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
      expiresAt: this.now() + this.ttl,
    }
    this.failuresOnCode = 0
    this.listeners.forEach((l) => l(this.current))
  }

  attempt(ip: string, code: string): AttemptResult {
    const now = this.now()
    const recent = (this.failuresByIp.get(ip) ?? []).filter((t) => now - t < this.window)
    if (recent.length >= this.maxPerIp) {
      const oldest = recent[0] ?? now
      return { ok: false, reason: 'rate-limited', retryAfterMs: oldest + this.window - now }
    }

    const expected = Buffer.from(this.get().code)
    const given = Buffer.from(code.padEnd(expected.length).slice(0, expected.length))
    if (timingSafeEqual(expected, given)) {
      this.failuresByIp.delete(ip)
      this.rotate()
      return { ok: true }
    }

    recent.push(now)
    this.failuresByIp.set(ip, recent)
    if (++this.failuresOnCode >= this.maxPerCode) this.rotate()
    return { ok: false, reason: 'wrong-code' }
  }

  onChange(listener: (code: PairingCode) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
