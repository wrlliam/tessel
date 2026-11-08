import {
  applyChange,
  createRegistry,
  describeBlock,
  Graph,
  Profile,
  resolveAppearance,
  sameAppearance,
  validateGraph,
  type Appearance,
  type AppearanceChange,
  type BlockDescriptor,
  type EngineEvent,
  type GraphIssue,
  type JsonValue,
  type Platform,
  type ServerMessage,
  type Tile,
} from '@tessel/core'
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
import type { DesktopState, LogEntry, ProfileEngineEvent, SaveResult } from '../shared/api.ts'
import { newProfileId, ProfileLibrary } from './profiles.ts'
import { ProfileRuntime } from './runtime.ts'
import { PluginManager, type ManagerOptions } from './plugins/manager.ts'
import { Scheduler } from './scheduler.ts'
import { Settings, settingsStore } from './settings.ts'
import { blocksUsed, packProfile, unpackProfile } from './transfer.ts'

const LOG_LIMIT = 200
const NETWORK_POLL_MS = 10_000
const LONG_PRESS_MS = 500
const LEVELS = { info: 0, warn: 1, error: 2 } as const

export type HubState = Omit<DesktopState, 'platform' | 'startOnLogin'>

export interface HubOptions {
  dataDir: string
  phoneDir: string
  platform: Platform
  /** Extra address to offer, e.g. the macOS Bonjour hostname. */
  localHostname?: string
  /** Plugin processes; leave out to run without plugins. */
  plugins?: Pick<
    ManagerOptions,
    'spawn' | 'builtinDirs' | 'confirmPermissions' | 'watch' | 'restartDelaysMs'
  >
  /** Inject for tests. */
  addresses?: () => LanAddress[]
  mdns?: boolean
}

const tilesOf = (p: Profile) => p.pages.flatMap((pg) => pg.tiles)
const hasTrigger = (t: Tile, type: string) => t.graph.nodes.some((n) => n.type === type)
const baseLook = (t: Tile): Appearance => ({ label: t.label, colour: t.colour, icon: t.icon ?? '' })

/** Owns the server, pairing, devices, profiles and engines. Electron-free so it can be unit-tested. */
export class Hub {
  private settings!: Settings
  private store: JsonStore<Settings>
  private devices: DeviceRegistry
  private pairing = new PairingCodes()
  private server: TesselServer
  private library: ProfileLibrary
  private runtimes = new Map<string, ProfileRuntime>()
  private registry = createRegistry()
  readonly plugins?: PluginManager
  /** Bumped whenever plugin blocks come or go, so the editor reloads its block list. */
  private blocksVersion = 0
  /** Run-time look changes from Set tile appearance, for the active profile. */
  private overrides = new Map<string, Partial<Appearance>>()
  /** What phones currently show for tiles that differ from their own look. */
  private live = new Map<string, Appearance>()
  private phones: ConnectedPhone[] = []
  private paused = false
  private listening = false
  private serverError: string | undefined
  private urls: string[] = []
  private qrCodes: Record<string, string> = {}
  private log: LogEntry[] = []
  private logId = 0
  private listeners = new Set<() => void>()
  private engineListeners = new Set<(event: ProfileEngineEvent) => void>()
  private codeTimer?: NodeJS.Timeout
  private networkTimer?: NodeJS.Timeout
  /** Tiles held down on a phone, for long press. */
  private holds = new Map<string, { timer: NodeJS.Timeout; long: boolean }>()
  private scheduler = new Scheduler(({ tileId, nodeId }) => {
    const tile = this.findTile(this.library.activeId, tileId)
    if (tile && !this.paused)
      void this.runtime(this.library.activeId).engine.trigger(tile, { type: 'schedule', nodeId })
  })
  readonly logger: Logger = {
    info: (m) => this.addLog('info', m),
    warn: (m) => this.addLog('warn', m),
    error: (m) => this.addLog('error', m),
  }

