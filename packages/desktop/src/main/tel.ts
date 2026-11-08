// .tel files: tiles (or a whole page) to share, with everything they need. A .tel is a zip of
// tel.json plus the TypeScript of any My blocks the tiles use, under blocks/.
import { JsonValue, migrateProfile, PROFILE_SCHEMA_VERSION, Tile } from '@tessel/core'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'

const FORMAT = 'tessel-tiles'
const MAX_ENTRY_BYTES = 2 * 1024 * 1024
export const MAX_TEL_BYTES = 10 * 1024 * 1024
const MY_BLOCKS = 'my-blocks.'

export class TelError extends Error {}

const TelJson = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  schemaVersion: z.int().min(1),
  name: z.string().max(80),
  /** Present when a whole page was shared. */
  page: z.object({ name: z.string().max(40), cols: z.int(), rows: z.int() }).optional(),
  tiles: z.array(z.unknown()).min(1).max(200),
  variables: z.record(z.string(), JsonValue).default({}),
  /** Plugins the tiles use, other than My blocks. */
  plugins: z.array(z.string()).default([]),
})

export interface TelContent {
  name: string
  page?: { name: string; cols: number; rows: number }
  tiles: Tile[]
  variables: Record<string, JsonValue>
  plugins: string[]
  /** My blocks source files, by block id. */
  blocks: Record<string, string>
}

/** Block types the tiles use, e.g. "my-blocks.git-branch", "voicemeeter.mute". */
export const blockTypes = (tiles: Tile[]) =>
  [...new Set(tiles.flatMap((t) => t.graph.nodes.map((n) => n.type)))].sort()

/** Ids of My blocks the tiles use. */
export const myBlockIds = (tiles: Tile[]) =>
  blockTypes(tiles)
    .filter((t) => t.startsWith(MY_BLOCKS))
    .map((t) => t.slice(MY_BLOCKS.length))

/** Global variable names the tiles read or write. */
export function variablesUsed(tiles: Tile[]): string[] {
  const names = new Set<string>()
  for (const t of tiles) {
    const json = JSON.stringify([t.graph, t.appearanceBindings, t.label])
    for (const m of json.matchAll(/var\.([A-Za-z_]\w*)/g)) if (m[1]) names.add(m[1])
    for (const n of t.graph.nodes)
      if (
        (n.type === 'data.getVariable' || n.type === 'data.setVariable') &&
        typeof n.params['name'] === 'string'
      )
        names.add(n.params['name'])
  }
  return [...names].sort()
}

export function packTel(c: TelContent): Uint8Array {
  const json = {
    format: FORMAT,
    version: 1,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    name: c.name,
    ...(c.page && { page: c.page }),
    tiles: c.tiles,
    variables: c.variables,
    plugins: c.plugins,
  }
  return zipSync({
    'tel.json': strToU8(JSON.stringify(json, null, 2)),
    ...Object.fromEntries(
      Object.entries(c.blocks).map(([id, src]) => [`blocks/${id}.ts`, strToU8(src)]),
    ),
  })
}

const BLOCK_FILE = /^blocks\/([a-z0-9][a-z0-9-]{0,60})\.ts$/

export function unpackTel(bytes: Uint8Array): TelContent {
  if (bytes.byteLength > MAX_TEL_BYTES) throw new TelError('That file is too big for a .tel.')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        (f.name === 'tel.json' || BLOCK_FILE.test(f.name)) && f.originalSize <= MAX_ENTRY_BYTES,
    })
  } catch {
    throw new TelError("That file isn't a Tessel .tel file.")
  }
  const raw = files['tel.json']
  if (!raw) throw new TelError("That file isn't a Tessel .tel file.")
  let parsed: z.infer<typeof TelJson>
  try {
    parsed = TelJson.parse(JSON.parse(strFromU8(raw)))
  } catch {
    throw new TelError('That .tel file is damaged.')
  }
  if (parsed.schemaVersion > PROFILE_SCHEMA_VERSION)
    throw new TelError('That .tel was made with a newer Tessel. Update Tessel to open it.')
  // Tiles go through the same migrations as profiles, wrapped in a one-page profile.
  const migrated = migrateProfile(parsed.schemaVersion, {
    pages: [{ tiles: parsed.tiles }],
  }) as { pages: [{ tiles: unknown[] }] }
  const tiles = migrated.pages[0].tiles.map((t, i) => {
    const r = Tile.safeParse(t)
    if (!r.success)
      throw new TelError(
        `Tile ${i + 1} in that .tel isn't valid: ${r.error.issues[0]?.message ?? 'unknown problem'}`,
      )
    return r.data
  })
  if (tiles.some((t) => t.kind === 'folder'))
    throw new TelError('Folders can’t be shared in a .tel yet.')
  const blocks: Record<string, string> = {}
  for (const [name, data] of Object.entries(files)) {
    const id = BLOCK_FILE.exec(name)?.[1]
    if (id) blocks[id] = strFromU8(data)
  }
  const names = Object.keys(blocks)
  const missing = myBlockIds(tiles).filter(
    (id) => !(id in blocks) && !names.some((f) => id.startsWith(`${f}-`)),
  )
  if (missing.length)
    throw new TelError(`That .tel uses My blocks it doesn't include: ${missing.join(', ')}.`)
  return {
    name: parsed.name,
    ...(parsed.page && { page: parsed.page }),
    tiles,
    variables: parsed.variables,
    plugins: parsed.plugins,
    blocks,
  }
}

/**
 * Picks file names for incoming My blocks. A block whose file already exists with the same code
 * is reused; one with different code gets a new id, and the tiles are pointed at it.
 */
export function planBlocks(
  incoming: Record<string, string>,
  existing: Record<string, string>,
): { write: Record<string, string>; rename: Record<string, string> } {
  const write: Record<string, string> = {}
  const rename: Record<string, string> = {}
  for (const [id, src] of Object.entries(incoming)) {
    if (existing[id] === undefined) write[id] = src
    else if (existing[id] !== src) {
      let n = 2
      while (existing[`${id}-${n}`] !== undefined && existing[`${id}-${n}`] !== src) n++
      const next = `${id}-${n}`
      if (existing[next] === undefined) write[next] = src
      rename[id] = next
    }
  }
  return { write, rename }
}

/** Points tiles at renamed My blocks. */
export function renameBlocks(tiles: Tile[], rename: Record<string, string>): Tile[] {
  if (Object.keys(rename).length === 0) return tiles
  return tiles.map((t) => ({
    ...t,
    graph: {
      ...t.graph,
      nodes: t.graph.nodes.map((n) => {
        const id = n.type.startsWith(MY_BLOCKS) ? n.type.slice(MY_BLOCKS.length) : undefined
        const to = id && rename[id]
        return to ? { ...n, type: MY_BLOCKS + to } : n
      }),
    },
  }))
}
