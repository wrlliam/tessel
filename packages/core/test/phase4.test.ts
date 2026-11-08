import { describe, expect, it, vi } from 'vitest'
import {
  applyChange,
  createRegistry,
  Page,
  Profile,
  resolveAppearance,
  templates,
  Tile,
  toPhoneProfile,
  validateGraph,
  type Graph,
} from '../src/index.ts'
import { node, press, setup, tile, wire } from './helpers.ts'

const folderProfile = (tiles: unknown[], folderTiles: unknown[] = []) => ({
  id: 'p',
  name: 'P',
  pages: [
    { id: 'home', name: 'Home', tiles },
    { id: 'f', name: 'Apps', kind: 'folder', tiles: folderTiles },
  ],
})
const folderTile = { id: 'ft', kind: 'folder', targetPageId: 'f', position: { col: 0, row: 0 } }

describe('folders', () => {
  it('accepts a folder tile pointing at a folder page', () => {
    expect(Profile.safeParse(folderProfile([folderTile])).success).toBe(true)
  })

  it('keeps the top-left slot of a folder free for the Back tile', () => {
    const r = Page.safeParse({
      id: 'f',
      name: 'F',
      kind: 'folder',
      tiles: [{ id: 't', position: { col: 0, row: 0 } }],
    })
    expect(r.error?.issues[0]?.message).toContain('overlaps tile "Back"')
  })

  it('refuses a folder tile that points at an ordinary page', () => {
    const r = Profile.safeParse({
      id: 'p',
      name: 'P',
      pages: [
        { id: 'a', name: 'A', tiles: [{ ...folderTile, targetPageId: 'b' }] },
        { id: 'b', name: 'B' },
      ],
    })
    expect(r.success).toBe(false)
  })

  it('needs at least one ordinary page', () => {
    expect(
      Profile.safeParse({ id: 'p', name: 'P', pages: [{ id: 'f', name: 'F', kind: 'folder' }] })
        .success,
    ).toBe(false)
  })

  it('sends page kinds and folder targets to the phone', () => {
    const phone = toPhoneProfile(Profile.parse(folderProfile([folderTile])))
    expect(phone.pages.map((p) => p.kind)).toEqual(['page', 'folder'])
    expect(phone.pages[0]?.tiles[0]?.targetPageId).toBe('f')
  })
})

describe('appearance', () => {
  const base = Tile.parse({
    id: 't',
    label: 'Mic',
    colour: '#22D3C5',
    icon: 'mic',
    position: { col: 0, row: 0 },
    appearanceBindings: [
      { field: 'label', expression: 'Count {{var.n}}' },
      { field: 'colour', expression: '{{var.muted ? "#F25C6E" : "#22D3C5"}}' },
      { field: 'icon', expression: '{{nope(}}' },
    ],
  })

  it('applies bindings over the tile and skips broken ones', () => {
    expect(resolveAppearance(base, { var: { n: 3, muted: true } })).toEqual({
      label: 'Count 3',
      colour: '#F25C6E',
      icon: 'mic',
    })
  })

  it('ignores a binding that produces an invalid colour', () => {
    const t = { ...base, appearanceBindings: [{ field: 'colour' as const, expression: 'red' }] }
    expect(resolveAppearance(t, {}).colour).toBe('#22D3C5')
  })

  it('lets run-time changes win over bindings', () => {
    expect(resolveAppearance(base, { var: { n: 1 } }, { label: 'Live', icon: '' })).toMatchObject({
      label: 'Live',
      icon: '',
    })
  })

  it('layers and resets changes', () => {
    const one = applyChange(undefined, { label: 'A' })
    expect(applyChange(one, { colour: '#000000' })).toEqual({ label: 'A', colour: '#000000' })
    expect(applyChange(one, 'reset')).toBeUndefined()
  })

  it('Set tile appearance reports changes for the running tile', async () => {
    const onAppearance = vi.fn()
    const { engine } = setup({ onAppearance })
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('s', 'action.setTileAppearance', {
          label: 'On',
          colour: '#F25C6E',
          icon: '',
          reset: false,
        }),
      ],
      edges: [wire('p.out', 's.in')],
    }
    await engine.trigger(tile(graph), press)
    expect(onAppearance).toHaveBeenCalledWith('tile', { label: 'On', colour: '#F25C6E' }, false)
  })
})

describe('templates', () => {
  const registry = createRegistry()
  it.each(templates.map((t) => [t.id, t] as const))(
    '%s is a valid tile with a valid graph',
    (_, t) => {
      const parsed = Tile.safeParse({ ...t.tile, id: 'x', position: { col: 0, row: 0 } })
      expect(parsed.success).toBe(true)
      expect(validateGraph(t.tile.graph, registry).filter((i) => i.severity === 'error')).toEqual(
        [],
      )
    },
  )
})