  constructor(private opts: HubOptions) {
    this.store = settingsStore(join(opts.dataDir, 'settings.json'))
    this.devices = new DeviceRegistry(join(opts.dataDir, 'devices.json'))
    this.library = new ProfileLibrary(join(opts.dataDir, 'profiles'), (m) => this.logger.warn(m))
    if (opts.plugins) {
      this.plugins = new PluginManager({
        ...opts.plugins,
        dataDir: opts.dataDir,
        os: opts.platform.os,
        registry: this.registry,
        logger: this.logger,
        onChange: () => {
          this.blocksVersion++
          // Newly started plugins may own triggers already on tiles.
          if (this.settings) this.subscribePlugins()
          this.emit()
        },
        onEvent: (subscriptionId, values) => this.pluginEvent(subscriptionId, values),
        onTileState: (tileId, key, value) =>
          this.runtime(this.library.activeId).setTileState(tileId, key, value),
      })
    }
    this.devices.onChange(() => this.emit())
    this.pairing.onChange(() => {
      this.scheduleCodeRotation()
      this.emit()
    })
    this.server = new TesselServer({
      devices: this.devices,
      pairing: this.pairing,
      profile: Profile.parse({
        id: 'loading',
        name: 'Loading',
        pages: [{ id: 'p', name: 'Loading' }],
      }),
      phoneDir: opts.phoneDir,
      logger: this.logger,
      mdns: opts.mdns ?? true,
      onPress: (e) => void this.press(e),
      onPageChange: (_deviceId, pageId) => void this.pageOpened(pageId),
      onPhonesChanged: (phones) => {
        this.phones = phones
        this.emit()
      },
      welcomeMessages: () => [...this.live].map(([tileId, look]) => tileStateMessage(tileId, look)),
    })
  }

  async init() {
    this.settings = await this.store.load()
    await this.devices.load()
    await this.library.load()
    await this.plugins?.load()
    this.activate()
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
      profiles: this.library.list(),
      activeProfileId: this.library.activeId,
      liveAppearance: Object.fromEntries(this.live),
      settings: {
        shell: this.settings.shell,
        theme: this.settings.theme,
        logLevel: this.settings.logLevel,
      },
      plugins: this.plugins?.list() ?? [],
      blocksVersion: this.blocksVersion,
    }
    if (this.serverError) state.serverError = this.serverError
    return state
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onEngineEvent(listener: (event: ProfileEngineEvent) => void): () => void {
    this.engineListeners.add(listener)
    return () => this.engineListeners.delete(listener)
  }

  blocks(): BlockDescriptor[] {
    return this.registry.list().map(describeBlock)
  }

  getProfile(id: string): Profile | undefined {
    return this.library.get(id)
  }

