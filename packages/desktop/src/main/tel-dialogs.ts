import type { JsonValue, Tile } from '@tessel/core'
import { dialog, type BrowserWindow } from 'electron'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SharedTiles, TelImport } from '../shared/api.ts'
import type { Hub } from './hub.ts'
import {
  blockTypes,
  MAX_TEL_BYTES,
  myBlockIds,
  packTel,
  planBlocks,
  renameBlocks,
  TelError,
  unpackTel,
  variablesUsed,
} from './tel.ts'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(ts|js|mjs)$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** My blocks source files by id (the file name, as the loader turns it into an id). */
async function readMyBlocks(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const files = await readdir(join(dir, 'blocks')).catch(() => [])
  for (const f of files) {
    if (!/^[^_.].*\.(ts|js|mjs)$/.test(f)) continue
    out[slug(f)] = await readFile(join(dir, 'blocks', f), 'utf8')
  }
  return out
}

/** The file a block id comes from; files exporting several blocks give ids like name-1. */
const fileFor = (id: string, files: Record<string, string>) =>
  id in files ? id : Object.keys(files).find((f) => id.startsWith(`${f}-`))

export async function exportTelWithDialog(
  win: BrowserWindow | undefined,
  hub: Hub,
  myBlocksDir: string,
  req: SharedTiles,
): Promise<{ ok: true } | { ok: false; error: string } | { ok: false; cancelled: true }> {
  const tiles = req.tiles
  if (tiles.some((t) => t.kind === 'folder'))
    return { ok: false, error: 'Folders can’t be shared in a .tel yet.' }
  const profile = hub.getProfile(req.profileId)
  const variables: Record<string, JsonValue> = {}
  for (const name of variablesUsed(tiles)) {
    const v = profile?.variables[name]
    if (v !== undefined) variables[name] = v
  }
  const pluginIds = new Set(
    hub
      .plugin()
      .list()
      .map((p) => p.id),
  )
  const plugins = [
    ...new Set(
      blockTypes(tiles)
        .map((t) => t.split('.')[0] ?? '')
        .filter((p) => pluginIds.has(p) && p !== 'my-blocks'),
    ),
  ]
  const available = await readMyBlocks(myBlocksDir)
  const blocks: Record<string, string> = {}
  for (const id of myBlockIds(tiles)) {
    const file = fileFor(id, available)
    if (!file) return { ok: false, error: `Can't find the My block "${id}" to include.` }
    blocks[file] = available[file] ?? ''
  }
  const options = {
    title: 'Share tiles',
    defaultPath: `${slug(req.name) || 'tiles'}.tel`,
    filters: [{ name: 'Tessel tiles', extensions: ['tel'] }],
  }
  const picked = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
  await writeFile(
    picked.filePath,
    packTel({
      name: req.name,
      ...(req.page && { page: req.page }),
      tiles,
      variables,
      plugins,
      blocks,
    }),
  )
  return { ok: true }
}

/**
 * Opens a .tel: says what's inside (and that any code in it will run), installs its My blocks,
 * and returns the tiles for the editor to place.
 */
export async function importTelWithDialog(
  win: BrowserWindow | undefined,
  hub: Hub,
  myBlocksDir: string,
  setUpMyBlocks: () => Promise<void>,
  path?: string,
): Promise<TelImport> {
  let file = path
  if (!file) {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Tessel tiles', extensions: ['tel'] }],
    }
    const picked = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true }
    file = picked.filePaths[0]
  }
  try {
    if ((await stat(file)).size > MAX_TEL_BYTES)
      throw new TelError('That file is too big for a .tel.')
    const content = unpackTel(new Uint8Array(await readFile(file)))
    const installed = new Set(
      hub
        .plugin()
        .list()
        .map((p) => p.id),
    )
    const missing = content.plugins.filter((p) => !installed.has(p))
    const code = Object.keys(content.blocks)
    const lines = [
      content.page
        ? `A page, “${content.page.name}”, with ${content.tiles.length} tiles.`
        : `${content.tiles.length === 1 ? 'One tile' : `${content.tiles.length} tiles`}.`,
      content.plugins.length ? `Uses plugins: ${content.plugins.join(', ')}.` : '',
      missing.length
        ? `Not installed here: ${missing.join(', ')}. Those blocks won't run until you add them.`
        : '',
      code.length
        ? `Includes code for My blocks: ${code.join(', ')}. It runs on this computer with access to files, the network and programs. Only open .tel files from people you trust.`
        : '',
    ].filter(Boolean)
    const options: Electron.MessageBoxOptions = {
      type: code.length ? 'warning' : 'question',
      message: `Add “${content.name}”?`,
      detail: lines.join('\n\n'),
      buttons: ['Add', 'Cancel'],
      defaultId: code.length ? 1 : 0,
      cancelId: 1,
    }
    const answer = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    if (answer.response !== 0) return { ok: false, cancelled: true }

    let tiles: Tile[] = content.tiles
    if (code.length) {
      await setUpMyBlocks()
      const plan = planBlocks(content.blocks, await readMyBlocks(myBlocksDir))
      for (const [id, src] of Object.entries(plan.write))
        await writeFile(join(myBlocksDir, 'blocks', `${id}.ts`), src)
      tiles = renameBlocks(tiles, plan.rename)
      if (
        !hub
          .plugin()
          .list()
          .some((p) => p.id === 'my-blocks')
      )
        await hub.plugin().addDev(myBlocksDir)
      else await hub.plugin().restart('my-blocks')
    }
    return {
      ok: true,
      name: content.name,
      ...(content.page && { page: content.page }),
      tiles,
      variables: content.variables,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
