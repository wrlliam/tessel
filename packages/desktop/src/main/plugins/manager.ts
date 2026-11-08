import type { BlockDefinition, BlockRegistry, OS, RunContext } from '@tessel/core'
import {
  cleanSettings,
  PluginManifest,
  type Permission,
  type SettingsSchema,
} from '@tessel/plugin-sdk'
import type { Description, Notification, Subscription } from '@tessel/plugin-sdk/protocol'
import { createJsonStore, type JsonStore, type Logger } from '@tessel/server'
import { unzipSync } from 'fflate'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { z } from 'zod'
import { PluginConnection } from './connection.ts'
import type { PluginProcess, Spawn } from './process.ts'

export type PluginSource = 'built-in' | 'installed' | 'dev'
export type PluginStatus = 'starting' | 'running' | 'stopped' | 'crashed' | 'failed'

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  author?: string
  icon?: string
  source: PluginSource
  platforms?: OS[]
  permissions: Permission[]
  enabled: boolean
  status: PluginStatus
  error?: string
  blockCount: number
  settingsSchema?: SettingsSchema
  settings: Record<string, unknown>
}

const PluginState = z.object({
  enabled: z.boolean(),
  granted: z.boolean(),
  settings: z.record(z.string(), z.unknown()).default({}),
  /** Folder for dev plugins, which are used in place rather than copied. */
  devPath: z.string().optional(),
})
const PluginsFile = z.object({ plugins: z.record(z.string(), PluginState) })
type PluginState = z.infer<typeof PluginState>

const START_TIMEOUT_MS = 10_000
const RESTART_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]
const CRASH_WINDOW_MS = 2 * 60_000
const MAX_ZIP_BYTES = 50 * 1024 * 1024
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024
const MAX_STORAGE_BYTES = 1024 * 1024

interface Entry {
  manifest: PluginManifest
  dir: string
  source: PluginSource
  status: PluginStatus
  error?: string
  proc?: PluginProcess
  conn?: PluginConnection
  blockIds: string[]
  crashes: number[]
  restartTimer?: ReturnType<typeof setTimeout>
  stopping?: boolean
  unwatch?: () => void
}

export interface ManagerOptions {
  dataDir: string
  /** Folders holding first-party plugins, one subfolder each. */
  builtinDirs: string[]
  spawn: Spawn
  os: OS
  registry: BlockRegistry
  logger: Logger
  /** Shows a plugin's permissions and resolves true if the user allows them. */
  confirmPermissions: (manifest: PluginManifest) => Promise<boolean>
  /** Calls back when files in a dev plugin change. */
  watch?: (dir: string, onChange: () => void) => () => void
  onChange(): void
  onEvent(subscriptionId: string, values: Record<string, unknown>): void
  /** A plugin trigger set tile state outside a run (active profile). */
  onTileState(tileId: string, key: string, value: unknown): void
  now?: () => number
  /** Wait before each restart after a crash; one crash more than this list gives up. */
  restartDelaysMs?: number[]
}

export class PluginError extends Error {}

const permissive = z.record(z.string(), z.unknown())

async function readManifest(dir: string): Promise<PluginManifest> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  } catch {
    throw new PluginError('That folder has no readable manifest.json.')
  }
  const parsed = PluginManifest.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new PluginError(
      `manifest.json: ${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'invalid'}`,
    )
  }
  return parsed.data
}

/** Runs plugins in their own processes, registers their blocks, and restarts them if they crash. */
export class PluginManager {
  private entries = new Map<string, Entry>()
  private state: Record<string, PluginState> = {}
  private store: JsonStore<z.infer<typeof PluginsFile>>
  private storage = new Map<string, JsonStore<Record<string, unknown>>>()
  private calls = new Map<string, RunContext>()
  private subscriptions = new Map<string, Subscription[]>()
  private now: () => number

  constructor(private opts: ManagerOptions) {
    this.now = opts.now ?? Date.now
    this.store = createJsonStore({
      file: join(opts.dataDir, 'plugins.json'),
      schemaVersion: 1,
      schema: PluginsFile,
      defaults: () => ({ plugins: {} }),
    })
  }

  private get installDir() {
    return join(this.opts.dataDir, 'plugins')
  }