  /** Saves the editor's layout and graphs. Variables stay as the engine left them. */
  async saveProfile(input: unknown): Promise<SaveResult> {
    const parsed = Profile.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { ok: false, error: issue?.message ?? 'The profile is not valid' }
    }
    const current = this.library.get(parsed.data.id)
    if (!current) return { ok: false, error: 'That profile no longer exists' }
    await this.library.save({
      ...parsed.data,
      variables: current.variables,
      tileState: current.tileState,
    })
    if (parsed.data.id === this.library.activeId) this.refreshActive()
    this.emit()
    return { ok: true }
  }

  async createProfile(name: string): Promise<string> {
    const id = newProfileId()
    await this.library.save(
      Profile.parse({
        id,
        name: this.library.uniqueName(name.trim() || 'New profile'),
        pages: [{ id: 'home', name: 'Home' }],
      }),
    )
    this.emit()
    return id
  }

  async duplicateProfile(id: string): Promise<string | undefined> {
    const source = this.library.get(id)
    if (!source) return undefined
    await this.runtimes.get(id)?.flush()
    const copy = {
      ...structuredClone(source),
      id: newProfileId(),
      name: this.library.uniqueName(source.name),
    }
    await this.library.save(copy)
    this.emit()
    return copy.id
  }

  async deleteProfile(id: string): Promise<boolean> {
    const wasActive = id === this.library.activeId
    await this.runtimes.get(id)?.dispose()
    this.runtimes.delete(id)
    const removed = await this.library.remove(id)
    if (removed && wasActive) this.activate()
    this.emit()
    return removed
  }

  async setActiveProfile(id: string) {
    if (!this.library.has(id) || id === this.library.activeId) return
    await this.library.setActive(id)
    this.activate()
    this.logger.info(`Phones now use "${this.library.active().name}"`)
  }

  /** Adds variables a template needs, keeping any that already exist. */
  addVariables(profileId: string, values: Record<string, JsonValue>) {
    const profile = this.library.get(profileId)
    if (!profile) return
    const missing = Object.fromEntries(
      Object.entries(values).filter(([k]) => !Object.hasOwn(profile.variables, k)),
    )
    if (Object.keys(missing).length) this.runtime(profileId).setVariables(missing)
  }

  async exportProfile(id: string): Promise<Uint8Array | undefined> {
    const profile = this.library.get(id)
    if (!profile) return undefined
    await this.runtimes.get(id)?.flush()
    return packProfile(this.library.get(id) ?? profile)
  }

  /** Reads a .tessel file. Throws ImportError with a readable message. */
  previewImport(bytes: Uint8Array): { name: string; blocks: string[]; profile: Profile } {
    const profile = unpackProfile(bytes)
    return {
      name: profile.name,
      blocks: blocksUsed(profile, (t) => this.registry.get(t)?.name),
      profile,
    }
  }

  async addImported(profile: Profile): Promise<string> {
    const id = newProfileId()
    await this.library.save({ ...profile, id, name: this.library.uniqueName(profile.name) })
    this.logger.info(`Imported "${profile.name}"`)
    this.emit()
    return id
  }

  checkGraph(input: unknown): GraphIssue[] {
    const graph = Graph.safeParse(input)
    if (!graph.success) return [{ severity: 'error', message: 'The graph is not readable' }]
    return validateGraph(graph.data, this.registry)
  }

  async testRun(profileId: string, tileId: string) {
    const tile = this.findTile(profileId, tileId)
    if (tile) await this.runtime(profileId).engine.trigger(tile, { type: 'press' })
  }

  stopTile(profileId: string, tileId: string) {
    this.runtimes.get(profileId)?.engine.cancel(tileId)
  }

  shellPolicy() {
    return this.settings.shell
  }

  /** Applies a settings change; a new port restarts sharing. */
  async updateSettings(patch: unknown): Promise<SaveResult> {
    const { port, shell, theme, logLevel } = patch as Partial<Settings>
    const allowed = Object.fromEntries(
      Object.entries({ port, shell, theme, logLevel }).filter(([, v]) => v !== undefined),
    )
    const parsed = Settings.safeParse({ ...this.settings, ...allowed })
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid setting' }
    const portChanged = parsed.data.port !== this.settings.port
    this.settings = parsed.data
    await this.store.save(this.settings)
    if (portChanged && this.listening) {
      await this.server.stop()
      this.listening = false
      await this.startServer()
    }
    this.emit()
    return { ok: true }
  }

  plugin(): PluginManager {
    if (!this.plugins) throw new Error('Plugins are not available')
    return this.plugins
  }

  async setAllowPhones(on: boolean) {
    this.settings = { ...this.settings, allowPhones: on }
    await this.store.save(this.settings)
    if (on) await this.startServer()
    else await this.stopServer()
  }

  setPaused(on: boolean) {
    this.paused = on
    if (on) for (const r of this.runtimes.values()) r.engine.cancelAll()
    this.logger.info(on ? 'Paused all tiles' : 'Resumed tiles')
  }

  newPairingCode() {
    this.pairing.rotate()
  }

  async revokeDevice(id: string) {
    const name = this.devices.list().find((d) => d.id === id)?.name
    if (await this.devices.revoke(id)) this.logger.info(`Removed "${name}"`)
  }

  async press({ deviceId, tileId, phase }: PressEvent): Promise<void> {
    const profileId = this.library.activeId
    const tile = this.findTile(profileId, tileId)
    if (!tile || tile.kind === 'folder') return
    const label = tile.label || tileId
    if (this.paused) {
      if (phase === 'down') {
        const device = this.devices.list().find((d) => d.id === deviceId)
        this.logger.info(`Ignored "${label}" from ${device?.name ?? 'a phone'}: tiles are paused`)
      }
      return
    }
    if (tile.graph.nodes.length === 0) {
      if (phase === 'down') this.logger.info(`"${label}" has no blocks yet`)
      return
    }
    const engine = this.runtime(profileId).engine
    const key = `${deviceId}:${tileId}`
    // With a long press trigger, a short tap fires On press on release instead of on touch.
    const longPress = hasTrigger(tile, 'trigger.longPress')
    if (phase === 'down') {
      if (!longPress) {
        await engine.trigger(tile, { type: 'press' })
        return
      }
      clearTimeout(this.holds.get(key)?.timer)
      const hold = {
        long: false,
        timer: setTimeout(() => {
          hold.long = true
          void engine.trigger(tile, { type: 'longPress' })
        }, LONG_PRESS_MS),
      }
      this.holds.set(key, hold)
      return
    }
    const hold = this.holds.get(key)
    this.holds.delete(key)
    if (hold) clearTimeout(hold.timer)
    if (longPress && hold && !hold.long) await engine.trigger(tile, { type: 'press' })
    await engine.trigger(tile, { type: 'release' })
  }

  /** Runs On page open for every tile on the page a phone just showed. */
  async pageOpened(pageId: string) {
    if (this.paused) return
    const profileId = this.library.activeId
    const page = this.library.active().pages.find((p) => p.id === pageId)
    const engine = this.runtime(profileId).engine
    await Promise.all((page?.tiles ?? []).map((t) => engine.trigger(t, { type: 'pageOpen' })))
  }

  async dispose() {
    clearTimeout(this.codeTimer)
    clearInterval(this.networkTimer)
    this.scheduler.stop()
    for (const h of this.holds.values()) clearTimeout(h.timer)
    await this.plugins?.dispose()
    await this.server.dispose()
    await Promise.all([...this.runtimes.values()].map((r) => r.dispose()))
  }

  private runtime(profileId: string): ProfileRuntime {
    let runtime = this.runtimes.get(profileId)
    if (!runtime) {
      runtime = new ProfileRuntime({
        registry: this.registry,
        platform: this.opts.platform,
        get: () => this.library.get(profileId) as Profile,
        replace: (p) => this.library.put(p),
        persist: (p) => this.library.save(p),
        onEvent: (e) => this.handleEngineEvent(profileId, e),
        onAppearance: (tileId, change) => this.changeAppearance(profileId, tileId, change),
        onStateChanged: () => {
          if (profileId === this.library.activeId) this.pushAppearances()
        },
        onSwitchPage: (pageId) => {
          if (profileId === this.library.activeId)
            this.server.broadcast({ type: 'pageChange', pageId })
        },
        findTile: (tileId) => this.findTile(profileId, tileId),
        onSaveError: (err) => this.logger.error(`Couldn't save variables: ${err.message}`),
      })
      this.runtimes.set(profileId, runtime)
    }
    return runtime
  }

  /** Points phones at the active profile with fresh run-time looks. */
  private activate() {
    this.overrides.clear()
    this.live.clear()
    this.server.setProfile(this.library.active())
    this.pushAppearances()
    this.reschedule()
    this.subscribePlugins()
    this.emit()
  }

  /** Tells plugins which of their triggers sit on tiles of the active profile. */
  private subscribePlugins() {
    if (!this.plugins) return
    const pluginIds = new Set(this.plugins.list().map((p) => p.id))
    this.plugins.setSubscriptions(
      tilesOf(this.library.active()).flatMap((tile) =>
        tile.graph.nodes
          .filter(
            (n) =>
              pluginIds.has(n.type.split('.')[0] ?? '') &&
              (this.registry.get(n.type)?.trigger ?? 'plugin') === 'plugin',
          )
          .map((n) => ({
            id: `${tile.id}::${n.id}`,
            trigger: n.type,
            tileId: tile.id,
            params: n.params,
          })),
      ),
    )
  }

  private pluginEvent(subscriptionId: string, values: Record<string, unknown>) {
    if (this.paused) return
    const [tileId = '', nodeId = ''] = subscriptionId.split('::')
    const tile = this.findTile(this.library.activeId, tileId)
    if (tile)
      void this.runtime(this.library.activeId).engine.trigger(tile, {
        type: 'plugin',
        nodeId,
        data: values,
      })
  }

  private reschedule() {
    this.scheduler.set(
      tilesOf(this.library.active()).flatMap((tile) =>
        tile.graph.nodes
          .filter((n) => n.type === 'trigger.schedule' && typeof n.params['cron'] === 'string')
          .map((n) => ({ tileId: tile.id, nodeId: n.id, pattern: n.params['cron'] as string })),
      ),
    )
  }

  /** The active profile was edited: resend it and recompute looks. */
  private refreshActive() {
    const ids = new Set(tilesOf(this.library.active()).map((t) => t.id))
    for (const id of this.overrides.keys()) if (!ids.has(id)) this.overrides.delete(id)
    this.live.clear()
    this.server.setProfile(this.library.active())
    this.pushAppearances()
    this.reschedule()
    this.subscribePlugins()
  }

  private changeAppearance(profileId: string, tileId: string, change: AppearanceChange) {
    if (profileId !== this.library.activeId) return
    const next = applyChange(this.overrides.get(tileId), change)
    if (next) this.overrides.set(tileId, next)
    else this.overrides.delete(tileId)
    this.pushAppearances()
  }

  /** Sends phones every tile whose look changed since the last push. */
  private pushAppearances() {
    const profile = this.library.active()
    let changed = false
    for (const tile of tilesOf(profile)) {
      const scope = {
        var: profile.variables,
        state: profile.tileState[tile.id] ?? {},
        tile: { id: tile.id },
      }
      const look = resolveAppearance(tile, scope, this.overrides.get(tile.id))
      const shown = this.live.get(tile.id) ?? baseLook(tile)
      if (sameAppearance(look, shown)) continue
      if (sameAppearance(look, baseLook(tile))) this.live.delete(tile.id)
      else this.live.set(tile.id, look)
      this.server.broadcast(tileStateMessage(tile.id, look))
      changed = true
    }
    if (changed) this.emit()
  }

  private findTile(profileId: string, tileId: string): Tile | undefined {
    const profile = this.library.get(profileId)
    return profile && tilesOf(profile).find((t) => t.id === tileId)
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

  private handleEngineEvent(profileId: string, e: EngineEvent) {
    this.engineListeners.forEach((l) => l({ profileId, event: e }))
    if (e.type !== 'run:end') return
    const tile = this.findTile(profileId, e.tileId)
    const label = `"${tile?.label || e.tileId}"`
    switch (e.status) {
      case 'ok':
        this.logger.info(`${label} ran in ${e.ms} ms`)
        return
      case 'cancelled':
        this.logger.info(`${label} was stopped`)
        return
      case 'timeout':
        this.logger.warn(`${label}: ${e.error ?? 'took too long'}`)
        return
      case 'error': {
        const node = tile?.graph.nodes.find((n) => n.id === e.failedNodeId)
        const block = node && this.registry.get(node.type)?.name
        this.logger.error(`${label}${block ? ` › ${block}` : ''}: ${e.error ?? 'failed'}`)
      }
    }
  }

  private scheduleCodeRotation() {
    clearTimeout(this.codeTimer)
    const { expiresAt } = this.pairing.get()
    this.codeTimer = setTimeout(() => this.pairing.get(), Math.max(0, expiresAt - Date.now()) + 50)
  }

  private addLog(level: LogEntry['level'], message: string) {
    if (this.settings && LEVELS[level] < LEVELS[this.settings.logLevel]) return
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

const tileStateMessage = (tileId: string, look: Appearance): ServerMessage => ({
  type: 'tileState',
  tileId,
  label: look.label,
  colour: look.colour,
  icon: look.icon,
})

function describeListenError(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE')
    return `Port ${port} is already used by another app. Close it or pick another port.`
  if (code === 'EACCES') return `Tessel isn't allowed to use port ${port}. Pick a port above 1024.`
  return `Couldn't start sharing: ${(err as Error).message}`
}
