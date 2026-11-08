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
