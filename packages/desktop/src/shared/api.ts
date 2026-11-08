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
}

/** Everything the renderer may ask the main process to do. */
export interface TesselApi {
  getState(): Promise<DesktopState>
  onState(listener: (state: DesktopState) => void): () => void
  setAllowPhones(on: boolean): Promise<void>
  setPaused(on: boolean): Promise<void>
  setStartOnLogin(on: boolean): Promise<void>
  newPairingCode(): Promise<void>
  revokeDevice(id: string): Promise<void>
}

export const Channel = {
  getState: 'state:get',
  state: 'state:changed',
  setAllowPhones: 'phones:allow',
  setPaused: 'tiles:pause',
  setStartOnLogin: 'app:start-on-login',
  newPairingCode: 'pairing:new-code',
  revokeDevice: 'devices:revoke',
} as const
