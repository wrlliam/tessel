import { z } from 'zod'

export const PROFILE_SCHEMA_VERSION = 1

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
    /** Sub-page opened by a folder tile. */
    targetPageId: Id.optional(),
    graph: Graph.default({ nodes: [], edges: [] }),
    /** What a press does while the tile is still running. */
    concurrency: z.enum(['ignore', 'restart', 'queue']).default('queue'),
    appearanceBindings: z.array(AppearanceBinding).default([]),
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
