// Checks GitHub releases for a newer Tessel. Windows and Linux (AppImage) download it in the
// background and install on restart. macOS only says it's there: installing an update in place
// needs a signed app, and builds aren't signed yet.
import { app, Notification, shell } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export const RELEASES_URL = 'https://github.com/wrlliam/tessel/releases/latest'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 15_000

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none'; checkedAt: number }
  | { status: 'available'; version: string; canInstall: boolean }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

export class Updater {
  state: UpdateState = { status: 'idle' }
  private timer?: NodeJS.Timeout
  /** Installing in place works where the app can replace itself. */
  readonly canInstall = process.platform !== 'darwin'

  constructor(private onChange: () => void) {
    autoUpdater.autoDownload = this.canInstall
    autoUpdater.autoInstallOnAppQuit = this.canInstall
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () =>
      this.set({ status: 'none', checkedAt: Date.now() }),
    )
    autoUpdater.on('update-available', (info) => {
      this.set({ status: 'available', version: info.version, canInstall: this.canInstall })
      if (!this.canInstall)
        this.notify(`Tessel ${info.version} is out`, 'Open Settings to download it.')
    })
    autoUpdater.on('download-progress', (p) => {
      const version = 'version' in this.state ? this.state.version : ''
      this.set({ status: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', version: info.version })
      this.notify(`Tessel ${info.version} is ready`, 'Restart Tessel to finish updating.')
    })
    autoUpdater.on('error', (err) =>
      this.set({
        status: 'error',
        message: friendly(err instanceof Error ? err.message : String(err)),
      }),
    )
  }

  /** Checks now and then every few hours. Does nothing in development. */
  start(enabled: () => boolean) {
    if (!app.isPackaged) return
    const check = () => {
      if (enabled()) void this.check()
    }
    setTimeout(check, FIRST_CHECK_MS)
    this.timer = setInterval(check, CHECK_EVERY_MS)
  }

  stop() {
    clearInterval(this.timer)
  }

  async check() {
    if (!app.isPackaged) {
      this.set({ status: 'error', message: 'Updates are checked in the installed app only.' })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ status: 'error', message: friendly((err as Error).message) })
    }
  }

  /** Restarts into the downloaded version, or opens the download page where that isn't possible. */
  install() {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall()
    else void shell.openExternal(RELEASES_URL)
  }

  private set(state: UpdateState) {
    this.state = state
    this.onChange()
  }

  private notify(title: string, body: string) {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }
}

function friendly(message: string): string {
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(message))
    return "Couldn't reach GitHub. Check the internet connection."
  if (/404|latest.*\.yml/i.test(message)) return 'No release with update info yet.'
  return message.split('\n')[0] ?? message
}
