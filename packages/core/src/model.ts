import { z } from 'zod'

export const PROFILE_SCHEMA_VERSION = 3

const Id = z.string().min(1).max(64)
const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a colour like #22D3C5')

export const JsonValue = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type JsonValue = z.infer<typeof JsonValue>

export const GraphNode = z.object({
  id: Id,
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
})
export type GraphNode = z.infer<typeof GraphNode>

const PortRef = z.object({ nodeId: Id, port: z.string().min(1) })

export const GraphEdge = z.object({
  id: Id,
  from: PortRef,
  to: PortRef,
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const Graph = z.object({
  nodes: z.array(GraphNode).default([]),
  edges: z.array(GraphEdge).default([]),
})
export type Graph = z.infer<typeof Graph>

export const AppearanceBinding = z.object({
  field: z.enum(['label', 'colour', 'icon']),
  /** Template evaluated against tile state, e.g. '{{state.muted ? "#F25C6E" : "#212833"}}'. */
  expression: z.string(),
})
export type AppearanceBinding = z.infer<typeof AppearanceBinding>

/** A colour that takes over from `from` upwards, e.g. amber from 70, red from 90. */
export const DisplayZone = z.object({ from: z.number(), colour: HexColour })
export type DisplayZone = z.infer<typeof DisplayZone>

/**
 * A graphic on the key instead of plain text: a ring or bar that fills with a number, or a
 * chart of how it changed. Charts keep a history you can scroll back through on the phone.
 */
export const TileDisplay = z.object({
  kind: z.enum(['ring', 'bar', 'line', 'columns']),
  /** Template giving the number, e.g. '{{state.reading}}'. */
  value: z.string().max(500).default('{{state.reading}}'),
  min: z.number().default(0),
  max: z.number().default(100),
  /** Shown after the number, e.g. '%' or ' dB'. */
  unit: z.string().max(8).default(''),
  decimals: z.int().min(0).max(2).default(0),
  /** Lowest first. Below the first zone the tile's own colour is used. */
  zones: z.array(DisplayZone).max(6).default([]),
})
export type TileDisplay = z.infer<typeof TileDisplay>

export const Tile = z
  .object({
    id: Id,
    label: z.string().max(40).default(''),
    icon: z.string().max(64).optional(),
    colour: HexColour.default('#161B22'),
    position: z.object({ col: z.int().min(0), row: z.int().min(0) }),
    span: z.object({ w: z.int().min(1), h: z.int().min(1) }).default({ w: 1, h: 1 }),
    /** Slider tiles show a bar on the phone; dragging it runs On slide with the new value. */
    kind: z.enum(['action', 'folder', 'slider']).default('action'),
    /** A small picture (data: URL) shown instead of the icon. */
    image: z
      .string()
      .max(280_000)
      .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'Not a picture')
      .optional(),
    /** Key style for this tile only; empty follows the phone setting. */
    style: z.enum(['tinted', 'solid', 'outline', 'glass']).optional(),
    /** Sub-page opened by a folder tile. */
    targetPageId: Id.optional(),
    graph: Graph.default({ nodes: [], edges: [] }),
    /** What a press does while the tile is still running. */
    concurrency: z.enum(['ignore', 'restart', 'queue']).default('queue'),
    appearanceBindings: z.array(AppearanceBinding).default([]),
    /** Draws the number as a ring, bar or chart. */
    display: TileDisplay.optional(),
  })
  .refine((t) => t.kind !== 'folder' || t.targetPageId !== undefined, {
    message: 'Folder tiles need a targetPageId',
    path: ['targetPageId'],
  })
export type Tile = z.infer<typeof Tile>

export const Page = z
  .object({
    id: Id,
    name: z.string().min(1).max(40),
    /** 'page' pages are swiped between; 'folder' pages open from a folder tile. */
    kind: z.enum(['page', 'folder']).default('page'),
    cols: z.int().min(1).max(12).default(3),
    rows: z.int().min(1).max(12).default(5),
    tiles: z.array(Tile).default([]),
  })
  .superRefine((page, ctx) => {
    const taken = new Map<string, string>()
    // Phones draw the Back tile in the top-left slot of every folder.
    if (page.kind === 'folder') taken.set('0,0', 'Back')
    page.tiles.forEach((tile, i) => {
      const { col, row } = tile.position
      const { w, h } = tile.span
      if (col + w > page.cols || row + h > page.rows) {
        ctx.addIssue({
          code: 'custom',
          message: `Tile "${tile.id}" does not fit in a ${page.cols}x${page.rows} grid`,
          path: ['tiles', i],
        })
        return
      }
      for (let c = col; c < col + w; c++) {
        for (let r = row; r < row + h; r++) {
          const other = taken.get(`${c},${r}`)
          if (other) {
            ctx.addIssue({
              code: 'custom',
              message: `Tile "${tile.id}" overlaps tile "${other}"`,
              path: ['tiles', i],
            })
            return
          }
          taken.set(`${c},${r}`, tile.id)
        }
      }
    })
  })
export type Page = z.infer<typeof Page>

export const Profile = z
  .object({
    id: Id,
    name: z.string().min(1).max(40),
    pages: z.array(Page).min(1),
    variables: z.record(z.string(), JsonValue).default({}),
    /** Values tiles keep between runs (Toggle), by tile id. */
    tileState: z.record(z.string(), z.record(z.string(), JsonValue)).default({}),
  })
  .superRefine((profile, ctx) => {
    const pageIds = new Set(profile.pages.map((p) => p.id))
    if (pageIds.size !== profile.pages.length) {
      ctx.addIssue({ code: 'custom', message: 'Page ids must be unique', path: ['pages'] })
    }
    if (!profile.pages.some((p) => p.kind === 'page')) {
      ctx.addIssue({
        code: 'custom',
        message: 'A profile needs at least one page',
        path: ['pages'],
      })
    }
    const folderPages = new Set(profile.pages.filter((p) => p.kind === 'folder').map((p) => p.id))
    const tileIds = new Set<string>()
    profile.pages.forEach((page, pi) =>
      page.tiles.forEach((tile, ti) => {
        if (tileIds.has(tile.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate tile id "${tile.id}"`,
            path: ['pages', pi, 'tiles', ti],
          })
        }
        tileIds.add(tile.id)
        if (tile.kind === 'folder' && tile.targetPageId && !folderPages.has(tile.targetPageId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Folder tile "${tile.id}" points at "${tile.targetPageId}", which is not a folder page`,
            path: ['pages', pi, 'tiles', ti, 'targetPageId'],
          })
        }
      }),
    )
  })
