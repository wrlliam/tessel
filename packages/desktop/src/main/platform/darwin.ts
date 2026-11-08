import { UserFacingError } from '@tessel/core'
import type { Run } from './exec.ts'

export function createDarwin(deps: { run: Run }) {
  return {
    async openApp(app: string) {
      const isPath = app.startsWith('/') || app.endsWith('.app')
      try {
        await deps.run('open', isPath ? [app] : ['-a', app])
      } catch {
        throw new UserFacingError(
          `Couldn't find an app called "${app}". Check the name in your Applications folder.`,
        )
      }
    },

    async setDarkMode(on: boolean) {
      const script = `tell application "System Events" to tell appearance preferences to set dark mode to ${on}`
      try {
        await deps.run('osascript', ['-e', script])
      } catch (err) {
        if (String((err as Error).message).includes('-1743')) {
          throw new UserFacingError(
            'Tessel needs permission to change appearance. Allow it in System Settings › Privacy & Security › Automation › System Events.',
          )
        }
        throw err
      }
    },
  }
}
