import { UserFacingError } from '@tessel/core'
import type { Launch, Run } from './exec.ts'

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
      // Explorer exits with code 1 even on success, so don't wait on it.
      deps.launch('explorer.exe', [`shell:AppsFolder\\${match.AppID}`])
    },

    async setDarkMode(on: boolean) {
      const light = on ? '0' : '1'
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
  }
}
