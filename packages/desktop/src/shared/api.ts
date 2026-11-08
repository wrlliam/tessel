import type {
  Appearance,
  BlockDescriptor,
  EngineEvent,
  Graph,
  GraphIssue,
  JsonValue,
  Profile,
} from '@tessel/core'
import type { PairingCode } from '@tessel/server'

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
  allowPhones: boolean
  listening: boolean
  port: number
  serverError?: string
  urls: string[]
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
}

export type SaveResult = { ok: true } | { ok: false; error: string }

export const Channel = {
  getState: 'state:get',
  state: 'state:changed',
  setAllowPhones: 'phones:allow',
  setPaused: 'tiles:pause',
  setStartOnLogin: 'app:start-on-login',
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
} as const
