import { dialog, type BrowserWindow } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import type { SaveResult } from '../../shared/api.ts'
import type { PluginManager } from './manager.ts'

/** Picks a plugin folder or zip and installs it. Dev plugins are used in place. */
export async function addPluginWithDialog(
  manager: PluginManager,
  win: BrowserWindow | undefined,
  kind: 'folder' | 'zip' | 'dev',
): Promise<SaveResult | { ok: false; cancelled: true }> {
  const options: Electron.OpenDialogOptions =
    kind === 'zip'
      ? { properties: ['openFile'], filters: [{ name: 'Plugin zip', extensions: ['zip'] }] }
      : { properties: ['openDirectory'], message: 'Choose the folder that holds manifest.json' }
  const picked = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return { ok: false, cancelled: true }
  try {
    if (kind === 'zip') {
      if ((await stat(path)).size > 50 * 1024 * 1024)
        return { ok: false, error: 'That zip is too big for a plugin.' }
      await manager.installZip(new Uint8Array(await readFile(path)))
    } else if (kind === 'dev') await manager.addDev(path)
    else await manager.installFolder(path)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