export type Profile = z.infer<typeof Profile>

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Upgrades saved profiles. Each entry turns version `n` into `n + 1`.
 *
 * 1 -> 2: the first "Mute mic in Discord" template pressed Cmd/Ctrl+Shift+M without bringing
 * Discord to the front, and Discord only hears its shortcuts when focused. Those tiles now use
 * the Discord: mute app command, which focuses Discord first.
 */
export const profileMigrations: Record<number, (data: unknown) => unknown> = {
  1: (data) => {
    if (!isObj(data) || !Array.isArray(data['pages'])) return data
    for (const page of data['pages'] as unknown[]) {
      if (!isObj(page) || !Array.isArray(page['tiles'])) continue
      for (const tile of page['tiles'] as unknown[]) {
        if (!isObj(tile) || !isObj(tile['graph'])) continue
        const nodes = tile['graph']['nodes']
        if (!Array.isArray(nodes) || nodes.length !== 2) continue
        const combo = nodes.find(
          (n): n is Json =>
            isObj(n) &&
            n['type'] === 'action.keyCombo' &&
            isObj(n['params']) &&
            n['params']['combo'] === 'mod+shift+m',
        )
        if (combo && nodes.some((n) => isObj(n) && n['type'] === 'trigger.press')) {
          combo['type'] = 'action.appCommand'
          combo['params'] = { command: 'discord.mute', focus: true }
        }
      }
    }
    return data
  },
  // Voicemeeter gain sliders made before hold-to-reset get it: hold sets 0 dB and moves the bar.
  2: (data) => {
    if (!isObj(data) || !Array.isArray(data['pages'])) return data
    for (const page of data['pages'] as unknown[]) {
      if (!isObj(page) || !Array.isArray(page['tiles'])) continue
      for (const tile of page['tiles'] as unknown[]) {
        if (!isObj(tile) || tile['kind'] !== 'slider' || !isObj(tile['graph'])) continue
        const nodes = tile['graph']['nodes']
        const edges = tile['graph']['edges']
        if (!Array.isArray(nodes) || !Array.isArray(edges)) continue
        const has = (type: string) => nodes.some((n) => isObj(n) && n['type'] === type)
        const gain = nodes.find(
          (n): n is Json => isObj(n) && n['type'] === 'voicemeeter.setGain' && isObj(n['params']),
        )
        if (!gain || !has('trigger.slide') || has('trigger.longPress')) continue
        const params = gain['params'] as Json
        const ids = new Set(nodes.map((n) => (isObj(n) ? n['id'] : undefined)))
        const fresh = (base: string) => {
          let id = base
          for (let i = 2; ids.has(id); i++) id = `${base}${i}`
          ids.add(id)
          return id
        }
        const [hold, reset, bar] = [fresh('hold'), fresh('reset'), fresh('bar')]
        const at = (x: number) => ({ x, y: 160 })
        nodes.push(
          { id: hold, type: 'trigger.longPress', params: {}, position: at(0) },
          {
            id: reset,
            type: 'voicemeeter.setGain',
            params: { target: params['target'], index: params['index'], gain: 0 },
            position: at(288),
          },
          { id: bar, type: 'action.setSlider', params: { value: 0, tile: '' }, position: at(576) },
        )
        const wire = (from: string, to: string) => ({
          id: `${from}-${to}`,
          from: { nodeId: from, port: 'out' },
          to: { nodeId: to, port: 'in' },
        })
        edges.push(wire(hold, reset), wire(reset, bar))
      }
    }
    return data
  },
}

/** Brings profile data saved at `version` up to PROFILE_SCHEMA_VERSION. */
export function migrateProfile(version: number, data: unknown): unknown {
  let out = data
  for (let v = version; v < PROFILE_SCHEMA_VERSION; v++) out = profileMigrations[v]?.(out) ?? out
  return out
}