  async load() {
    this.state = (await this.store.load()).plugins
    const found: Array<{ dir: string; source: PluginSource }> = []
    for (const base of this.opts.builtinDirs)
      found.push(...(await subfolders(base)).map((dir) => ({ dir, source: 'built-in' as const })))
    found.push(
      ...(await subfolders(this.installDir)).map((dir) => ({ dir, source: 'installed' as const })),
    )
    for (const [, s] of Object.entries(this.state))
      if (s.devPath) found.push({ dir: s.devPath, source: 'dev' })

    for (const { dir, source } of found) {
      try {
        const manifest = await readManifest(dir)
        if (this.entries.has(manifest.id)) {
          this.opts.logger.warn(`Plugin "${manifest.id}" is installed twice; using the first one`)
          continue
        }
        this.entries.set(manifest.id, {
          manifest,
          dir,
          source,
          status: 'stopped',
          blockIds: [],
          crashes: [],
        })
        // First-party plugins are trusted and on by default.
        if (source === 'built-in' && !this.state[manifest.id])
          this.state[manifest.id] = { enabled: true, granted: true, settings: {} }
      } catch (err) {
        this.opts.logger.warn(`Skipped plugin in ${dir}: ${(err as Error).message}`)
      }
    }
    await this.save()
    await Promise.all(
      [...this.entries.values()]
        .filter((e) => this.state[e.manifest.id]?.enabled && this.state[e.manifest.id]?.granted)
        .map((e) => this.start(e)),
    )
    this.watchDevPlugins()
  }

