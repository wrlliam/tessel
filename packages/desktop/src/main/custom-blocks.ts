// The "My blocks" folder: blocks people write in TypeScript, run as a local plugin.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Files to place in the folder, by path relative to it. */
export type BlockFiles = Record<string, string>

/** Files Tessel owns and refreshes every time; everything else is written only if missing. */
const OWNED = /^tessel\//

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/** Creates the folder or brings Tessel's own files up to date. Returns the folder. */
export async function ensureMyBlocks(dir: string, files: BlockFiles): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel)
    if (!OWNED.test(rel) && (await exists(path))) continue
    await mkdir(dirname(path), { recursive: true })
    if (OWNED.test(rel) && (await readFile(path, 'utf8').catch(() => '')) === content) continue
    await writeFile(path, content)
  }
  return dir
}

/** Copies the starter into blocks/<slug>.ts, picking a free name. Returns the new file. */
export async function newBlockFile(dir: string, name: string, starter: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-block'
  for (let i = 1; ; i++) {
    const file = join(dir, 'blocks', `${base}${i > 1 ? `-${i}` : ''}.ts`)
    if (await exists(file)) continue
    await mkdir(dirname(file), { recursive: true })
    await writeFile(
      file,
      starter.replace("name: 'My block'", `name: ${JSON.stringify(name || 'My block')}`),
    )
    return file
  }
}
