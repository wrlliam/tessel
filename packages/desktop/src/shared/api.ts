import type {
  Appearance,
  BlockDescriptor,
  EngineEvent,
  Graph,
  GraphIssue,
  JsonValue,
  PhoneSettings,
  Profile,
} from '@tessel/core'
import type { PairingCode } from '@tessel/server'
import type { PluginInfo } from '../main/plugins/manager.ts'
import type { UpdateState } from '../main/updater.ts'

export type { PluginInfo, UpdateState }

export interface LogEntry {
  id: number
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface PhoneDevice {
  id: string
  name: string
  pairedAt: number
  lastSeenAt: number | null
  online: boolean
}

export interface DesktopState {
  platform: NodeJS.Platform
  /** Set when key and mouse simulation works differently here, e.g. on Wayland. */
  inputNote?: string
  allowPhones: boolean
  listening: boolean
  port: number
  serverError?: string
  urls: string[]
  /** Where phones download Tessel's certificate, when secure connections are on. */
  caUrl?: string
  /** PNG data URL of the QR code for each entry in `urls`. */
  qrCodes: Record<string, string>
  pairing: PairingCode
  devices: PhoneDevice[]
  paused: boolean
  startOnLogin: boolean | null
  log: LogEntry[]
  profiles: Array<{ id: string; name: string }>
  /** The profile phones see and press. */
  activeProfileId: string
  /** Tiles in the active profile that currently look different from their settings. */
  liveAppearance: Record<string, Appearance>
  settings: AppSettings
  plugins: PluginInfo[]
  phoneSettings: PhoneSettings
  /** Where a phone last said it was, when Share location is on. */
  location?: { lat: number; lon: number; at: number }
  /** First-run tour finished or skipped. */
  toured: boolean
  version: string
  update: UpdateState
  /** Changes when plugin blocks are added or removed. */
  blocksVersion: number
}

export interface AppSettings {
  shell: 'off' | 'confirm' | 'on'
  theme: 'system' | 'dark' | 'light'
  logLevel: 'info' | 'warn' | 'error'
  /** Serve https:// as well, with a certificate phones install once. */
  https: boolean
  /** Check GitHub for new versions every few hours. */
  autoUpdate: boolean
}

export interface ProfileEngineEvent {
  profileId: string
  event: EngineEvent
}

export type ImportResult =
  { ok: true; id: string } | { ok: false; error: string } | { ok: false; cancelled: true }

/** Everything the renderer may ask the main process to do. */
export interface TesselApi {
  getState(): Promise<DesktopState>
  onState(listener: (state: DesktopState) => void): () => void
  setAllowPhones(on: boolean): Promise<void>
  setPaused(on: boolean): Promise<void>
  setStartOnLogin(on: boolean): Promise<void>
  /** Port and app settings. A new port restarts sharing. */
  updateSettings(patch: Partial<AppSettings & { port: number }>): Promise<SaveResult>
  newPairingCode(): Promise<void>
  revokeDevice(id: string): Promise<void>
  getBlocks(): Promise<BlockDescriptor[]>
  getProfile(id: string): Promise<Profile | undefined>
  saveProfile(profile: Profile): Promise<SaveResult>
  createProfile(name: string): Promise<string>
  duplicateProfile(id: string): Promise<string | undefined>
  deleteProfile(id: string): Promise<boolean>
  setActiveProfile(id: string): Promise<void>
  /** Opens a save dialog. Resolves false if cancelled. */
  exportProfile(id: string): Promise<boolean>
  /** Opens a file dialog, shows what the profile can do and asks before adding it. */
  importProfile(): Promise<ImportResult>
  addVariables(profileId: string, values: Record<string, JsonValue>): Promise<void>
  validateGraph(graph: Graph): Promise<GraphIssue[]>
  /** Runs the saved tile as if it were pressed. */
  testRun(profileId: string, tileId: string): Promise<void>
  stopTile(profileId: string, tileId: string): Promise<void>
  onEngineEvent(listener: (event: ProfileEngineEvent) => void): () => void
  setPluginEnabled(id: string, on: boolean): Promise<SaveResult>
  restartPlugin(id: string): Promise<void>
  removePlugin(id: string): Promise<void>
  /** Opens a picker. kind 'dev' uses the folder in place and reloads it when files change. */
  addPlugin(kind: 'folder' | 'zip' | 'dev'): Promise<SaveResult | { ok: false; cancelled: true }>
  updatePluginSettings(id: string, values: Record<string, unknown>): Promise<void>
  /** Changes how connected phones look and behave. */
  updatePhoneSettings(patch: Partial<PhoneSettings>): Promise<SaveResult>
  finishTour(): Promise<void>
  checkForUpdate(): Promise<void>
  /** Restarts into a downloaded update, or opens the download page. */
  installUpdate(): Promise<void>
}

export type SaveResult = { ok: true } | { ok: false; error: string }

export const Channel = {
  getState: 'state:get',
  state: 'state:changed',
  setAllowPhones: 'phones:allow',
  setPaused: 'tiles:pause',
  setStartOnLogin: 'app:start-on-login',
  updateSettings: 'app:settings',
  newPairingCode: 'pairing:new-code',
  revokeDevice: 'devices:revoke',
  getBlocks: 'blocks:list',
  getProfile: 'profile:get',
  saveProfile: 'profile:save',
  createProfile: 'profile:create',
  duplicateProfile: 'profile:duplicate',
  deleteProfile: 'profile:delete',
  setActiveProfile: 'profile:activate',
  exportProfile: 'profile:export',
  importProfile: 'profile:import',
  addVariables: 'profile:add-variables',
  validateGraph: 'graph:validate',
  testRun: 'tile:test-run',
  stopTile: 'tile:stop',
  engineEvent: 'engine:event',
  setPluginEnabled: 'plugins:enable',
  restartPlugin: 'plugins:restart',
  removePlugin: 'plugins:remove',
  addPlugin: 'plugins:add',
  updatePluginSettings: 'plugins:settings',
  updatePhoneSettings: 'phone:settings',
  finishTour: 'app:tour-done',
  checkForUpdate: 'update:check',
  installUpdate: 'update:install',
} as const
