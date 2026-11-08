import { describe, expect, it, vi } from 'vitest'
import { createDarwin } from '../src/main/platform/darwin.ts'
import { ExecError, type Run } from '../src/main/platform/exec.ts'
import { createInput, nutKeyName, type Nut } from '../src/main/platform/input.ts'
import { applicationDirs, createLinux, parseDesktopEntry } from '../src/main/platform/linux.ts'
import { createWin32, pickStartApp } from '../src/main/platform/win32.ts'

const ok = () => vi.fn<Run>(async () => ({ stdout: '', stderr: '' }))
const fail = (message: string, code?: string) =>
  vi.fn<Run>(async () => {
    throw new ExecError(message, code, message)
  })

describe('macOS', () => {
  it('opens apps by name with open -a', async () => {
    const run = ok()
    await createDarwin({ run }).openApp('Discord')
    expect(run).toHaveBeenCalledWith('open', ['-a', 'Discord'])
  })

  it('opens paths directly', async () => {
    const run = ok()
    await createDarwin({ run }).openApp('/Applications/Notes.app')
    expect(run).toHaveBeenCalledWith('open', ['/Applications/Notes.app'])
  })

  it('explains a missing app', async () => {
    const mac = createDarwin({ run: fail("Unable to find application named 'Nope'") })
    await expect(mac.openApp('Nope')).rejects.toThrow('Couldn\'t find an app called "Nope"')
  })

  it('sets dark mode through System Events', async () => {
    const run = ok()
    await createDarwin({ run }).setDarkMode(true)
    expect(run).toHaveBeenCalledWith('osascript', [
      '-e',
      'tell application "System Events" to tell appearance preferences to set dark mode to true',
    ])
  })

  it('explains a missing Automation permission', async () => {
    const mac = createDarwin({
      run: fail('execution error: Not authorized to send Apple events (-1743)'),
    })
    await expect(mac.setDarkMode(false)).rejects.toThrow(/Automation/)
  })
})

