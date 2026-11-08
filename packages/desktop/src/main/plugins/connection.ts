import {
  isRequest,
  isResponse,
  type HostMethods,
  type Message,
  type Notification,
  type Request,
} from '@tessel/plugin-sdk/protocol'
import type { PluginProcess } from './process.ts'

const DEFAULT_TIMEOUT_MS = 10_000

export class PluginCallError extends Error {}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer?: ReturnType<typeof setTimeout>
}

/** Request/response over a plugin process, with per-call timeouts. */
export class PluginConnection {
  private pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false
  private proc: PluginProcess

  constructor(
    proc: PluginProcess,
    handlers: {
      onNotification(n: Notification): void
      onRequest(method: string, params: unknown): Promise<unknown>
    },
  ) {
    this.proc = proc
    proc.onMessage((m: Message) => {
      if (isResponse(m)) {
        const waiter = this.pending.get(m.id)
        if (!waiter) return
        this.pending.delete(m.id)
        clearTimeout(waiter.timer)
        if ('error' in m) waiter.reject(new PluginCallError(m.error.message))
        else waiter.resolve(m.result)
      } else if (isRequest(m)) {
        const req = m as Request
        handlers.onRequest(req.method, req.params).then(
          (result) => proc.send({ id: req.id, result: result ?? null }),
          (err: Error) => proc.send({ id: req.id, error: { message: err.message } }),
        )
      } else {
        handlers.onNotification(m)
      }
    })
  }

  call<M extends keyof HostMethods>(
    method: M,
    params: HostMethods[M]['params'],
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<HostMethods[M]['result']> {
    if (this.closed) return Promise.reject(new PluginCallError('The plugin is not running'))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const pending: Pending = { resolve: resolve as (v: unknown) => void, reject }
      if (opts.timeoutMs !== 0) {
        const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
        pending.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new PluginCallError(`The plugin didn't answer within ${Math.round(ms / 1000)} s`))
        }, ms)
      }
      opts.signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return
          clearTimeout(pending.timer)
          reject(
            opts.signal?.reason instanceof Error
              ? opts.signal.reason
              : new PluginCallError('Stopped'),
          )
        },
        { once: true },
      )
      this.pending.set(id, pending)
      this.proc.send({ id, method, params })
    })
  }

  /** The process ended: fail everything still waiting. */
  close(reason: string) {
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new PluginCallError(reason))
    }
    this.pending.clear()
  }
}
