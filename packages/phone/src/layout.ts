import type { PhonePage, PhoneTile } from '@tessel/core'

export interface GridFit {
  size: number
  gap: number
}

/** Largest square tile size that fits `cols` x `rows` into the given box. */
export function fitGrid(width: number, height: number, cols: number, rows: number): GridFit {
  const gap = Math.round(Math.min(width, height) * 0.03)
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

/** Ink or Paper text, whichever reads better on the tile colour. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.25 ? '#0E1116' : '#F4F6F8'
}
