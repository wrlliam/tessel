import {
  type EditTileMessage,
  applyChange,
  createRegistry,
  describeBlock,
  Graph,
  PhoneSettings,
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
  ensureTls,
} from '@tessel/server'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
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

export type HubState = Omit<
  DesktopState,
  'platform' | 'startOnLogin' | 'version' | 'update' | 'myBlocksDir'
>

/** A change made on a phone, passed on to the editor. */
export interface PhoneEdit {
  profileId: string
  tileId: string
  look: { label?: string; colour?: string; icon?: string }
  swap?: {
    a: string
    b: string
    aAt: { col: number; row: number }
    bAt: { col: number; row: number }
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const applyLook = (t: Tile, look: PhoneEdit['look']): Tile => {
  const { icon, ...rest } = look
  const out: Tile = { ...t, ...rest }
  if (icon === '') delete out.icon
  else if (icon !== undefined) out.icon = icon
  return out
}

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

/** Tile state key holding a look set with "Keep it after Tessel restarts". */
const LOOK_KEY = 'appearance'

function savedLook(profile: Profile, tileId: string): Partial<Appearance> | undefined {
  const raw = profile.tileState[tileId]?.[LOOK_KEY]
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<Appearance>
    return typeof parsed === 'object' && parsed ? parsed : undefined
  } catch {
    return undefined
  }
}
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
  /** Slider positions (0 to 100) of the active profile, as phones show them. */
  private positions = new Map<string, number>()
  private sliding = new Set<string>()
  private pendingSlide = new Map<string, number>()
  private platform: Platform
  private caUrl: string | undefined
  private qrCodes: Record<string, string> = {}
  private log: LogEntry[] = []
  private logId = 0
  private listeners = new Set<() => void>()
  private engineListeners = new Set<(event: ProfileEngineEvent) => void>()
  private phoneEditListeners = new Set<(edit: PhoneEdit) => void>()
  private lastShortcutUse = new Map<string, number>()
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
    this.platform = { ...opts.platform, location: () => this.settings.location }
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
      // The QR codes carry the current code, so they change with it.
      void this.refreshNetwork(true)
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
      onSlide: (e) => void this.slide(e.tileId, e.value),
      onEditTile: (deviceId, edit) => void this.editFromPhone(deviceId, edit),
      onRunKey: (key) => this.runShortcut(key),
      onLocation: (_deviceId, at) => void this.setLocation(at.lat, at.lon),
      onPhonesChanged: (phones) => {
        this.phones = phones
        this.emit()
      },
      welcomeMessages: () => [
        { type: 'phoneSettings', settings: this.settings.phone },
        ...[...this.positions].map(([tileId, value]) => ({
          type: 'tileState' as const,
          tileId,
          value,
        })),
        ...[...this.live].map(([tileId, look]) => tileStateMessage(tileId, look)),
      ],
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
        https: this.settings.https,
        autoUpdate: this.settings.autoUpdate,
      },
      plugins: this.plugins?.list() ?? [],
      phoneSettings: this.settings.phone,
      toured: this.settings.toured,
      shortcuts: this.settings.shortcuts.map((s) => {
        const used = this.lastShortcutUse.get(s.id)
        return {
          id: s.id,
          profileId: s.profileId,
          tileId: s.tileId,
          label: this.findTile(s.profileId, s.tileId)?.label ?? 'Deleted tile',
          createdAt: s.createdAt,
          ...(used && { lastUsedAt: used }),
        }
      }),
      blocksVersion: this.blocksVersion,
    }
    if (this.serverError) state.serverError = this.serverError
    if (this.caUrl) state.caUrl = this.caUrl
    if (this.settings.location && this.settings.phone.shareLocation)
      state.location = this.settings.location
    return state
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Makes a link that runs a tile. The key is returned once; only its hash is kept. */
  async createShortcut(
    profileId: string,
    tileId: string,
  ): Promise<{ id: string; key: string } | undefined> {
    if (!this.findTile(profileId, tileId)) return undefined
    const key = randomBytes(24).toString('base64url')
    const id = randomBytes(6).toString('hex')
    const entry = { id, profileId, tileId, keyHash: sha256(key), createdAt: Date.now() }
    this.settings = { ...this.settings, shortcuts: [...this.settings.shortcuts, entry] }
    await this.store.save(this.settings)
    this.emit()
    return { id, key }
  }

  async deleteShortcut(id: string) {
    this.settings = {
      ...this.settings,
      shortcuts: this.settings.shortcuts.filter((s) => s.id !== id),
    }
    await this.store.save(this.settings)
    this.emit()
  }

  /** A shortcut link was used: runs its tile like a press, in the profile it belongs to. */
  async runShortcut(
    key: string,
  ): Promise<{ ok: true; tile: string } | { ok: false; error: string } | undefined> {
    const hash = sha256(key)
    const entry = this.settings.shortcuts.find((s) =>
      timingSafeEqual(Buffer.from(s.keyHash), Buffer.from(hash)),
    )
    if (!entry) return undefined
    const tile = this.findTile(entry.profileId, entry.tileId)
    if (!tile) return { ok: false, error: 'That tile no longer exists' }
    const label = tile.label || tile.id
    if (this.paused) return { ok: false, error: 'Tiles are paused' }
    this.lastShortcutUse.set(entry.id, Date.now())
    this.logger.info(`Shortcut link ran "${label}"`)
    const result = await this.runtime(entry.profileId).engine.trigger(tile, { type: 'press' })
    this.emit()
    return result?.status === 'ok' || !result
      ? { ok: true, tile: label }
      : { ok: false, error: result.error ?? `Run ${result.status}` }
  }

  /** A phone changed a key; the editor applies the same change to its copy. */
  onPhoneEdit(listener: (edit: PhoneEdit) => void): () => void {
    this.phoneEditListeners.add(listener)
    return () => this.phoneEditListeners.delete(listener)
  }

  /**
   * A phone renamed, recoloured or re-iconed a key, or swapped two keys on a page. Only looks and
   * places change; what keys do can only be changed on the computer.
   */
  async editFromPhone(deviceId: string, edit: Omit<EditTileMessage, 'type'>): Promise<boolean> {
    if (!this.settings.phone.allowEdit) return false
    const profile = this.library.active()
    const page = profile.pages.find((p) => p.tiles.some((t) => t.id === edit.tileId))
    const tile = page?.tiles.find((t) => t.id === edit.tileId)
    if (!page || !tile) return false
    const look: PhoneEdit['look'] = {
      ...(edit.label !== undefined && { label: edit.label.trim().slice(0, 40) }),
      ...(edit.colour !== undefined && { colour: edit.colour }),
      ...(edit.icon !== undefined && { icon: edit.icon }),
    }
    let tiles = page.tiles.map((t) => (t.id === tile.id ? applyLook(t, look) : t))
    let swap: PhoneEdit['swap']
    if (edit.swapWith && edit.swapWith !== tile.id) {
      const other = page.tiles.find((t) => t.id === edit.swapWith)
      if (!other) return false
      swap = { a: tile.id, b: other.id, aAt: other.position, bAt: tile.position }
      tiles = tiles.map((t) =>
        t.id === tile.id
          ? { ...t, position: other.position }
          : t.id === other.id
            ? { ...t, position: tile.position }
            : t,
      )
    }
    const next = Profile.safeParse({
      ...profile,
      pages: profile.pages.map((p) => (p.id === page.id ? { ...p, tiles } : p)),
    })
    // A swap that would overlap other keys (different sizes) is refused.
    if (!next.success) return false
    await this.library.save(next.data)
    this.refreshActive()
    const device = this.devices.list().find((d) => d.id === deviceId)
    this.logger.info(`${device?.name ?? 'A phone'} changed "${tile.label || tile.id}"`)
    const change: PhoneEdit = {
      profileId: profile.id,
      tileId: tile.id,
      look,
      ...(swap && { swap }),
    }
    this.phoneEditListeners.forEach((l) => l(change))
    this.emit()
    return true
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

  /** Moves a slider from the editor's Try mode, as if dragged on a phone. */
  async trySlide(profileId: string, tileId: string, position: number) {
    const value = Math.max(0, Math.min(100, position))
    if (profileId === this.library.activeId) return this.slide(tileId, value)
    const tile = this.findTile(profileId, tileId)
    if (tile?.kind === 'slider')
      await this.runtime(profileId).engine.trigger(tile, { type: 'slide', data: { value } })
  }

  stopTile(profileId: string, tileId: string) {
    this.runtimes.get(profileId)?.engine.cancel(tileId)
  }

  shellPolicy() {
    return this.settings.shell
  }

  /** Changes how phones look and behave, and tells connected phones straight away. */
  async updatePhoneSettings(patch: unknown): Promise<SaveResult> {
    const parsed = PhoneSettings.safeParse({ ...this.settings.phone, ...(patch as object) })
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid setting' }
    this.settings = { ...this.settings, phone: parsed.data }
    await this.store.save(this.settings)
    this.server.broadcast({ type: 'phoneSettings', settings: parsed.data })
    this.emit()
    return { ok: true }
  }

  /** Applies a settings change; a new port restarts sharing. */
  async updateSettings(patch: unknown): Promise<SaveResult> {
    const { port, shell, theme, logLevel, https, autoUpdate } = patch as Partial<Settings>
    const allowed = Object.fromEntries(
      Object.entries({ port, shell, theme, logLevel, https, autoUpdate }).filter(
        ([, v]) => v !== undefined,
      ),
    )
    const parsed = Settings.safeParse({ ...this.settings, ...allowed })
    if (!parsed.success)
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid setting' }
    const portChanged = parsed.data.port !== this.settings.port
    const httpsChanged = parsed.data.https !== this.settings.https
    this.settings = parsed.data
    await this.store.save(this.settings)
    if (portChanged && this.listening) {
      await this.server.stop()
      this.listening = false
      await this.startServer()
    } else if (httpsChanged) {
      await this.applyTls(this.hosts())
      await this.refreshNetwork(true)
      this.logger.info(this.server.secure ? 'Secure connections on' : 'Secure connections off')
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

  /**
   * A slider moved. Drags arrive many times a second, so while the tile runs only the newest
   * position is kept, then run once more when it finishes.
   */
  async slide(tileId: string, position: number): Promise<void> {
    const profileId = this.library.activeId
    const tile = this.findTile(profileId, tileId)
    if (!tile || tile.kind !== 'slider' || this.paused) return
    this.positions.set(tileId, position)
    this.server.broadcast({ type: 'tileState', tileId, value: position })
    if (this.sliding.has(tileId)) {
      this.pendingSlide.set(tileId, position)
      return
    }
    this.sliding.add(tileId)
    const runtime = this.runtime(profileId)
    try {
      let next: number | undefined = position
      while (next !== undefined) {
        this.pendingSlide.delete(tileId)
        await runtime.engine.trigger(tile, { type: 'slide', data: { value: next } })
        next = this.pendingSlide.get(tileId)
      }
    } finally {
      this.sliding.delete(tileId)
      runtime.setTileState(tileId, 'position', this.positions.get(tileId) ?? position)
    }
  }

  /** Where phones are, for weather tiles. Only kept when Share location is on. */
  async setLocation(lat: number, lon: number) {
    if (!this.settings.phone.shareLocation) return
    const prev = this.settings.location
    // Ignore small moves so the settings file isn't rewritten on every report.
    if (prev && Math.abs(prev.lat - lat) < 0.01 && Math.abs(prev.lon - lon) < 0.01) return
    this.settings = { ...this.settings, location: { lat, lon, at: Date.now() } }
    await this.store.save(this.settings)
    this.emit()
  }

  async finishTour() {
    this.settings = { ...this.settings, toured: true }
    await this.store.save(this.settings)
    this.emit()
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
        platform: this.platform,
        get: () => this.library.get(profileId) as Profile,
        replace: (p) => this.library.put(p),
        persist: (p) => this.library.save(p),
        onEvent: (e) => this.handleEngineEvent(profileId, e),
        onAppearance: (tileId, change, remember) =>
          this.changeAppearance(profileId, tileId, change, remember),
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
    this.positions.clear()
    const active = this.library.active()
    for (const tile of tilesOf(active)) {
      const look = savedLook(active, tile.id)
      if (look) this.overrides.set(tile.id, look)
      const position = active.tileState[tile.id]?.['position']
      if (tile.kind === 'slider')
        this.positions.set(tile.id, typeof position === 'number' ? position : 50)
    }
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

  private changeAppearance(
    profileId: string,
    tileId: string,
    change: AppearanceChange,
    remember: boolean,
  ) {
    const profile = this.library.get(profileId)
    if (!profile || !tilesOf(profile).some((t) => t.id === tileId)) return
    const saved = savedLook(profile, tileId)
    // A remembered look is kept in the tile's saved state; reset always clears it.
    if (remember || change === 'reset') {
      const look = applyChange(saved, change)
      this.runtime(profileId).setTileState(tileId, LOOK_KEY, look ? JSON.stringify(look) : null)
    }
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
    await this.applyTls(this.hosts())
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

  private hosts(): string[] {
    const hosts = (this.opts.addresses ?? lanAddresses)().map((a) => a.address)
    if (this.opts.localHostname) hosts.push(this.opts.localHostname)
    return hosts
  }

  /** Turns https on or off to match settings; a new address gets a renewed certificate. */
  private async applyTls(hosts: string[]) {
    if (!this.settings.https) return this.server.setTls(undefined)
    try {
      this.server.setTls(await ensureTls(join(this.opts.dataDir, 'tls'), hosts))
    } catch (err) {
      this.server.setTls(undefined)
      this.logger.error(`Couldn't set up secure connections: ${(err as Error).message}`)
    }
  }

  private async refreshNetwork(force = false) {
    const port = this.settings.port
    const hosts = this.hosts()
    const scheme = this.server.secure ? 'https' : 'http'
    const urls = this.listening ? hosts.map((h) => `${scheme}://${h}:${port}/`) : []
    if (!force && urls.join() === this.urls.join()) return
    // Addresses changed: make sure the certificate still covers them.
    if (this.server.secure) await this.applyTls(hosts)
    this.caUrl =
      this.server.secure && this.listening && hosts[0]
        ? `http://${hosts[0]}:${port}/tessel-ca.crt`
        : undefined
    const qrCodes: Record<string, string> = {}
    // The code rides in the fragment, which browsers never send to a server, so scanning pairs
    // straight away. It's the same code shown on screen, single-use and short-lived.
    const code = this.pairing.get().code
    for (const url of urls) {
      qrCodes[url] = await QRCode.toDataURL(`${url}#pair=${code}`, {
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
