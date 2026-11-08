import type { PhonePage } from '@tessel/core'
import { describe, expect, it } from 'vitest'
import { fitGrid, orient, textOn } from '../src/layout.ts'

describe('fitGrid', () => {
  it('fits a 3x5 grid on a portrait phone, limited by width', () => {
    const { size, gap } = fitGrid(390, 760, 3, 5)
    expect(3 * size + 2 * gap).toBeLessThanOrEqual(390)
    expect(5 * size + 4 * gap).toBeLessThanOrEqual(760)
    expect(size).toBeGreaterThanOrEqual(64)
  })

  it('never returns a negative size', () => {
    expect(fitGrid(0, 0, 3, 5).size).toBe(0)
  })
})

describe('orient', () => {
  const page: PhonePage = {
    id: 'p',
    name: 'P',
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
