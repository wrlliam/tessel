import {
  CloseCode,
  defaultPhoneSettings,
  PhoneSettings,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type PhoneProfile,
  type ServerMessage,
} from '@tessel/core'
import type { Point, TileOverride } from '@tessel/brand/page-grid'

export type Status =
  | { kind: 'connecting'; attempt: number }
  | { kind: 'live' }
  | { kind: 'unpaired'; reason?: string }
  | { kind: 'mismatch'; message: string }

export type { Point, TileOverride }

export type HistoryEvent =
  | {
      kind: 'page'
      tileId: string
      points: Point[]
      more: boolean
      keepMinutes: number
      before?: number
    }
  | { kind: 'live'; tileId: string; point: Point }
/** Points kept per chart for the key itself; the history view asks for more. */
const SERIES_POINTS = 240

export interface ConnectionState {
  status: Status
  profile?: PhoneProfile
  overrides: Record<string, TileOverride>
  /** Page the desktop asked to show, with a counter so asking twice still counts. */
  requestedPage?: { pageId: string; seq: number }
  settings: PhoneSettings
  /** Chart tiles: their latest points, oldest first. */
  series: Record<string, Point[]>
}

const SETTINGS_KEY = 'tessel.phoneSettings'

/** Last settings the desktop sent, so the theme is right before the phone reconnects. */
export function cachedSettings(): PhoneSettings {
  try {
    const parsed = PhoneSettings.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'))
    if (parsed.success) return parsed.data
  } catch {
    // Storage blocked or unreadable; use defaults.
  }
  return defaultPhoneSettings()
}

const PING_EVERY_MS = 10_000
const PONG_TIMEOUT_MS = 4_000

/** Exponential backoff with jitter, capped at 10 s. */
export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(10_000, 500 * 2 ** attempt)
  return Math.round(base * (0.5 + random() / 2))
}

export function wsUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`
}

export class Connection {
  private ws?: WebSocket
  private attempt = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private pingTimer?: ReturnType<typeof setInterval>
  private pongTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private listeners = new Set<() => void>()
  state: ConnectionState = {
    status: { kind: 'connecting', attempt: 0 },
    overrides: {},
    settings: cachedSettings(),
    series: {},
  }
  private historyListeners = new Set<(e: HistoryEvent) => void>()

  /** Older points as they arrive, and new ones as they're recorded, for the history view. */
  onHistory = (listener: (e: HistoryEvent) => void) => {
    this.historyListeners.add(listener)
    return () => void this.historyListeners.delete(listener)
  }

  requestHistory(tileId: string, before?: number) {
    this.send({ type: 'historyRequest', tileId, ...(before !== undefined ? { before } : {}) })
  }

  constructor(
    private token: string,
    private deviceName: string,
    private url: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  start() {
    this.stopped = false
    window.addEventListener('online', this.reconnectNow)
    document.addEventListener('visibilitychange', this.onVisible)
    this.open()
  }

  stop() {
    this.stopped = true
    window.removeEventListener('online', this.reconnectNow)
    document.removeEventListener('visibilitychange', this.onVisible)
    clearTimeout(this.retryTimer)
    this.clearPing()
    this.ws?.close()
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private set(patch: Partial<ConnectionState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  private open() {
    clearTimeout(this.retryTimer)
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        token: this.token,
        deviceName: this.deviceName,
      })
    }
    ws.onmessage = (e) => {
      const parsed = parseServerMessage(String(e.data))
      if (parsed.ok) this.handle(parsed.message)
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.clearPing()
      if (e.code === CloseCode.unauthorized || e.code === CloseCode.revoked) {
        this.stopped = true
        this.set({ status: { kind: 'unpaired', reason: e.reason || undefined } })
        return
      }
      if (e.code === CloseCode.protocolMismatch || this.stopped) return
      this.set({ status: { kind: 'connecting', attempt: this.attempt } })
      this.retryTimer = setTimeout(() => this.open(), backoffDelay(this.attempt++))
    }
  }

  private handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'profile':
        this.attempt = 0
        this.startPing()
        // Live looks are resent after every profile, so start clean.
        this.set({ status: { kind: 'live' }, profile: msg.profile, overrides: {}, series: {} })
        return
      case 'history': {
        if (msg.before === undefined)
          this.set({
            series: { ...this.state.series, [msg.tileId]: msg.points.slice(-SERIES_POINTS) },
          })
        this.historyListeners.forEach((l) =>
          l({
            kind: 'page',
            tileId: msg.tileId,
            points: msg.points,
            more: msg.more,
            keepMinutes: msg.keepMinutes,
            ...(msg.before !== undefined ? { before: msg.before } : {}),
          }),
        )
        return
      }
      case 'tileState': {
        const { type: _, tileId, sample, ...override } = msg
        if (sample) {
          const list = [...(this.state.series[tileId] ?? []), sample].slice(-SERIES_POINTS)
          this.set({ series: { ...this.state.series, [tileId]: list } })
          this.historyListeners.forEach((l) => l({ kind: 'live', tileId, point: sample }))
          if (Object.keys(override).length === 0) return
        }
        // A look and a slider position arrive separately; keep both.
        const merged = { ...this.state.overrides[tileId], ...override }
        this.set({ overrides: { ...this.state.overrides, [tileId]: merged } })
        return
      }
      case 'pong':
        clearTimeout(this.pongTimer)
        return
      case 'error':
        if (msg.code === 'protocol-mismatch') {
          this.stopped = true
          this.set({ status: { kind: 'mismatch', message: msg.message } })
        }
        return
      case 'phoneSettings':
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(msg.settings))
        } catch {
          // Storage blocked; settings still apply for this visit.
        }
        this.set({ settings: msg.settings })
        return
      case 'pageChange':
        this.set({
          requestedPage: { pageId: msg.pageId, seq: (this.state.requestedPage?.seq ?? 0) + 1 },
        })
        return
    }
  }

  // Phones drop sockets silently when they sleep; a missed pong forces a reconnect.
  private startPing() {
    this.clearPing()
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', t: Date.now() })
      this.pongTimer = setTimeout(() => this.ws?.close(), PONG_TIMEOUT_MS)
    }, PING_EVERY_MS)
  }

  private clearPing() {
    clearInterval(this.pingTimer)
    clearTimeout(this.pongTimer)
  }

  private reconnectNow = () => {
    if (this.stopped || this.state.status.kind === 'live') return
    this.attempt = 0
    this.ws?.close()
    this.open()
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.reconnectNow()
  }
}