  list(): PluginInfo[] {
    return [...this.entries.values()]
      .map((e) => {
        const s = this.state[e.manifest.id]
        const m = e.manifest
        const info: PluginInfo = {
          id: m.id,
          name: m.name,
          version: m.version,
          description: m.description,
          source: e.source,
          permissions: m.permissions,
          enabled: s?.enabled ?? false,
          status: e.status,
          blockCount: e.blockIds.length,
          settings: cleanSettings(m.settingsSchema, s?.settings ?? {}),
        }
        if (m.author) info.author = m.author
        if (m.icon) info.icon = m.icon
        if (m.platforms) info.platforms = m.platforms
        if (m.settingsSchema) info.settingsSchema = m.settingsSchema
        if (e.error) info.error = e.error
        return info
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    const entry = this.entries.get(id)
    const s = this.state[id]
    if (!entry || !s) return
    if (on && !s.granted) {
      if (!(await this.opts.confirmPermissions(entry.manifest))) return
      s.granted = true
    }
    s.enabled = on
    await this.save()
    if (on) {
      entry.crashes = []
      await this.start(entry)
    } else await this.stop(entry)
    this.opts.onChange()
  }

  async restart(id: string) {
    const entry = this.entries.get(id)
    if (!entry || !this.state[id]?.enabled) return
    await this.stop(entry)
    entry.crashes = []
    await this.start(entry)
  }

  async updateSettings(id: string, values: Record<string, unknown>) {
    const entry = this.entries.get(id)
    const s = this.state[id]
    if (!entry || !s) return
    s.settings = cleanSettings(entry.manifest.settingsSchema, values)
    await this.save()
    if (entry.status === 'running')
      await entry.conn?.call('settings', { settings: s.settings }).catch(() => {})
    this.opts.onChange()
  }

  /** Copies a plugin folder into Tessel's plugin folder after the user allows its permissions. */
  async installFolder(dir: string, confirmed = false): Promise<string> {
    const manifest = await readManifest(dir)
    const existing = this.entries.get(manifest.id)
    if (existing && existing.source !== 'installed') {
      throw new PluginError(`A ${existing.source} plugin called "${manifest.id}" is already here.`)
    }
    if (!confirmed && !(await this.opts.confirmPermissions(manifest)))
      throw new PluginError('Install cancelled.')
    if (existing) await this.forget(existing)
    const target = join(this.installDir, manifest.id)
    await rm(target, { recursive: true, force: true })
    await mkdir(this.installDir, { recursive: true })
    await cp(dir, target, { recursive: true, filter: (src) => !src.split(sep).includes('.git') })
    const entry: Entry = {
      manifest,
      dir: target,
      source: 'installed',
      status: 'stopped',
      blockIds: [],
      crashes: [],
    }
    this.entries.set(manifest.id, entry)
    this.state[manifest.id] = {
      enabled: true,
      granted: true,
      settings: this.state[manifest.id]?.settings ?? {},
    }
    await this.save()
    await this.start(entry)
    this.opts.logger.info(`Installed plugin "${manifest.name}"`)
    this.opts.onChange()
    return manifest.id
  }

  /** Unpacks a plugin zip safely, then installs it like a folder. */
  async installZip(bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > MAX_ZIP_BYTES) throw new PluginError('That zip is too big for a plugin.')
    let files: Record<string, Uint8Array>
    let total = 0
    try {
      files = unzipSync(bytes, {
        filter: (f) => {
          total += f.originalSize
          return total <= MAX_UNZIPPED_BYTES
        },
      })
    } catch {
      throw new PluginError("That file isn't a zip.")
    }
    if (total > MAX_UNZIPPED_BYTES) throw new PluginError('That zip unpacks to more than 200 MB.')
    const names = Object.keys(files).filter((n) => !n.endsWith('/'))
    // Allow both a zip of the folder and a zip of its contents.
    const first = names[0]?.split('/')[0]
    const prefix =
      first && names.every((n) => n.startsWith(`${first}/`)) && !names.includes('manifest.json')
        ? `${first}/`
        : ''
    const temp = join(this.opts.dataDir, 'tmp', randomUUID())
    try {
      for (const name of names) {
        const rel = normalize(name.slice(prefix.length))
        if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))
          throw new PluginError('That zip has unsafe file paths.')
        const dest = join(temp, rel)
        if (relative(temp, dest).startsWith('..'))
          throw new PluginError('That zip has unsafe file paths.')
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, files[name] as Uint8Array)
      }
      if (!files[`${prefix}manifest.json`]) throw new PluginError('That zip has no manifest.json.')
      return await this.installFolder(temp)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }

  /** Uses a plugin straight from its folder and restarts it when files change. */
  async addDev(dir: string): Promise<string> {
    const manifest = await readManifest(dir)
    const existing = this.entries.get(manifest.id)
    if (existing && existing.source !== 'dev')
      throw new PluginError(`A plugin called "${manifest.id}" is already installed.`)
    if (!(await this.opts.confirmPermissions(manifest))) throw new PluginError('Cancelled.')
    if (existing) await this.forget(existing)
    const entry: Entry = {
      manifest,
      dir,
      source: 'dev',
      status: 'stopped',
      blockIds: [],
      crashes: [],
    }
    this.entries.set(manifest.id, entry)
    this.state[manifest.id] = { enabled: true, granted: true, settings: {}, devPath: dir }
    await this.save()
    await this.start(entry)
    this.watchDevPlugins()
    this.opts.onChange()
    return manifest.id
  }

  async remove(id: string) {
    const entry = this.entries.get(id)
    if (!entry || entry.source === 'built-in') return
    await this.forget(entry)
    if (
      entry.source === 'installed' &&
      relative(this.installDir, entry.dir).split(sep)[0] !== '..'
    ) {
      await rm(entry.dir, { recursive: true, force: true })
    }
    const { [id]: _removed, ...rest } = this.state
    this.state = rest
    await this.save()
    this.opts.logger.info(`Removed plugin "${entry.manifest.name}"`)
    this.opts.onChange()
  }

  /** Trigger blocks on the active profile, grouped by plugin. Sent again after restarts. */
  setSubscriptions(subs: Subscription[]) {
    const byPlugin = new Map<string, Subscription[]>()
    for (const sub of subs) {
      const [pluginId = '', trigger = ''] = splitId(sub.trigger)
      byPlugin.set(pluginId, [...(byPlugin.get(pluginId) ?? []), { ...sub, trigger }])
    }
    for (const id of new Set([...this.subscriptions.keys(), ...byPlugin.keys()])) {
      const next = byPlugin.get(id) ?? []
      this.subscriptions.set(id, next)
      const entry = this.entries.get(id)
      if (entry?.status === 'running')
        void entry.conn?.call('subscribe', { subscriptions: next }).catch(() => {})
    }
  }

  async dispose() {
    await Promise.all([...this.entries.values()].map((e) => this.stop(e)))
    for (const e of this.entries.values()) e.unwatch?.()
  }

  private async forget(entry: Entry) {
    entry.unwatch?.()
    await this.stop(entry)
    this.entries.delete(entry.manifest.id)
  }

  private async save() {
    await this.store.save({ plugins: this.state })
  }

  private async start(entry: Entry) {
    const id = entry.manifest.id
    clearTimeout(entry.restartTimer)
    entry.stopping = false
    entry.status = 'starting'
    delete entry.error
    this.opts.onChange()
    const proc = this.opts.spawn({
      dir: entry.dir,
      name: entry.manifest.name,
      permissions: entry.manifest.permissions,
    })
    entry.proc = proc
    const conn = new PluginConnection(proc, {
      onNotification: (n) => this.onNotification(entry, n),
      onRequest: (method, params) => this.onRequest(id, method, params),
    })
    entry.conn = conn
    proc.onExit((code) => this.onExit(entry, proc, code))
    try {
      await conn.call(
        'init',
        {
          pluginId: id,
          os: this.opts.os,
          settings: cleanSettings(entry.manifest.settingsSchema, this.state[id]?.settings ?? {}),
        },
        { timeoutMs: START_TIMEOUT_MS },
      )
      const description = await conn.call('describe', null, { timeoutMs: START_TIMEOUT_MS })
      if (entry.proc !== proc) return
      this.register(entry, description)
      entry.status = 'running'
      await conn
        .call('subscribe', { subscriptions: this.subscriptions.get(id) ?? [] })
        .catch(() => {})
      this.opts.logger.info(`Plugin "${entry.manifest.name}" started`)
    } catch (err) {
      if (entry.proc !== proc) return
      entry.error = (err as Error).message
      this.opts.logger.error(`Plugin "${entry.manifest.name}" didn't start: ${entry.error}`)
      proc.kill()
    }
    this.opts.onChange()
  }

  private async stop(entry: Entry) {
    clearTimeout(entry.restartTimer)
    const { conn, proc } = entry
    entry.stopping = true
    this.unregister(entry)
    entry.status = 'stopped'
    entry.proc = undefined
    entry.conn = undefined
    if (!proc || !conn) return
    await conn.call('shutdown', null, { timeoutMs: 2000 }).catch(() => {})
    proc.kill()
  }

  private onExit(entry: Entry, proc: PluginProcess, code: number | null) {
    if (entry.proc !== proc) return
    entry.conn?.close(`Plugin "${entry.manifest.name}" stopped`)
    entry.proc = undefined
    entry.conn = undefined
    this.unregister(entry)
    if (entry.stopping) return
    const detail = proc.errorOutput().trim().split('\n').at(-1)
    entry.error =
      entry.error ?? `It quit unexpectedly (code ${code ?? 'none'})${detail ? `: ${detail}` : ''}`
    const now = this.now()
    entry.crashes = [...entry.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now]
    const delays = this.opts.restartDelaysMs ?? RESTART_DELAYS_MS
    if (entry.crashes.length > delays.length) {
      entry.status = 'failed'
      this.opts.logger.error(
        `Plugin "${entry.manifest.name}" keeps crashing, so it was stopped. ${entry.error}`,
      )
    } else {
      entry.status = 'crashed'
      const delay = delays[entry.crashes.length - 1] ?? 16_000
      this.opts.logger.warn(
        `Plugin "${entry.manifest.name}" crashed; restarting in ${delay / 1000} s. ${entry.error}`,
      )
      entry.restartTimer = setTimeout(() => void this.start(entry), delay)
    }
    this.opts.onChange()
  }

  private onNotification(entry: Entry, n: Notification) {
    const name = entry.manifest.name
    switch (n.method) {
      case 'log':
        this.opts.logger[n.params.level](`${name}: ${n.params.message}`)
        return
      case 'event':
        this.opts.onEvent(n.params.subscriptionId, n.params.values)
        return
      case 'tileState': {
        const { callId, tileId, key, value } = n.params
        const ctx = callId ? this.calls.get(callId) : undefined
        if (ctx) ctx.tileState.set(key, value)
        else if (tileId) this.opts.onTileState(tileId, key, value)
      }
    }
  }

  private async onRequest(pluginId: string, method: string, params: unknown): Promise<unknown> {
    const store = this.storeFor(pluginId)
    const { key, value } = (params ?? {}) as { key?: string; value?: unknown }
    if (typeof key !== 'string' || key.length > 200)
      throw new Error('Storage keys must be text up to 200 characters')
    const data = await store.load()
    switch (method) {
      case 'storage.get':
        return data[key] ?? null
      case 'storage.set': {
        const next = { ...data, [key]: value }
        if (JSON.stringify(next).length > MAX_STORAGE_BYTES)
          throw new Error('Plugin storage is limited to 1 MB')
        await store.save(next)
        return null
      }
      case 'storage.delete': {
        const { [key]: _, ...rest } = data
        await store.save(rest)
        return null
      }
      default:
        throw new Error(`Unknown method "${method}"`)
    }
  }

  private storeFor(pluginId: string) {
    let store = this.storage.get(pluginId)
    if (!store) {
      store = createJsonStore({
        file: join(this.opts.dataDir, 'plugin-data', `${pluginId}.json`),
        schemaVersion: 1,
        schema: z.record(z.string(), z.unknown()),
        defaults: () => ({}),
      })
      this.storage.set(pluginId, store)
    }
    return store
  }

  /** Adds the plugin's blocks and triggers to the registry under "<plugin>.<block>". */
  private register(entry: Entry, description: Description) {
    this.unregister(entry)
    const pluginId = entry.manifest.id
    const blocks: BlockDefinition[] = [
      ...description.blocks.map((b): BlockDefinition => ({
        ...b,
        id: `${pluginId}.${b.id}`,
        category: 'plugin',
        paramsSchema: permissive,
        run: (ctx, params, input) => {
          if (b.timeoutSeconds) ctx.extendTimeout(Math.min(600, b.timeoutSeconds) * 1000)
          return this.run(entry, b.id, ctx, params as Record<string, unknown>, input)
        },
      })),
      ...description.triggers.map((t): BlockDefinition => ({
        ...t,
        id: `${pluginId}.${t.id}`,
        category: 'plugin',
        trigger: 'plugin',
        inputs: [],
        paramsSchema: permissive,
        run: (ctx) => ({ values: ctx.trigger.data ?? {} }),
      })),
    ]
    for (const block of blocks) {
      this.opts.registry.unregister(block.id)
      this.opts.registry.register(block)
    }
    entry.blockIds = blocks.map((b) => b.id)
  }

  private unregister(entry: Entry) {
    for (const id of entry.blockIds) this.opts.registry.unregister(id)
    entry.blockIds = []
  }

  private async run(
    entry: Entry,
    block: string,
    ctx: RunContext,
    params: Record<string, unknown>,
    input: Record<string, unknown>,
  ) {
    const conn = entry.conn
    if (!conn || entry.status !== 'running')
      throw new PluginError(`The ${entry.manifest.name} plugin isn't running`)
    const callId = randomUUID()
    this.calls.set(callId, ctx)
    const onAbort = () => void conn.call('cancel', { callId }).catch(() => {})
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    try {
      // The engine's own timeout bounds this call, so no separate one here.
      return await conn.call(
        'run',
        { callId, block, tileId: ctx.tileId, params, input: jsonSafe(input) },
        { timeoutMs: 0, signal: ctx.signal },
      )
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
      this.calls.delete(callId)
    }
  }

  private watchDevPlugins() {
    for (const entry of this.entries.values()) {
      if (entry.source !== 'dev' || entry.unwatch || !this.opts.watch) continue
      let timer: ReturnType<typeof setTimeout> | undefined
      entry.unwatch = this.opts.watch(entry.dir, () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          this.opts.logger.info(`Reloading dev plugin "${entry.manifest.name}"`)
          void this.restart(entry.manifest.id)
        }, 300)
      })
    }
  }
}

async function subfolders(base: string): Promise<string[]> {
  const items = await readdir(base, { withFileTypes: true }).catch(() => [])
  return items.filter((d) => d.isDirectory()).map((d) => join(base, d.name))
}

const splitId = (id: string) => {
  const i = id.indexOf('.')
  return [id.slice(0, i), id.slice(i + 1)] as const
}

/** Values crossing to the plugin must survive structured cloning and JSON. */
const jsonSafe = (v: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(v, (_k, x: unknown) => (x === undefined ? null : x))) as Record<
    string,
    unknown
  >
