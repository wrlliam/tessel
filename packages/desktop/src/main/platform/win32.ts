import { UserFacingError, type OnOff } from '@tessel/core'
import type { Launch, Run } from './exec.ts'
import { readVolumeScript, muteScript, volumeScript } from './win-audio.ts'

interface StartApp {
  Name: string
  AppID: string
}

const CACHE_MS = 60_000
const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

export function pickStartApp(apps: StartApp[], query: string): StartApp | undefined {
  const q = query.trim().toLowerCase()
  const name = (a: StartApp) => a.Name.toLowerCase()
  return (
    apps.find((a) => name(a) === q) ??
    apps.find((a) => name(a).startsWith(q)) ??
    apps.find((a) => name(a).includes(q))
  )
}

export function createWin32(deps: {
  run: Run
  launch: Launch
  openPath: (path: string) => Promise<string>
}) {
  let cache: { at: number; apps: StartApp[] } | undefined
  const powershell = (command: string) =>
    deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])

  // Get-StartApps lists both classic and Store apps with the ID Explorer needs to launch them.
  async function startApps(): Promise<StartApp[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.apps
    const { stdout } = await deps.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress',
    ])
    const parsed = JSON.parse(stdout || '[]') as StartApp | StartApp[]
    const apps = Array.isArray(parsed) ? parsed : [parsed]
    cache = { at: Date.now(), apps }
    return apps
  }

  return {
    async openApp(app: string) {
      if (/[\\/]/.test(app) || /\.(exe|lnk|bat|cmd|url)$/i.test(app)) {
        const error = await deps.openPath(app)
        if (error) throw new UserFacingError(`Couldn't open "${app}": ${error}`)
        return
      }
      const match = pickStartApp(await startApps(), app)
      if (!match)
        throw new UserFacingError(
          `Couldn't find "${app}" in the Start menu. Check the name, or use the full path to the .exe.`,
        )
      // Start-Process shows the app's window normally. (Launching through a hidden helper
      // window could start the app hidden, so it looked like nothing happened.)
      await deps.run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath 'shell:AppsFolder\\${match.AppID.replace(/'/g, "''")}'`,
      ])
    },

    async setDarkMode(on: OnOff) {
      let dark = on
      if (dark === 'toggle') {
        const { stdout } = await deps.run('reg.exe', [
          'query',
          PERSONALIZE,
          '/v',
          'AppsUseLightTheme',
        ])
        dark = /0x1\b/.test(stdout)
      }
      const light = dark ? '0' : '1'
      for (const value of ['AppsUseLightTheme', 'SystemUsesLightTheme']) {
        await deps.run('reg.exe', [
          'add',
          PERSONALIZE,
          '/v',
          value,
          '/t',
          'REG_DWORD',
          '/d',
          light,
          '/f',
        ])
      }
    },

    setVolume: async (level: number) => {
      await powershell(volumeScript(level))
    },

    async getVolume() {
      const { stdout } = await powershell(readVolumeScript)
      const [level, muted] = stdout.trim().split(',')
      return { level: Number(level) || 0, muted: muted?.trim().toLowerCase() === 'true' }
    },

    setMuted: async (on: OnOff) => {
      await powershell(muteScript(on))
    },

    async setBrightness(level: number) {
      try {
        await powershell(
          `Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = ${Math.round(level)} } -ErrorAction Stop | Out-Null`,
        )
      } catch {
        throw new UserFacingError(
          'Windows can only change the brightness of built-in laptop screens.',
        )
      }
    },

    lockScreen: async () => {
      await deps.run('rundll32.exe', ['user32.dll,LockWorkStation'])
    },

    sleep: async () => {
      await powershell(
        "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
      )
    },
  }
}
