// A small obs-websocket v5 client: connect, authenticate, send requests and hear events.
import { createHash, randomUUID } from 'node:crypto'

export interface ObsSocket {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: ((e: unknown) => void) | null
}
export type OpenSocket = (url: string) => ObsSocket

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 }
/** Scenes, outputs and inputs events. */
const EVENTS = (1 << 2) | (1 << 6) | (1 << 3)

export function authString(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256')
    .update(password + salt)
    .digest('base64')
  return createHash('sha256')
    .update(secret + challenge)
    .digest('base64')
}

export class ObsClient {
  private socket?: ObsSocket
  private ready?: Promise<void>
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private listeners = new Set<(type: string, data: Record<string, unknown>) => void>()

  constructor(
    private open: OpenSocket,
    private opts: () => { host: string; port: number; password: string },
  ) {}

  onEvent(listener: (type: string, data: Record<string, unknown>) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.socket?.close()
    this.socket = undefined
    this.ready = undefined
  }

  connect(): Promise<void> {
    if (this.ready) return this.ready
    const { host, port, password } = this.opts()
    this.ready = new Promise<void>((resolve, reject) => {
      const socket = this.open(`ws://${host}:${port}`)
      this.socket = socket
      const fail = (message: string) => {
        this.ready = undefined
        this.socket = undefined
        reject(new Error(message))
      }
      const timer = setTimeout(() => {
        socket.close()
        fail(`OBS didn't answer at ${host}:${port}. Is OBS open with its WebSocket server on?`)
      }, 5000)
      socket.onerror = () => {
        clearTimeout(timer)
        fail(
          `Can't reach OBS at ${host}:${port}. Open OBS and turn on Tools › WebSocket Server Settings.`,
        )
      }
      socket.onclose = () => {
        clearTimeout(timer)
        for (const p of this.pending.values()) p.reject(new Error('OBS closed the connection'))
        this.pending.clear()
        if (this.socket === socket) {
          this.socket = undefined
          this.ready = undefined
        }
        fail('OBS closed the connection. Check the password in the plugin settings.')
      }
      socket.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { op: number; d: Record<string, unknown> }
        if (msg.op === OP.Hello) {
          const auth = msg.d['authentication'] as { salt: string; challenge: string } | undefined
          if (auth && !password) {
            // Fail first: closing reports a generic "closed" reason otherwise.
            fail('OBS wants a password. Add it in Plugins › OBS Studio › Settings.')
            socket.close()
            return
          }
          socket.send(
            JSON.stringify({
              op: OP.Identify,
              d: {
                rpcVersion: 1,
                eventSubscriptions: EVENTS,
                ...(auth && { authentication: authString(password, auth.salt, auth.challenge) }),
              },
            }),
          )
        } else if (msg.op === OP.Identified) {
          clearTimeout(timer)
          resolve()
        } else if (msg.op === OP.RequestResponse) {
          const id = String(msg.d['requestId'])
          const p = this.pending.get(id)
          if (!p) return
          this.pending.delete(id)
          const status = msg.d['requestStatus'] as {
            result: boolean
            comment?: string
            code: number
          }
          if (status.result) p.resolve(msg.d['responseData'] ?? {})
          else p.reject(new Error(status.comment ?? `OBS refused (${status.code})`))
        } else if (msg.op === OP.Event) {
          const type = String(msg.d['eventType'])
          const data = (msg.d['eventData'] ?? {}) as Record<string, unknown>
          this.listeners.forEach((l) => l(type, data))
        }
      }
    })
    return this.ready
  }

  async request<T = Record<string, unknown>>(
    type: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    await this.connect()
    const socket = this.socket
    if (!socket) throw new Error('Not connected to OBS')
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject })
      socket.send(
        JSON.stringify({ op: OP.Request, d: { requestType: type, requestId, requestData: data } }),
      )
    })
  }
}
