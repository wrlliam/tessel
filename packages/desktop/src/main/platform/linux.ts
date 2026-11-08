import { UserFacingError, type OnOff } from '@tessel/core'
import { posix } from 'node:path'

// Linux paths, even when tests run on Windows.
const { basename, join } = posix
import { isMissingProgram, type Launch, type Run } from './exec.ts'

export interface DesktopEntry {
  id: string
  path: string
  name: string
}

export interface LinuxDeps {
  run: Run
  launch: Launch
  env: NodeJS.ProcessEnv
  home: string
  listDir(dir: string): Promise<string[]>
  readFile(path: string): Promise<string>
}

export function applicationDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const dataHome = env['XDG_DATA_HOME'] || join(home, '.local/share')
  const dataDirs = (env['XDG_DATA_DIRS'] || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean)
  return [
    dataHome,
    ...dataDirs,
    join(home, '.local/share/flatpak/exports/share'),
    '/var/lib/flatpak/exports/share',
    '/var/lib/snapd/desktop',
  ].map((d) => join(d, 'applications'))
}

/** Reads Name from the [Desktop Entry] group; skips hidden and non-app entries. */
export function parseDesktopEntry(text: string): string | undefined {
  let inEntry = false
  let name: string | undefined
  let type: string | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inEntry) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'Name') name = value
    else if (key === 'Type') type = value
    else if ((key === 'NoDisplay' || key === 'Hidden') && value === 'true') return undefined
  }
  return type === 'Application' ? name : undefined
}

export function createLinux(deps: LinuxDeps) {
  async function tool(cmd: string, args: string[], missing: string) {
    try {
      await deps.run(cmd, args)
    } catch (err) {
      if (isMissingProgram(err)) throw new UserFacingError(missing)
      throw err
    }
  }

  async function audio(pactl: string[], wpctl: string[]) {
    try {
      await deps.run('pactl', pactl)
    } catch (err) {
      if (!isMissingProgram(err)) throw err
      await tool(
        'wpctl',
        wpctl,
        'Sound control needs pactl or wpctl. Install pulseaudio-utils or wireplumber.',
      )
    }
  }

  async function entries(): Promise<DesktopEntry[]> {
    const found: DesktopEntry[] = []
    const seen = new Set<string>()
    for (const dir of applicationDirs(deps.env, deps.home)) {
      const files = await deps.listDir(dir).catch(() => [])
      for (const file of files) {
        if (!file.endsWith('.desktop') || seen.has(file)) continue
        seen.add(file)
        const path = join(dir, file)
        const name = parseDesktopEntry(await deps.readFile(path).catch(() => ''))
        if (name) found.push({ id: file, path, name })
      }
    }
    return found
  }

  async function launchEntry(entry: DesktopEntry) {
    try {
      await deps.run('gtk-launch', [entry.id])
    } catch (err) {
      if (!isMissingProgram(err)) throw err
      await deps.run('gio', ['launch', entry.path])
    }
  }

  return {
    async openApp(app: string) {
      if (app.startsWith('/')) {
        if (app.endsWith('.desktop')) await deps.run('gio', ['launch', app])
        else deps.launch(app, [])
        return
      }
      const q = app.trim().toLowerCase()
      const all = await entries()
      const match =
        all.find((e) => e.name.toLowerCase() === q) ??
        all.find((e) => basename(e.id, '.desktop').toLowerCase() === q) ??
        all.find((e) => e.name.toLowerCase().startsWith(q))
      if (!match) throw new UserFacingError(`Couldn't find an app called "${app}".`)
      await launchEntry(match)
    },

    async setDarkMode(on: OnOff) {
      try {
        let dark = on
        if (dark === 'toggle') {
          const { stdout } = await deps.run('gsettings', [
            'get',
            'org.gnome.desktop.interface',
            'color-scheme',
          ])
          dark = !stdout.includes('dark')
        }
        await deps.run('gsettings', [
          'set',
          'org.gnome.desktop.interface',
          'color-scheme',
          dark ? 'prefer-dark' : 'default',
        ])
      } catch (err) {
        if (isMissingProgram(err)) {
          throw new UserFacingError(
            'Dark mode needs gsettings, which comes with GNOME. Other desktops are not supported yet.',
          )
        }
        throw err
      }
    },

    // pactl works with PulseAudio and PipeWire; wpctl is PipeWire's own tool.
    setVolume: (level: number) =>
      audio(
        ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(level)}%`],
        ['set-volume', '@DEFAULT_AUDIO_SINK@', (level / 100).toFixed(2)],
      ),

    async getVolume() {
      try {
        const vol = (await deps.run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'])).stdout
        const mute = (await deps.run('pactl', ['get-sink-mute', '@DEFAULT_SINK@'])).stdout
        return { level: Number(/(\d+)%/.exec(vol)?.[1] ?? 0), muted: /yes/i.test(mute) }
      } catch (err) {
        if (!isMissingProgram(err)) throw err
        const out = (await deps.run('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@'])).stdout
        return {
          level: Math.round(Number(/([\d.]+)/.exec(out)?.[1] ?? 0) * 100),
          muted: /MUTED/.test(out),
        }
      }
    },

    setMuted: (on: OnOff) => {
      const arg = on === 'toggle' ? 'toggle' : on ? '1' : '0'
      return audio(
        ['set-sink-mute', '@DEFAULT_SINK@', arg],
        ['set-mute', '@DEFAULT_AUDIO_SINK@', arg],
      )
    },

    async setBrightness(level: number) {
      await tool(
        'brightnessctl',
        ['set', `${Math.round(level)}%`],
        'Brightness needs brightnessctl. Install it from your package manager.',
      )
    },

    async lockScreen() {
      try {
        await deps.run('loginctl', ['lock-session'])
      } catch (err) {
        if (!isMissingProgram(err)) throw err
        await tool(
          'xdg-screensaver',
          ['lock'],
          "Couldn't find a way to lock the screen (tried loginctl and xdg-screensaver).",
        )
      }
    },

    sleep: async () => {
      await deps.run('systemctl', ['suspend'])
    },
  }
}
