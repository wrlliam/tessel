import type { PhonePage } from '@tessel/core'
import { describe, expect, it } from 'vitest'
import { textOn } from '@tessel/brand/key'
import { fitGrid, GAP, orient, reflow } from '../src/layout.ts'

describe('fitGrid', () => {
  it('fits a 3x5 grid on a portrait phone, limited by width', () => {
    const { size, gap } = fitGrid(390, 760, 3, 5)
    expect(3 * size + 2 * gap).toBeLessThanOrEqual(390)
    expect(5 * size + 4 * gap).toBeLessThanOrEqual(760)
    expect(size).toBeGreaterThanOrEqual(64)
  })

  it('uses the spacing setting for gaps', () => {
    expect(fitGrid(390, 760, 3, 5, GAP.roomy).gap).toBe(16)
    expect(fitGrid(390, 760, 3, 5, GAP.compact).size).toBeGreaterThan(
      fitGrid(390, 760, 3, 5, GAP.roomy).size,
    )
  })

  it('never returns a negative size', () => {
    expect(fitGrid(0, 0, 3, 5).size).toBe(0)
  })
})

describe('orient', () => {
  const page: PhonePage = {
    id: 'p',
    name: 'P',
    kind: 'page',
    cols: 3,
    rows: 5,
    tiles: [
      {
        id: 't',
        label: '',
        colour: '#000000',
        kind: 'action',
        position: { col: 2, row: 1 },
        span: { w: 1, h: 2 },
      },
    ],
  }

  it('leaves portrait alone', () => {
    expect(orient(page, false)).toBe(page)
  })

  it('transposes a tall grid in landscape', () => {
    const turned = orient(page, true)
    expect([turned.cols, turned.rows]).toEqual([5, 3])
    expect(turned.tiles[0]).toMatchObject({ position: { col: 1, row: 2 }, span: { w: 2, h: 1 } })
  })
})

describe('textOn', () => {
  it('uses dark text on bright tiles and light text on dark tiles', () => {
    expect(textOn('#22D3C5')).toBe('#0E1116')
    expect(textOn('#161B22')).toBe('#F4F6F8')
  })
})

describe('reflow', () => {
  const tile = (id: string, col: number, row: number, w = 1) => ({
    id,
    label: id,
    colour: '#212833',
    kind: 'action' as const,
    position: { col, row },
    span: { w, h: 1 },
  })
  const tall = {
    id: 'p',
    name: 'P',
    kind: 'page' as const,
    cols: 3,
    rows: 5,
    tiles: [
      tile('a', 0, 0),
      tile('b', 1, 0),
      tile('c', 2, 0),
      tile('d', 0, 1),
      tile('e', 1, 1),
      tile('f', 2, 1),
      tile('g', 0, 2, 2),
      tile('h', 2, 2),
      tile('i', 0, 3),
      tile('j', 1, 3),
      tile('k', 2, 3),
      tile('l', 0, 4, 3),
    ],
  }

  it('makes keys bigger than the stretched tall grid on a wide screen', () => {
    const out = reflow(tall, 800, 330, 12)
    const cellH = (330 - 12 * (out.rows - 1)) / out.rows
    const tallCellH = (330 - 12 * 4) / 5
    expect(out.rows).toBeLessThan(5)
    expect(cellH).toBeGreaterThan(tallCellH * 1.4)
  })

  it('keeps reading order and widths, and never overlaps', () => {
    const out = reflow(tall, 800, 330, 12)
    expect(out.tiles.map((t) => t.id)).toEqual(tall.tiles.map((t) => t.id))
    const taken = new Set<string>()
    for (const t of out.tiles) {
      expect(t.span.w).toBe(Math.min(tall.tiles.find((x) => x.id === t.id)!.span.w, out.cols))
      for (let c = t.position.col; c < t.position.col + t.span.w; c++) {
        const key = `${c},${t.position.row}`
        expect(taken.has(key)).toBe(false)
        taken.add(key)
      }
      expect(t.position.col + t.span.w).toBeLessThanOrEqual(out.cols)
    }
  })
})
