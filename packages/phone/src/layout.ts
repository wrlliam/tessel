import type { PhonePage, PhoneTile } from '@tessel/core'

export interface GridFit {
  size: number
  gap: number
}

export interface Cells {
  /** Cell width and height; equal unless the grid is stretched to fill. */
  width: number
  height: number
  gap: number
}

/** Cell size for a grid: square keys that fit, or keys stretched to fill the whole box. */
export function cellsFor(
  width: number,
  height: number,
  cols: number,
  rows: number,
  gap: number,
  fill: boolean,
): Cells {
  if (!fill) {
    const { size } = fitGrid(width, height, cols, rows, gap)
    return { width: size, height: size, gap }
  }
  const w = Math.floor((width - gap * (cols - 1)) / cols)
  const h = Math.floor((height - gap * (rows - 1)) / rows)
  return { width: Math.max(w, 0), height: Math.max(h, 0), gap }
}

export const GAP = { compact: 8, regular: 12, roomy: 16 } as const

/** Largest square key size that fits `cols` x `rows` into the given box. */
export function fitGrid(
  width: number,
  height: number,
  cols: number,
  rows: number,
  gap: number = GAP.regular,
): GridFit {
  const size = Math.floor(
    Math.min((width - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / rows),
  )
  return { size: Math.max(size, 0), gap }
}

/** In landscape, swap rows and columns so a tall grid uses the wide screen. */
export function orient(page: PhonePage, landscape: boolean): PhonePage {
  if (!landscape || page.cols >= page.rows) return page
  return {
    ...page,
    cols: page.rows,
    rows: page.cols,
    tiles: page.tiles.map((t): PhoneTile => ({
      ...t,
      position: { col: t.position.row, row: t.position.col },
      span: { w: t.span.h, h: t.span.w },
    })),
  }
}

/** Keys wider than this, relative to their height, start to look like bars. */
const MAX_ASPECT = 1.5

/**
 * Lays a page out again for a wide screen: keys keep their reading order (row by row) and
 * width, become one row tall, and fill rows of whatever column count gives the biggest keys.
 * Empty slots are dropped, so a tall, sparse page fits sideways without shrinking.
 */
export function reflow(page: PhonePage, width: number, height: number, gap: number): PhonePage {
  const ordered = [...page.tiles].sort(
    (a, b) => a.position.row - b.position.row || a.position.col - b.position.col,
  )
  if (ordered.length === 0 || width <= 0 || height <= 0) return page
  const widest = Math.max(...ordered.map((t) => t.span.w))
  let best: { page: PhonePage; score: number } | undefined
  for (let cols = Math.max(1, widest); cols <= Math.max(widest, ordered.length * 2, 12); cols++) {
    const placed = pack(ordered, cols)
    const rows = Math.max(1, ...placed.map((t) => t.position.row + 1))
    const cellW = (width - gap * (cols - 1)) / cols
    const cellH = (height - gap * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue
    // Bigger keys win; keys much wider than tall lose a little, so rows stay key-shaped.
    const aspect = cellW / cellH
    const score = Math.min(cellW, cellH) * (aspect > MAX_ASPECT ? MAX_ASPECT / aspect : 1) ** 0.25
    if (!best || score > best.score + 0.5)
      best = { page: { ...page, cols, rows, tiles: placed }, score }
  }
  return best?.page ?? page
}

function pack(tiles: PhoneTile[], cols: number): PhoneTile[] {
  let col = 0
  let row = 0
  return tiles.map((t) => {
    const w = Math.min(t.span.w, cols)
    if (col + w > cols) {
      col = 0
      row++
    }
    const placed: PhoneTile = { ...t, position: { col, row }, span: { w, h: 1 } }
    col += w
    return placed
  })
}
