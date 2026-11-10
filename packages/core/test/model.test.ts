import { describe, expect, it } from 'vitest'
import { Page, Profile, sampleProfile } from '../src/index.ts'

const page = (tiles: unknown[], cols = 3, rows = 5) => ({ id: 'p', name: 'P', cols, rows, tiles })

describe('Page', () => {
  it('fills defaults for a minimal tile', () => {
    const parsed = Page.parse(page([{ id: 't', position: { col: 0, row: 0 } }]))
    expect(parsed.tiles[0]).toMatchObject({
      label: '',
      kind: 'action',
      span: { w: 1, h: 1 },
      graph: { nodes: [], edges: [] },
    })
  })

  it('rejects tiles outside the grid', () => {
    const result = Page.safeParse(
      page([{ id: 't', position: { col: 2, row: 0 }, span: { w: 2, h: 1 } }]),
    )
    expect(result.success).toBe(false)
  })

  it('rejects overlapping tiles', () => {
    const result = Page.safeParse(
      page([
        { id: 'a', position: { col: 0, row: 0 }, span: { w: 2, h: 2 } },
        { id: 'b', position: { col: 1, row: 1 } },
      ]),
    )
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('overlaps')
  })

  it('requires a target page on folder tiles', () => {
    const result = Page.safeParse(page([{ id: 'f', kind: 'folder', position: { col: 0, row: 0 } }]))
    expect(result.success).toBe(false)
  })
})

describe('Profile', () => {
  it('accepts the sample profile', () => {
    expect(Profile.safeParse(sampleProfile).success).toBe(true)
  })

  it('rejects duplicate tile ids across pages', () => {
    const tile = { id: 'dup', position: { col: 0, row: 0 } }
    const result = Profile.safeParse({
      id: 'x',
      name: 'X',
      pages: [
        { id: 'a', name: 'A', tiles: [tile] },
        { id: 'b', name: 'B', tiles: [tile] },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects folder tiles pointing at a missing page', () => {
    const result = Profile.safeParse({
      id: 'x',
      name: 'X',
      pages: [
        {
          id: 'a',
          name: 'A',
          tiles: [{ id: 'f', kind: 'folder', targetPageId: 'nope', position: { col: 0, row: 0 } }],
        },
      ],
    })
    expect(result.success).toBe(false)
  })
})

describe('tile displays', () => {
  it('works out the number, its zone colour and text', async () => {
    const { resolveMeter, toPhoneProfile, Tile, Profile } = await import('../src/index.ts')
    const tile = Tile.parse({
      id: 't',
      position: { col: 0, row: 0 },
      colour: '#212833',
      display: {
        kind: 'columns',
        unit: ' dB',
        decimals: 1,
        zones: [{ from: 50, colour: '#F5B63D' }],
      },
    })
    expect(resolveMeter(tile, { state: { reading: 62.34 } }, tile.colour)).toEqual({
      value: 62.34,
      colour: '#F5B63D',
      text: '62.3 dB',
    })
    expect(resolveMeter(tile, { state: {} }, tile.colour)).toMatchObject({ value: null, text: '–' })
    const phone = toPhoneProfile(
      Profile.parse({ id: 'p', name: 'P', pages: [{ id: 'pg', name: 'Pg', tiles: [tile] }] }),
    )
    // A chart with no On press opens its history when tapped.
    expect(phone.pages[0]!.tiles[0]).toMatchObject({
      opensHistory: true,
      display: { kind: 'columns' },
    })
  })
})
