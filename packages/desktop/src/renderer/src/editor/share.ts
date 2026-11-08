// Sharing tiles as .tel files, and opening them.
import type { Page, Tile } from '@tessel/core'
import { useEditor } from './store.ts'

const notice = (text: string) => useEditor.setState({ notice: text })

/** Asks where to save, then writes the tiles (and any My blocks they use) to a .tel. */
export async function shareTiles(name: string, tiles: Tile[], page?: Page) {
  const profile = useEditor.getState().profile
  if (!profile) return
  const r = await window.tessel.exportTel({
    profileId: profile.id,
    name,
    tiles,
    ...(page && { page: { name: page.name, cols: page.cols, rows: page.rows } }),
  })
  if (!r.ok && 'error' in r) notice(r.error)
}

/** Opens a .tel (asking for one if no path), then adds its tiles. */
export async function openTel(path?: string) {
  const r = await window.tessel.importTel(path)
  if (r.ok) useEditor.getState().addShared(r)
  else if ('error' in r) notice(r.error)
}
