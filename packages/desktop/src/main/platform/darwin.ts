import { UserFacingError, type OnOff } from '@tessel/core'
import { isMissingProgram, type Run } from './exec.ts'

const ACCESSIBILITY =
  'Tessel needs Accessibility permission for this. Turn it on in System Settings › Privacy & Security › Accessibility.'

export function createDarwin(deps: { run: Run }) {
  async function script(source: string) {
    try {
      await deps.run('osascript', ['-e', source])
    } catch (err) {
      const message = String((err as Error).message)
      if (message.includes('-1743')) {
        throw new UserFacingError(
          'Tessel needs permission to control System Events. Allow it in System Settings › Privacy & Security › Automation.',
        )
      }
      if (message.includes('-1719') || message.includes('-25211'))
        throw new UserFacingError(ACCESSIBILITY)
      throw err
    }
  }

  return {
    async openApp(app: string) {
      const isPath = app.startsWith('/') || app.endsWith('.app')
      try {
        await deps.run('open', isPath ? [app] : ['-a', app])
        return
      } catch {
        // The name may differ in case or spacing from the app's file name; ask Spotlight.
      }
      const found = isPath
        ? ''
        : (
            await deps
              .run('mdfind', [
                `kMDItemContentType == "com.apple.application-bundle" && kMDItemDisplayName == "${app.replace(/"/g, '')}*"cd`,
              ])
              .catch(() => ({ stdout: '' }))
          ).stdout
            .split('\n')
            .find((l) => l.endsWith('.app'))
      if (found) {
        await deps.run('open', [found])
        return
      }
      throw new UserFacingError(
        `Couldn't find an app called "${app}". Check the name in your Applications folder.`,
      )
    },

    setDarkMode: (on: OnOff) =>
      script(
        `tell application "System Events" to tell appearance preferences to set dark mode to ${on === 'toggle' ? 'not dark mode' : on}`,
      ),

    setMuted: (on: OnOff) =>
      script(
        `set volume output muted ${on === 'toggle' ? 'not (output muted of (get volume settings))' : on}`,
      ),

    setVolume: (level: number) => script(`set volume output volume ${Math.round(level)}`),

    async getVolume() {
      const { stdout } = await deps.run('osascript', [
        '-e',
        'set v to get volume settings',
        '-e',
        'return (output volume of v as text) & "," & (output muted of v as text)',
      ])
      return parseVolume(stdout)
    },

    async setBrightness(level: number) {
      // macOS has no built-in command for this; the open-source `brightness` tool does it.
      try {
        await deps.run('brightness', [(level / 100).toFixed(2)])
      } catch (err) {
        if (isMissingProgram(err)) {
          throw new UserFacingError(
            'Brightness on macOS needs the free "brightness" tool. Install it with: brew install brightness',
          )
        }
        throw err
      }
    },

    // Same as pressing Ctrl+Cmd+Q.
    lockScreen: () =>
      script(
        'tell application "System Events" to keystroke "q" using {control down, command down}',
      ),

    sleep: async () => {
      await deps.run('pmset', ['sleepnow'])
    },
  }
}

/** "42,false" -> { level: 42, muted: false }. "missing value" (no output device) reads as 0. */
export function parseVolume(text: string): { level: number; muted: boolean } {
  const [level, muted] = text.trim().split(',')
  const n = Number(level)
  return { level: Number.isFinite(n) ? n : 0, muted: muted?.trim() === 'true' }
}
