// Packs the optional plugins (package.json "tessel": { "bundled": false }) into zips plus a
// catalog.json, in build/catalog/. CI uploads them to the "plugins" release, where Tessel's
// Plugins tab finds them. Run `pnpm build:plugins` first.
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'

const root = join(import.meta.dirname, '..')
const out = join(root, 'build', 'catalog')
const BASE = 'https://github.com/wrlliam/tessel/releases/download/plugins'

async function filesIn(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await filesIn(p)))
    else out.push(p)
  }
  return out
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
const plugins = []
for (const dir of (await readdir(join(root, 'plugins'))).sort()) {
  const src = join(root, 'plugins', dir)
  const pkg = JSON.parse(await readFile(join(src, 'package.json'), 'utf8')) as {
    tessel?: { bundled?: boolean }
  }
  if (pkg.tessel?.bundled !== false) continue
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  > & { id: string; version: string }
  await stat(join(src, 'dist', 'index.js')).catch(() => {
    throw new Error(`${dir} isn't built; run pnpm build:plugins first`)
  })
  const entries: Record<string, Uint8Array> = {
    'manifest.json': await readFile(join(src, 'manifest.json')),
  }
  for (const f of await filesIn(join(src, 'dist'))) entries[relative(src, f)] = await readFile(f)
  const zip = zipSync(entries, { level: 9 })
  const file = `${manifest.id}-${manifest.version}.zip`
  await writeFile(join(out, file), zip)
  plugins.push({
    id: manifest.id,
    name: manifest['name'],
    version: manifest.version,
    description: manifest['description'],
    author: manifest['author'],
    icon: manifest['icon'],
    ...(manifest['platforms'] ? { platforms: manifest['platforms'] } : {}),
    permissions: manifest['permissions'] ?? [],
    url: `${BASE}/${file}`,
    size: zip.byteLength,
    sha256: createHash('sha256').update(zip).digest('hex'),
  })
  console.log(`packed ${file}`)
}
await writeFile(
  join(out, 'catalog.json'),
  JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), plugins }, null, 2),
)
console.log(`catalog.json lists ${plugins.length} plugins`)
