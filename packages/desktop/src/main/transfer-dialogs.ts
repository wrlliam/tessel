import { dialog, type BrowserWindow } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import type { ImportResult } from '../shared/api.ts'
import type { Hub } from './hub.ts'
import { ImportError, MAX_FILE_BYTES } from './transfer.ts'

const FILTERS = [{ name: 'Tessel profile', extensions: ['tessel'] }]

export async function exportWithDialog(
  hub: Hub,
  win: BrowserWindow | undefined,
  id: string,
): Promise<boolean> {
  const name = hub.getProfile(id)?.name ?? 'Profile'
  const options = { defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '')}.tessel`, filters: FILTERS }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false
  const bytes = await hub.exportProfile(id)
  if (!bytes) return false
  await writeFile(result.filePath, bytes)
  hub.logger.info(`Exported "${name}"`)
  return true
}

export async function importWithDialog(
  hub: Hub,
  win: BrowserWindow | undefined,
): Promise<ImportResult> {
  const options = { properties: ['openFile' as const], filters: FILTERS }
  const picked = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return { ok: false, cancelled: true }
  try {
    if ((await stat(path)).size > MAX_FILE_BYTES)
      throw new ImportError('That file is too big to be a Tessel profile.')
    const preview = hub.previewImport(new Uint8Array(await readFile(path)))
    // Imported tiles run on this computer, so show what they use before adding them.
    const message = {
      type: 'warning' as const,
      buttons: ['Import', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Import “${preview.name}”?`,
      detail: [
        'Its tiles run on this computer when pressed. Only import profiles from people you trust.',
        '',
        preview.blocks.length
          ? `Blocks it uses: ${preview.blocks.join(', ')}.`
          : 'It has no blocks yet.',
      ].join('\n'),
    }
    const answer = win
      ? await dialog.showMessageBox(win, message)
      : await dialog.showMessageBox(message)
    if (answer.response !== 0) return { ok: false, cancelled: true }
    return { ok: true, id: await hub.addImported(preview.profile) }
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message }
    return { ok: false, error: `Couldn't read that file: ${(err as Error).message}` }
  }
}
