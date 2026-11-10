// The "My blocks" folder: blocks people write in TypeScript, run as a local plugin.
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Files to place in the folder, by path relative to it. */
export type BlockFiles = Record<string, string>

/**
 * Files Tessel owns and refreshes every time; everything else is written only if missing.
 * tessel/generated.ts is rewritten from the live block list instead (see generateBlockTypes).
 */
const OWNED = /^tessel\/(?!generated\.ts$)/

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

interface Described {
  id: string
  name: string
  description: string
  category: string
  trigger?: string
  inputs: Array<{ id: string; kind: string; type?: string }>
  outputs: Array<{ id: string; kind: string; type?: string }>
  fields?: Array<{ key: string; widget: string; options?: Array<{ value: string }> }>
}

const BUILT_IN = new Set(['action', 'logic', 'data'])
/** Friendlier extra names for some built-in blocks. */
const ALIASES: Record<string, string> = { popup: 'action.toast', wait: 'logic.delay' }

/** "pick-one" -> "pickOne", "setTileAppearance" stays. */
export const camel = (s: string) =>
  s.replace(/[-_ ]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[^a-zA-Z_$]+/, '')

const tsType = (t?: string) =>
  t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : t === 'string' ? 'string' : 'unknown'

/** One block as a method: its doc comment, then name(params, inputs): Promise<values>. */
function signature(name: string, b: Described, indent: string): string {
  const params = (b.fields ?? []).map((f) => {
    const type =
      f.widget === 'number'
        ? 'number'
        : f.widget === 'toggle'
          ? 'boolean'
          : f.widget === 'select' && f.options?.length
            ? f.options.map((o) => JSON.stringify(o.value)).join(' | ')
            : 'string'
    return `${JSON.stringify(f.key)}?: ${type}`
  })
  const inputs = b.inputs
    .filter((p) => p.kind === 'value')
    .map((p) => `${JSON.stringify(p.id)}?: ${tsType(p.type)}`)
  const values = b.outputs
    .filter((p) => p.kind === 'value')
    .map((p) => `${JSON.stringify(p.id)}?: ${tsType(p.type)}`)
  const flows = b.outputs.filter((p) => p.kind === 'flow').map((p) => JSON.stringify(p.id))
  const next = flows.length ? flows.join(' | ') : 'string'
  const doc = `${b.name}: ${b.description}`.replace(/\*\//g, '* /').replace(/\s+/g, ' ')
  return [
    `${indent}/** ${doc} */`,
    `${indent}${JSON.stringify(name)}(`,
    `${indent}  params?: { ${params.join('; ')} },`,
    `${indent}  inputs?: { ${inputs.join('; ')} },`,
    `${indent}): Promise<{ next?: ${next}; ${values.join('; ')} }>`,
  ].join('\n')
}

/**
 * The tessel/generated.ts file for My blocks: every block Tessel has right now, as typed functions
 * for std.blocks (built-in and plugin blocks) and std.my (the folder's own blocks).
 */
export function generateBlockTypes(blocks: Described[]): string {
  const top: Array<[string, Described]> = []
  const plugins = new Map<string, Array<[string, Described]>>()
  const mine: Array<[string, Described]> = []
  for (const b of blocks) {
    if (b.trigger) continue
    const dot = b.id.indexOf('.')
    const owner = b.id.slice(0, dot)
    const name = camel(b.id.slice(dot + 1))
    if (!name) continue
    if (owner === 'my-blocks') mine.push([name, b])
    else if (BUILT_IN.has(owner)) top.push([name, b])
    else {
      const list = plugins.get(camel(owner)) ?? []
      list.push([name, b])
      plugins.set(camel(owner), list)
    }
  }
  // Sorted, so the file only changes when the blocks do, not when plugins load in another order.
  const byName = (a: readonly [string, Described], b: readonly [string, Described]) =>
    a[0].localeCompare(b[0]) || a[1].id.localeCompare(b[1].id)
  top.sort(byName)
  mine.sort(byName)
  for (const list of plugins.values()) list.sort(byName)
  // Built-in names are unique today; if two ever clash, the later one gets its category in front.
  const seen = new Set<string>()
  const uniqueTop = top.map(([n, b]) => {
    const name = seen.has(n) ? camel(`${b.category} ${n}`) : n
    seen.add(name)
    return [name, b] as const
  })
  const byId = new Map(blocks.map((b) => [b.id, b]))
  for (const [alias, id] of Object.entries(ALIASES)) {
    const b = byId.get(id)
    if (b && !seen.has(alias)) uniqueTop.push([alias, b])
  }
  const sigs = (list: ReadonlyArray<readonly [string, Described]>, indent: string) =>
    list.map(([n, b]) => signature(n, b, indent)).join('\n')
  const map = (list: ReadonlyArray<readonly [string, Described]>) =>
    list.map(([n, b]) => `${JSON.stringify(n)}: ${JSON.stringify(b.id)}`).join(', ')
  return `// Made by Tessel each time My blocks loads, from the blocks it has right now.
// Don't edit: it's rewritten. Call them as std.blocks.name(params, inputs) and std.my.name(...).

export interface BlockCalls {
${sigs(uniqueTop, '  ')}
${[...plugins]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([p, list]) => `  ${JSON.stringify(p)}: {\n${sigs(list, '    ')}\n  }`)
  .join('\n')}
}

export interface MyCalls {
${sigs(mine, '  ')}
}

/** For reference: the block each std.blocks name runs. */
export const BLOCKS = {
  ${map(uniqueTop)}${uniqueTop.length && plugins.size ? ',' : ''}
  ${[...plugins]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, list]) => `${JSON.stringify(p)}: { ${map(list)} }`)
    .join(',\n  ')}
} as const

/** For reference: the block id each std.my name runs. */
export const MY = { ${map(mine).replaceAll('"my-blocks.', '"')} } as const
`
}
