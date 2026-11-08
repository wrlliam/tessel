// The "My blocks" folder: blocks people write in TypeScript, run as a local plugin.
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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

/**
 * Puts a copy of an npm package Tessel ships (zx) into the folder's node_modules, so blocks can
 * import it without npm. Skipped when the same version is already there.
 */
export async function ensurePackage(dir: string, name: string, source: string): Promise<void> {
  const target = join(dir, 'node_modules', name)
  const version = (path: string) =>
    readFile(join(path, 'package.json'), 'utf8')
      .then((t) => (JSON.parse(t) as { version?: string }).version)
      .catch(() => undefined)
  if ((await version(target)) === (await version(source))) return
  await copyTree(source, target, (rel) => rel === 'package.json' || rel.startsWith('build'))
}

async function copyTree(from: string, to: string, keep: (rel: string) => boolean, rel = '') {
  for (const entry of await readdir(join(from, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (!keep(path)) continue
    if (entry.isDirectory()) await copyTree(from, to, keep, path)
    else {
      await mkdir(dirname(join(to, path)), { recursive: true })
      // readFile, not cp: the source may sit inside the app's asar archive.
      await writeFile(join(to, path), await readFile(join(from, path)))
    }
  }
}
