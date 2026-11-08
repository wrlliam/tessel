import { type OS, type Platform, UserFacingError } from '@tessel/core'
import { clipboard, ClipboardItem, shell, systemPreferences } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createDarwin } from './darwin.ts'
import { launch, run } from './exec.ts'
import { createInput, type Nut } from './input.ts'
import { createLinux } from './linux.ts'
import { createWin32 } from './win32.ts'

// Copy every format out of the clipboard now: items read lazily, so they would
// otherwise return whatever we paste over them.
const electronClipboard = {
  save: async (): Promise<ClipboardItem[]> => {
    const items = await clipboard.read()
    return Promise.all(
      items.map(async (item) => {
        const entries = await Promise.all(
          item.types.map(async (type) => [type, await item.getType(type)] as const),
        )
        return new ClipboardItem(Object.fromEntries(entries))
      }),
    )
  },
  restore: async (items: ClipboardItem[]) => {
    if (items.length === 0) clipboard.clear()
    else await clipboard.write(items)
  },
  writeText: (text: string) => clipboard.writeText(text),
}

let askedForAccessibility = false

function ensureInputAllowed(os: OS) {
  if (os === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    if (!askedForAccessibility) {
      askedForAccessibility = true
      systemPreferences.isTrustedAccessibilityClient(true)
    }
    throw new UserFacingError(
      'Tessel needs Accessibility permission to press keys. Turn it on in System Settings › Privacy & Security › Accessibility, then press the tile again.',
    )
  }
  if (os === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland') {
    throw new UserFacingError(
      'Typing and shortcuts need an X11 session. Wayland blocks simulated keys; log in with "GNOME on Xorg" or similar.',
    )
  }
}

export function createPlatform(): Platform {
  const os = process.platform as OS
  const input = createInput({
    os,
    loadNut: () => import('@nut-tree-fork/nut-js') as unknown as Promise<Nut>,
    clipboard: electronClipboard,
    ensureAllowed: () => ensureInputAllowed(os),
  })
  const native =
    os === 'darwin'
      ? createDarwin({ run })
      : os === 'win32'
        ? createWin32({ run, launch, openPath: (p) => shell.openPath(p) })
        : createLinux({
            run,
            launch,
            env: process.env,
            home: homedir(),
            listDir: (d) => readdir(d),
            readFile: (p) => readFile(p, 'utf8'),
          })
  return { os, ...native, ...input }
}
