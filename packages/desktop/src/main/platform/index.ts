import { type OS, type Platform, UserFacingError } from '@tessel/core'
import { clipboard, ClipboardItem, dialog, Notification, shell, systemPreferences } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createCommon, type ShellPolicy } from './common.ts'
import { createNowPlaying } from './now-playing.ts'
import { createDarwin } from './darwin.ts'
import { launch, run } from './exec.ts'
import { createInput, type Nut } from './input.ts'
import { createLinux } from './linux.ts'
import { createWin32 } from './win32.ts'
import { createYdotoolInput } from './ydotool.ts'

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
}

/** Wayland blocks the X11 input nut-js uses, so keys and mouse go through ydotool there. */
export const isWayland = () =>
  process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland'

async function confirmShell(command: string): Promise<boolean> {
  const answer = await dialog.showMessageBox({
    type: 'warning',
    message: 'Run this command?',
    detail: command.length > 600 ? `${command.slice(0, 600)}…` : command,
    buttons: ['Run', "Don't run"],
    defaultId: 1,
    cancelId: 1,
  })
  return answer.response === 0
}

export function createPlatform(shellPolicy: () => ShellPolicy): Platform {
  const os = process.platform as OS
  const input = isWayland()
    ? createYdotoolInput({ run, clipboard: electronClipboard })
    : createInput({
        os,
        loadNut: () => import('@nut-tree-fork/nut-js') as unknown as Promise<Nut>,
        clipboard: electronClipboard,
        ensureAllowed: () => ensureInputAllowed(os),
      })
  const common = createCommon({
    shellPolicy,
    confirmShell,
    openExternal: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p),
    writeClipboard: (text) => clipboard.writeText(text),
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
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
  return { os, ...native, ...input, ...common, nowPlaying: createNowPlaying(os, run) }
}
