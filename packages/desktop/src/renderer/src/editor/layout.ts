import type { Page, Profile } from '@tessel/core'

export interface Cell {
  col: number
  row: number
}

const key = (c: number, r: number) => `${c},${r}`

/** Cells in use. Folder pages keep the top-left cell for the phone's Back tile. */
export function occupied(page: Page, exceptTileId?: string): Set<string> {
  const taken = new Set<string>(page.kind === 'folder' ? [key(0, 0)] : [])
  for (const t of page.tiles) {
    if (t.id === exceptTileId) continue
    for (let c = t.position.col; c < t.position.col + t.span.w; c++) {
      for (let r = t.position.row; r < t.position.row + t.span.h; r++) taken.add(key(c, r))
    }
  }
  return taken
}

export function fits(
  page: Page,
  at: Cell,
  span: { w: number; h: number },
  exceptTileId?: string,
): boolean {
  if (at.col < 0 || at.row < 0 || span.w < 1 || span.h < 1) return false
  if (at.col + span.w > page.cols || at.row + span.h > page.rows) return false
  const taken = occupied(page, exceptTileId)
  for (let c = at.col; c < at.col + span.w; c++) {
    for (let r = at.row; r < at.row + span.h; r++) if (taken.has(key(c, r))) return false
  }
  return true
}

interface Rect {
  col: number
  row: number
  w: number
  h: number
}
const overlaps = (a: Rect, b: Rect) =>
  a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h

/**
 * Resizing a tile pushes the tiles in its way: right when it grew wider, down when it grew
 * taller (the other way if that doesn't fit), and those push the tiles behind them in turn.
 * Returns where the pushed tiles go, or undefined when something would leave the grid.
 */
export function pushAside(
  page: Page,
  tileId: string,
  span: { w: number; h: number },
): Map<string, Cell> | undefined {
  const tile = page.tiles.find((t) => t.id === tileId)
  if (!tile || span.w < 1 || span.h < 1) return undefined
  const grown: Rect = { ...tile.position, ...span }
  if (grown.col + grown.w > page.cols || grown.row + grown.h > page.rows) return undefined
  // A folder's top-left cell is the phone's Back tile, which can't move.
  if (page.kind === 'folder' && overlaps(grown, { col: 0, row: 0, w: 1, h: 1 })) return undefined
  const wider = span.w - tile.span.w >= span.h - tile.span.h
  const order = wider ? (['right', 'down'] as const) : (['down', 'right'] as const)
  for (const way of order) {
    const moved = push(page, tileId, grown, way)
    if (moved) return moved
  }
  return undefined
}

function push(
  page: Page,
  tileId: string,
  grown: Rect,
  way: 'right' | 'down',
): Map<string, Cell> | undefined {
  const rects = new Map<string, Rect>(
    page.tiles.map((t) => [t.id, t.id === tileId ? grown : { ...t.position, ...t.span }]),
  )
  const moved = new Map<string, Cell>()
  const queue = [tileId]
  // Every push moves a tile further right or down, so this ends; the cap is only a guard.
  for (let steps = 0; queue.length; steps++) {
    if (steps > 500) return undefined
    const id = queue.shift() as string
    const r = rects.get(id) as Rect
    for (const [other, o] of rects) {
      if (other === id || other === tileId || !overlaps(r, o)) continue
      const next = way === 'right' ? { ...o, col: r.col + r.w } : { ...o, row: r.row + r.h }
      if (next.col + next.w > page.cols || next.row + next.h > page.rows) return undefined
      rects.set(other, next)
      moved.set(other, { col: next.col, row: next.row })
      queue.push(other)
    }
  }
  return moved
}

export function freeCells(page: Page): Cell[] {
  const taken = occupied(page)
  const out: Cell[] = []
  for (let row = 0; row < page.rows; row++) {
    for (let col = 0; col < page.cols; col++) if (!taken.has(key(col, row))) out.push({ col, row })
  }
  return out
}

/** Folder pages opened from tiles on this page, and from folders inside those, and so on. */
export function foldersUnder(profile: Profile, pageId: string): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    const page = profile.pages.find((p) => p.id === id)
    for (const t of page?.tiles ?? []) {
      if (t.kind === 'folder' && t.targetPageId && !out.includes(t.targetPageId)) {
        out.push(t.targetPageId)
        visit(t.targetPageId)
      }
    }
  }
  visit(pageId)
  return out
}

/** The page holding the folder tile that opens this folder page. */
export const parentOf = (profile: Profile, folderPageId: string) =>
  profile.pages.find((p) =>
    p.tiles.some((t) => t.kind === 'folder' && t.targetPageId === folderPageId),
  )
