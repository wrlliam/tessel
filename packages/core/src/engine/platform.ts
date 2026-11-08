export type OS = 'darwin' | 'win32' | 'linux'

export const osName: Record<OS, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta'

export interface KeyCombo {
  modifiers: Modifier[]
  /** Normalised key name, see KEY_NAMES. */
  key: string
}

/** What blocks may ask of the computer. Each OS supplies its own adapter. */
export interface Platform {
  os: OS
  openApp(app: string): Promise<void>
  typeText(text: string): Promise<void>
  pressCombo(combo: KeyCombo): Promise<void>
  setDarkMode(on: boolean): Promise<void>
}

/** Thrown when a feature has no implementation on this OS; shown to the user as-is. */
export class UnsupportedError extends Error {
  constructor(feature: string, os: OS) {
    super(`${feature} isn't supported on ${osName[os]}.`)
  }
}

/** A failure with a message written for the user rather than a stack trace. */
export class UserFacingError extends Error {}
