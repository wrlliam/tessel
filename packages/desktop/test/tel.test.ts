import { Tile } from '@tessel/core'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  myBlockIds,
  packTel,
  planBlocks,
  renameBlocks,
  unpackTel,
  variablesUsed,
} from '../src/main/tel.ts'

const tile = (
  id: string,
  nodes: Array<{ id: string; type: string; params?: Record<string, unknown> }>,
) =>
  Tile.parse({
    id,
    label: id,
    position: { col: 0, row: 0 },
    appearanceBindings: [{ field: 'label', expression: 'Count {{var.count}}' }],
    graph: {
      nodes: nodes.map((n) => ({ params: {}, position: { x: 0, y: 0 }, ...n })),
      edges: [],
    },
  })

const branch = tile('branch', [
  { id: 'p', type: 'trigger.press' },
  { id: 'b', type: 'my-blocks.git-branch' },
  { id: 's', type: 'data.setVariable', params: { name: 'lastBranch' } },
])

describe('.tel files', () => {
  it('round-trips tiles, variables, plugins and My blocks code', () => {
    const bytes = packTel({
      name: 'Branch',
      tiles: [branch],
      variables: { count: 3 },
      plugins: ['home-assistant'],
      blocks: { 'git-branch': 'export default 1' },
    })
    const back = unpackTel(bytes)
    expect(back.name).toBe('Branch')
    expect(back.tiles[0]?.graph.nodes[1]?.type).toBe('my-blocks.git-branch')
    expect(back.blocks).toEqual({ 'git-branch': 'export default 1' })
    expect(back.plugins).toEqual(['home-assistant'])
    expect(back.variables).toEqual({ count: 3 })
  })

  it('finds what tiles use', () => {
    expect(myBlockIds([branch])).toEqual(['git-branch'])
    expect(variablesUsed([branch])).toEqual(['count', 'lastBranch'])
  })

  it('refuses a .tel whose code is missing, or anything that is not one', () => {
    const bytes = packTel({ name: 'x', tiles: [branch], variables: {}, plugins: [], blocks: {} })
    expect(() => unpackTel(bytes)).toThrow(/doesn't include: git-branch/)
    expect(() => unpackTel(zipSync({ 'other.json': strToU8('{}') }))).toThrow(/isn't a Tessel/)
    expect(() => unpackTel(strToU8('not a zip'))).toThrow(/isn't a Tessel/)
  })

  it('ignores files outside blocks/ and odd names', () => {
    const bytes = zipSync({
      'tel.json': strToU8(
        JSON.stringify({
          format: 'tessel-tiles',
          version: 1,
          schemaVersion: 2,
          name: 'x',
          tiles: [branch],
        }),
      ),
      'blocks/git-branch.ts': strToU8('ok'),
      'blocks/../../evil.ts': strToU8('no'),
      'index.ts': strToU8('no'),
    })
    expect(Object.keys(unpackTel(bytes).blocks)).toEqual(['git-branch'])
  })

  it('migrates tiles from older Tessels', () => {
    const old = {
      id: 'm',
      label: 'Mute',
      position: { col: 0, row: 0 },
      graph: {
        nodes: [
          { id: 'p', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
          {
            id: 'c',
            type: 'action.keyCombo',
            params: { combo: 'mod+shift+m' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    }
    const bytes = zipSync({
      'tel.json': strToU8(
        JSON.stringify({
          format: 'tessel-tiles',
          version: 1,
          schemaVersion: 1,
          name: 'Old',
          tiles: [old],
        }),
      ),
    })
    expect(unpackTel(bytes).tiles[0]?.graph.nodes[1]?.type).toBe('action.appCommand')
  })

  it('reuses identical blocks and renames clashing ones', () => {
    const plan = planBlocks({ same: 'A', clash: 'new', fresh: 'F' }, { same: 'A', clash: 'old' })
    expect(plan.write).toEqual({ 'clash-2': 'new', fresh: 'F' })
    expect(plan.rename).toEqual({ clash: 'clash-2' })
    const t = tile('t', [{ id: 'b', type: 'my-blocks.clash' }])
    expect(renameBlocks([t], plan.rename)[0]?.graph.nodes[0]?.type).toBe('my-blocks.clash-2')
  })
})