describe('Windows', () => {
  const apps = [
    { Name: 'Discord', AppID: 'com.squirrel.Discord.Discord' },
    { Name: 'Calculator', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    { Name: 'Discord PTB', AppID: 'ptb' },
  ]

  const deps = () => ({
    run: vi.fn<Run>(async (cmd) => ({
      stdout: cmd === 'powershell.exe' ? JSON.stringify(apps) : '',
      stderr: '',
    })),
    launch: vi.fn(),
    openPath: vi.fn(async () => ''),
  })

  it('prefers exact, then prefix, then substring matches', () => {
    expect(pickStartApp(apps, 'discord')?.AppID).toBe('com.squirrel.Discord.Discord')
    expect(pickStartApp(apps, 'calc')?.Name).toBe('Calculator')
    expect(pickStartApp(apps, 'ptb')?.AppID).toBe('ptb')
    expect(pickStartApp(apps, 'zzz')).toBeUndefined()
  })

  it('launches Start menu apps, including Store apps, through Explorer', async () => {
    const d = deps()
    await createWin32(d).openApp('Calculator')
    expect(d.launch).toHaveBeenCalledWith('explorer.exe', [
      'shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
    ])
  })

  it('caches the Start menu list', async () => {
    const d = deps()
    const win = createWin32(d)
    await win.openApp('Discord')
    await win.openApp('Calculator')
    expect(d.run).toHaveBeenCalledTimes(1)
  })

  it('handles a single app (PowerShell returns an object, not an array)', async () => {
    const d = deps()
    d.run.mockResolvedValueOnce({ stdout: JSON.stringify(apps[0]), stderr: '' })
    await createWin32(d).openApp('Discord')
    expect(d.launch).toHaveBeenCalled()
  })

  it('opens paths with the shell', async () => {
    const d = deps()
    await createWin32(d).openApp('C:\\Tools\\thing.exe')
    expect(d.openPath).toHaveBeenCalledWith('C:\\Tools\\thing.exe')
  })

  it('explains a missing app', async () => {
    await expect(createWin32(deps()).openApp('Nope')).rejects.toThrow(/Start menu/)
  })

  it('writes both theme registry values', async () => {
    const d = deps()
    await createWin32(d).setDarkMode(true)
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'
    expect(d.run.mock.calls).toEqual([
      ['reg.exe', ['add', key, '/v', 'AppsUseLightTheme', '/t', 'REG_DWORD', '/d', '0', '/f']],
      ['reg.exe', ['add', key, '/v', 'SystemUsesLightTheme', '/t', 'REG_DWORD', '/d', '0', '/f']],
    ])
  })
})

describe('Linux', () => {
  const files: Record<string, string> = {
    '/usr/share/applications/org.gnome.Calculator.desktop':
      '[Desktop Entry]\nName=Calculator\nType=Application\n[Desktop Action new]\nName=New window',
    '/usr/share/applications/hidden.desktop':
      '[Desktop Entry]\nName=Hidden\nType=Application\nNoDisplay=true',
    '/home/me/.local/share/applications/discord.desktop':
      '[Desktop Entry]\nName=Discord\nType=Application',
  }
  const deps = (run = ok()) => ({
    run,
    launch: vi.fn(),
    env: {},
    home: '/home/me',
    listDir: async (dir: string) =>
      Object.keys(files)
        .filter((f) => f.startsWith(`${dir}/`))
        .map((f) => f.slice(dir.length + 1)),
    readFile: async (path: string) => files[path] ?? '',
  })

  it('lists XDG application folders', () => {
    expect(applicationDirs({ XDG_DATA_DIRS: '/a:/b' }, '/home/me').slice(0, 3)).toEqual([
      '/home/me/.local/share/applications',
      '/a/applications',
      '/b/applications',
    ])
  })

  it('reads only the main desktop entry and skips hidden ones', () => {
    expect(
      parseDesktopEntry(files['/usr/share/applications/org.gnome.Calculator.desktop'] ?? ''),
    ).toBe('Calculator')
    expect(parseDesktopEntry(files['/usr/share/applications/hidden.desktop'] ?? '')).toBeUndefined()
  })

  it('launches an app by its Name with gtk-launch', async () => {
    const d = deps()
    await createLinux(d).openApp('calculator')
    expect(d.run).toHaveBeenCalledWith('gtk-launch', ['org.gnome.Calculator.desktop'])
  })

  it('falls back to gio when gtk-launch is missing', async () => {
    const run = vi.fn<Run>(async (cmd) => {
      if (cmd === 'gtk-launch') throw new ExecError('missing', 'ENOENT', '')
      return { stdout: '', stderr: '' }
    })
    await createLinux(deps(run)).openApp('Discord')
    expect(run).toHaveBeenLastCalledWith('gio', [
      'launch',
      '/home/me/.local/share/applications/discord.desktop',
    ])
  })

  it('explains a missing app', async () => {
    await expect(createLinux(deps()).openApp('Hidden')).rejects.toThrow(
      'Couldn\'t find an app called "Hidden"',
    )
  })

  it('sets the GNOME colour scheme', async () => {
    const d = deps()
    await createLinux(d).setDarkMode(false)
    expect(d.run).toHaveBeenCalledWith('gsettings', [
      'set',
      'org.gnome.desktop.interface',
      'color-scheme',
      'default',
    ])
  })

  it('explains missing gsettings', async () => {
    await expect(createLinux(deps(fail('nope', 'ENOENT'))).setDarkMode(true)).rejects.toThrow(
      /GNOME/,
    )
  })
})

describe('input', () => {
  function fakeNut() {
    const Key: Record<string, number> = {}
    ;[
      'LeftCmd',
      'LeftSuper',
      'LeftControl',
      'LeftShift',
      'LeftAlt',
      'V',
      'S',
      'Num4',
      'F5',
      'Enter',
    ].forEach((k, i) => (Key[k] = i))
    const nut = {
      Key,
      keyboard: {
        config: { autoDelayMs: 300 },
        type: vi.fn(async () => {}),
        pressKey: vi.fn(async () => {}),
        releaseKey: vi.fn(async () => {}),
      },
    } satisfies Nut
    return nut
  }

  function make(os: 'darwin' | 'win32' = 'darwin', ensureAllowed = () => {}) {
    const nut = fakeNut()
    const clipboard = {
      content: 'old',
      save: vi.fn(async () => clipboard.content),
      restore: vi.fn(async (v: string) => void (clipboard.content = v)),
      writeText: vi.fn(async (t: string) => void (clipboard.content = t)),
    }
    const input = createInput({
      os,
      loadNut: async () => nut,
      clipboard,
      ensureAllowed,
      sleep: async () => {},
    })
    return { input, nut, clipboard }
  }

  it('types ASCII directly', async () => {
    const { input, nut, clipboard } = make()
    await input.typeText('hello@example.com')
    expect(nut.keyboard.type).toHaveBeenCalledWith('hello@example.com')
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(nut.keyboard.config.autoDelayMs).toBe(2)
  })

  it('pastes Unicode through the clipboard, then restores it', async () => {
    const { input, nut, clipboard } = make()
    await input.typeText('Café ☕')
    expect(clipboard.writeText).toHaveBeenCalledWith('Café ☕')
    expect(nut.keyboard.pressKey).toHaveBeenCalledWith(nut.Key['LeftCmd'], nut.Key['V'])
    expect(clipboard.content).toBe('old')
  })

  it('pastes with Ctrl+V on Windows', async () => {
    const { input, nut } = make('win32')
    await input.typeText('naïve')
    expect(nut.keyboard.pressKey).toHaveBeenCalledWith(nut.Key['LeftControl'], nut.Key['V'])
  })

  it('restores the clipboard even when pasting fails', async () => {
    const { input, nut, clipboard } = make()
    nut.keyboard.pressKey.mockRejectedValueOnce(new Error('boom'))
    await expect(input.typeText('ü')).rejects.toThrow('boom')
    expect(clipboard.content).toBe('old')
  })

  it('presses and releases combos in reverse order', async () => {
    const { input, nut } = make('win32')
    await input.pressCombo({ modifiers: ['meta', 'shift'], key: '4' })
    const { Key } = nut
    expect(nut.keyboard.pressKey).toHaveBeenCalledWith(
      Key['LeftSuper'],
      Key['LeftShift'],
      Key['Num4'],
    )
    expect(nut.keyboard.releaseKey).toHaveBeenCalledWith(
      Key['Num4'],
      Key['LeftShift'],
      Key['LeftSuper'],
    )
  })

  it('refuses when the OS blocks input', async () => {
    const { input, nut } = make('darwin', () => {
      throw new Error('Tessel needs Accessibility permission')
    })
    await expect(input.pressCombo({ modifiers: [], key: 'f5' })).rejects.toThrow(/Accessibility/)
    expect(nut.keyboard.pressKey).not.toHaveBeenCalled()
  })

  it('maps key names', () => {
    expect(['a', '7', 'f12', 'bracketleft', 'printscreen'].map(nutKeyName)).toEqual([
      'A',
      'Num7',
      'F12',
      'LeftBracket',
      'Print',
    ])
  })
})

describe('key names against the real nut-js enum', () => {
  it('maps every key the combo parser accepts', async () => {
    const { KEY_NAMES } = await import('@tessel/core')
    const { Key } = (await import('@nut-tree-fork/shared')) as unknown as {
      Key: Record<string, number>
    }
    const { nutModifierName } = await import('../src/main/platform/input.ts')
    for (const name of KEY_NAMES) expect(Key[nutKeyName(name)], name).toBeTypeOf('number')
    for (const os of ['darwin', 'win32', 'linux'] as const) {
      for (const mod of ['ctrl', 'alt', 'shift', 'meta'] as const) {
        expect(Key[nutModifierName(mod, os)], `${mod} on ${os}`).toBeTypeOf('number')
      }
    }
  })
})
