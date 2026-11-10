import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMedalPlugin, type SavedFile } from './plugin.ts'

/** Files up to three folders deep, newest first is sorted by the plugin. */
async function list(folder: string, depth = 0): Promise<SavedFile[]> {
  const out: SavedFile[] = []
  for (const e of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, e.name)
    if (e.isDirectory() && depth < 3) out.push(...(await list(path, depth + 1).catch(() => [])))
    else if (e.isFile()) out.push({ path, name: e.name, mtime: (await stat(path)).mtimeMs })
  }
  return out
}

export default createMedalPlugin(list, () => [
  join(homedir(), 'Videos', 'Medal'),
  join(homedir(), 'Medal'),
  'C:\\Medal',
])
