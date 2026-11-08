export type OS = 'darwin' | 'win32' | 'linux'

export const osName: Record<OS, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta'

export interface KeyCombo {
  modifiers: Modifier[]
  /** Normalised key name, see KEY_NAMES. */
  key: string
}

export type OnOff = boolean | 'toggle'

export type MediaKey =
  'playPause' | 'next' | 'previous' | 'stop' | 'volumeUp' | 'volumeDown' | 'mute'

export type MouseAction =
  | { kind: 'click' | 'doubleClick' | 'rightClick' | 'middleClick' }
  | { kind: 'move'; x: number; y: number }

export interface HttpRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

export interface HttpResponse {
  status: number
  body: string
}

export interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

export interface NowPlayingInfo {
  title: string
  artist: string
  album?: string
  app?: string
  playing: boolean
  /** Seconds. */
  position?: number
  duration?: number
}

export type ToastPosition =
  'top-right' | 'top-left' | 'top-center' | 'bottom-right' | 'bottom-left' | 'bottom-center'

/** A message shown on the computer's screen above other windows, then gone. */
export interface ToastSpec {
  title: string
  body: string
  /** One emoji, shown beside the text. */
  icon?: string
  /** Accent colour, like #22D3C5. */
  colour?: string
  seconds: number
  position: ToastPosition
}

/** What blocks may ask of the computer. Each OS supplies its own adapter. */
export interface Platform {
  os: OS
  openApp(app: string): Promise<void>
  openUrl(url: string): Promise<void>
  openFile(path: string): Promise<void>
  typeText(text: string): Promise<void>
  pressCombo(combo: KeyCombo): Promise<void>
  mediaKey(key: MediaKey): Promise<void>
  mouse(action: MouseAction): Promise<void>
  setDarkMode(on: OnOff): Promise<void>
  setMuted(on: OnOff): Promise<void>
  /** 0 to 100. */
  setVolume(level: number): Promise<void>
  /** 0 to 100. Best effort: often only built-in laptop screens. */
  setBrightness(level: number): Promise<void>
  lockScreen(): Promise<void>
  sleep(): Promise<void>
  setClipboard(text: string): Promise<void>
  notify(title: string, body: string): Promise<void>
  /** Runs a command the user wrote on a tile. The desktop decides whether shell commands are allowed. */
  runShell(command: string, signal: AbortSignal): Promise<ShellResult>
  http(request: HttpRequest): Promise<HttpResponse>
  /** The song playing in Spotify or the system's media player, if any. */
  nowPlaying?(): Promise<NowPlayingInfo | undefined>
  readClipboard?(): Promise<string>
  /** Runs a zx script (JavaScript with $`command`); the desktop decides whether scripts may run. */
  runZx?(
    script: string,
    opts: { input?: unknown; cwd?: string; signal: AbortSignal },
  ): Promise<{ result: unknown; output: string }>
  /** Shows a pop-up message on the computer's screen. */
  toast?(toast: ToastSpec): Promise<void>
  /** Last known location, e.g. shared by a phone. */
  location?(): { lat: number; lon: number; name?: string } | undefined
}

/** Thrown when a feature has no implementation on this OS; shown to the user as-is. */
export class UnsupportedError extends Error {
  constructor(feature: string, os: OS) {
    super(`${feature} isn't supported on ${osName[os]}.`)
  }
}

/** A failure with a message written for the user rather than a stack trace. */
export class UserFacingError extends Error {}
