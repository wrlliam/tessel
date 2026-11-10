import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

/** A phone that entered the right code and is waiting for someone at the computer to say yes. */
export interface PairApproval {
  id: string
  name: string
  ip: string
  requestedAt: number
  expiresAt: number
  /** The paired phone this one will replace once approved, e.g. the same phone pairing again. */
  replaces?: { id: string; name: string }
}

export type ApprovalOutcome =
  { status: 'pending' } | { status: 'approved' } | { status: 'denied' } | { status: 'expired' }

interface Entry {
  info: PairApproval
  secret: Buffer
  outcome: ApprovalOutcome
  waiters: Set<() => void>
}

export interface ApprovalOptions {
  /** How long a request waits for an answer. */
  ttlMs?: number
  /** Requests waiting at once, across all phones. Extra ones are refused. */
  maxPending?: number
  now?: () => number
}

/**
 * Pairing needs two things: the code from the screen, and a click on Approve at the computer.
 * The code alone (or a leaked link with it) is never enough to get in.
 */
export class PairApprovals {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private readonly ttl: number
  private readonly max: number
  private readonly now: () => number

  constructor(opts: ApprovalOptions = {}) {
    this.ttl = opts.ttlMs ?? 2 * 60_000
    this.max = opts.maxPending ?? 3
    this.now = opts.now ?? Date.now
  }

  /** Requests still waiting, oldest first. */
  pending(): PairApproval[] {
    this.sweep()
    return [...this.entries.values()]
      .filter((e) => e.outcome.status === 'pending')
      .map((e) => e.info)
  }

  /** Opens a request. Returns undefined when too many are already waiting. */
  open(
    name: string,
    ip: string,
    replaces?: { id: string; name: string },
  ): { id: string; secret: string } | undefined {
    this.sweep()
    // One waiting request per address: asking again replaces the earlier one.
    for (const e of this.entries.values())
      if (e.info.ip === ip && e.outcome.status === 'pending') this.settle(e, { status: 'expired' })
    if (this.pending().length >= this.max) return undefined
    const secret = randomBytes(32)
    const now = this.now()
    const info: PairApproval = {
      id: randomUUID(),
      name,
      ip,
      requestedAt: now,
      expiresAt: now + this.ttl,
      ...(replaces ? { replaces } : {}),
    }
    this.entries.set(info.id, { info, secret, outcome: { status: 'pending' }, waiters: new Set() })
    this.changed()
    return { id: info.id, secret: secret.toString('base64url') }
  }

  /** The request, if `secret` is the one handed to the phone that opened it. */
  private check(id: string, secret: string): Entry | undefined {
    const e = this.entries.get(id)
    if (!e) return undefined
    const given = Buffer.from(secret, 'base64url')
    if (given.length !== e.secret.length || !timingSafeEqual(given, e.secret)) return undefined
    return e
  }

  /** Waits up to `ms` for an answer to the request. */
  async wait(id: string, secret: string, ms: number): Promise<void> {
    this.sweep()
    const e = this.check(id, secret)
    if (!e) return
    if (e.outcome.status === 'pending') {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          e.waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, Math.min(ms, Math.max(0, e.info.expiresAt - this.now())))
        e.waiters.add(done)
      })
      this.sweep()
    }
  }

  /**
   * The answer for the phone holding `secret`. A final answer is handed out once, then the request
   * is forgotten, so the secret can't be replayed for a second token.
   */
  claim(id: string, secret: string): { outcome: ApprovalOutcome; info: PairApproval } | undefined {
    const e = this.check(id, secret)
    if (!e) return undefined
    if (e.outcome.status !== 'pending') this.entries.delete(id)
    return { outcome: e.outcome, info: e.info }
  }

  approve(id: string): PairApproval | undefined {
    const e = this.entries.get(id)
    if (!e || e.outcome.status !== 'pending') return undefined
    this.settle(e, { status: 'approved' })
    return e.info
  }

  deny(id: string): boolean {
    const e = this.entries.get(id)
    if (!e || e.outcome.status !== 'pending') return false
    this.settle(e, { status: 'denied' })
    return true
  }

  /** Refuses everything waiting, e.g. when sharing stops. */
  clear() {
    for (const e of this.entries.values())
      if (e.outcome.status === 'pending') e.outcome = { status: 'denied' }
    for (const e of this.entries.values()) e.waiters.forEach((w) => w())
    this.entries.clear()
    this.changed()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private settle(e: Entry, outcome: ApprovalOutcome) {
    e.outcome = outcome
    e.waiters.forEach((w) => w())
    this.changed()
  }

  private sweep() {
    const now = this.now()
    for (const [id, e] of this.entries) {
      if (e.outcome.status === 'pending' && now >= e.info.expiresAt) {
        this.settle(e, { status: 'expired' })
      }
      // Answers nobody collected are dropped after a while.
      if (e.outcome.status !== 'pending' && now >= e.info.expiresAt + 60_000)
        this.entries.delete(id)
    }
  }

  private changed() {
    this.listeners.forEach((l) => l())
  }
}
