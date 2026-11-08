import { sampleProfile, type Profile } from '@tessel/core'
import {
  DeviceRegistry,
  PairingCodes,
  TesselServer,
  lanAddresses,
  type ConnectedPhone,
  type JsonStore,
  type LanAddress,
  type Logger,
  type PressEvent,
} from '@tessel/server'
import { join } from 'node:path'
import QRCode from 'qrcode'
import type { DesktopState, LogEntry } from '../shared/api.ts'
import { settingsStore, type Settings } from './settings.ts'

const LOG_LIMIT = 200
const NETWORK_POLL_MS = 10_000

export type HubState = Omit<DesktopState, 'platform' | 'startOnLogin'>

export interface HubOptions {
  dataDir: string
  phoneDir: string
  /** Extra address to offer, e.g. the macOS Bonjour hostname. */
  localHostname?: string
  /** Inject for tests. */
  addresses?: () => LanAddress[]
  mdns?: boolean
}

/** Owns the server, pairing and devices. Electron-free so it can be unit-tested. */
export class Hub {
  private settings!: Settings
  private store: JsonStore<Settings>
  private devices: DeviceRegistry
  private pairing = new PairingCodes()
  private server: TesselServer
  private profile: Profile = sampleProfile
  private phones: ConnectedPhone[] = []
  private paused = false
  private listening = false
  private serverError: string | undefined
  private urls: string[] = []
  private qrCodes: Record<string, string> = {}
  private log: LogEntry[] = []
  private logId = 0
  private listeners = new Set<() => void>()
  private codeTimer?: NodeJS.Timeout
  private networkTimer?: NodeJS.Timeout
  readonly logger: Logger = {
    info: (m) => this.addLog('info', m),
    warn: (m) => this.addLog('warn', m),
    error: (m) => this.addLog('error', m),
  }

  constructor(private opts: HubOptions) {
    this.store = settingsStore(join(opts.dataDir, 'settings.json'))
    this.devices = new DeviceRegistry(join(opts.dataDir, 'devices.json'))
    this.devices.onChange(() => this.emit())
    this.pairing.onChange(() => {
      this.scheduleCodeRotation()
      this.emit()
    })
    this.server = new TesselServer({
      devices: this.devices,
      pairing: this.pairing,
      profile: this.profile,
      phoneDir: opts.phoneDir,
      logger: this.logger,
      mdns: opts.mdns ?? true,
      onPress: (e) => this.handlePress(e),
      onPhonesChanged: (phones) => {
        this.phones = phones
        this.emit()
      },
    })
  }

  async init() {
    this.settings = await this.store.load()
    await this.devices.load()
    this.scheduleCodeRotation()
    this.networkTimer = setInterval(() => void this.refreshNetwork(), NETWORK_POLL_MS)
    if (this.settings.allowPhones) await this.startServer()
  }

  state(): HubState {
    const online = new Set(this.phones.map((p) => p.deviceId))
    const state: HubState = {
      allowPhones: this.settings.allowPhones,
      listening: this.listening,
      port: this.settings.port,
      urls: this.urls,
      qrCodes: this.qrCodes,
      pairing: this.pairing.get(),
      devices: this.devices.list().map((d) => ({ ...d, online: online.has(d.id) })),
      paused: this.paused,
      log: this.log,
    }
    if (this.serverError) state.serverError = this.serverError
    return state
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setAllowPhones(on: boolean) {
    this.settings = { ...this.settings, allowPhones: on }
    await this.store.save(this.settings)
    if (on) await this.startServer()
    else await this.stopServer()
  }

  setPaused(on: boolean) {
    this.paused = on
    this.logger.info(on ? 'Paused all tiles' : 'Resumed tiles')
  }

  newPairingCode() {
    this.pairing.rotate()
  }

  async revokeDevice(id: string) {
    const name = this.devices.list().find((d) => d.id === id)?.name
    if (await this.devices.revoke(id)) this.logger.info(`Removed "${name}"`)
  }

  async dispose() {
    clearTimeout(this.codeTimer)
    clearInterval(this.networkTimer)
    await this.server.dispose()
  }

  private async startServer() {
    this.serverError = undefined
    try {
      await this.server.start(this.settings.port)
      this.listening = true
    } catch (err) {
      this.listening = false
      this.serverError = describeListenError(err, this.settings.port)
      this.logger.error(this.serverError)
    }
    await this.refreshNetwork(true)
  }

  private async stopServer() {
    await this.server.stop()
    this.listening = false
    this.serverError = undefined
    await this.refreshNetwork(true)
  }

  private async refreshNetwork(force = false) {
    const port = this.settings.port
    const hosts = (this.opts.addresses ?? lanAddresses)().map((a) => a.address)
    if (this.opts.localHostname) hosts.push(this.opts.localHostname)
    const urls = this.listening ? hosts.map((h) => `http://${h}:${port}/`) : []
    if (!force && urls.join() === this.urls.join()) return
    const qrCodes: Record<string, string> = {}
    for (const url of urls) {
      qrCodes[url] = await QRCode.toDataURL(url, {
        margin: 1,
        width: 480,
        color: { dark: '#0E1116', light: '#F4F6F8' },
      })
    }
    this.urls = urls
    this.qrCodes = qrCodes
    this.emit()
  }

  private handlePress({ deviceId, tileId, phase }: PressEvent) {
    if (phase !== 'down') return
    const tile = this.profile.pages.flatMap((p) => p.tiles).find((t) => t.id === tileId)
    const device = this.devices.list().find((d) => d.id === deviceId)
    const label = tile?.label || tileId
    if (this.paused) {
      this.logger.info(`Ignored "${label}" from ${device?.name ?? 'a phone'}: tiles are paused`)
      return
    }
    this.logger.info(`"${label}" pressed on ${device?.name ?? 'a phone'}`)
  }

  private scheduleCodeRotation() {
    clearTimeout(this.codeTimer)
    const { expiresAt } = this.pairing.get()
    this.codeTimer = setTimeout(() => this.pairing.get(), Math.max(0, expiresAt - Date.now()) + 50)
  }

  private addLog(level: LogEntry['level'], message: string) {
    this.log = [
      ...this.log.slice(-(LOG_LIMIT - 1)),
      { id: ++this.logId, at: Date.now(), level, message },
    ]
    this.emit()
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}

function describeListenError(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE')
    return `Port ${port} is already used by another app. Close it or pick another port.`
  if (code === 'EACCES') return `Tessel isn't allowed to use port ${port}. Pick a port above 1024.`
  return `Couldn't start sharing: ${(err as Error).message}`
}
