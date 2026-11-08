import {
  builtinBlocks,
  describeBlock,
  sampleProfile,
  type Condition,
  type Graph,
} from '@tessel/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fromCondition, toCondition } from '../src/renderer/src/editor/condition.ts'
import { describeCombo } from '../src/renderer/src/editor/fields/ComboField.tsx'
import {
  connectionProblem,
  copyNodes,
  freeCells,
  pasteNodes,
  removeNodes,
  summarise,
} from '../src/renderer/src/editor/graph-utils.ts'
import { findTile, useEditor } from '../src/renderer/src/editor/store.ts'

const descriptors = builtinBlocks.map(describeBlock)
const blocks = new Map(descriptors.map((b) => [b.id, b]))
const node = (id: string, type: string, params = {}) => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
})
const edge = (id: string, from: string, fp: string, to: string, tp: string) => ({
  id,
  from: { nodeId: from, port: fp },
  to: { nodeId: to, port: tp },
})

describe('connectionProblem', () => {
  const graph: Graph = {
    nodes: [
      node('p', 'trigger.press'),
      node('a', 'logic.delay'),
      node('b', 'logic.delay'),
      node('t', 'data.getTime'),
      node('i', 'logic.if'),
      node('s', 'action.setSetting'),
    ],
    edges: [
      edge('e1', 'p', 'out', 'a', 'in'),
      edge('e2', 'a', 'out', 'b', 'in'),
      edge('e3', 't', 'hour', 'i', 'a'),
    ],
  }
  const check = (f: string, fp: string, t: string, tp: string) =>
    connectionProblem(graph, blocks, { nodeId: f, port: fp }, { nodeId: t, port: tp })

  it('allows a valid flow wire', () => expect(check('b', 'out', 'i', 'in')).toBeNull())
  it('refuses loops', () => expect(check('b', 'out', 'a', 'in')).toMatch(/loop/))
  it('refuses self wires', () => expect(check('a', 'out', 'a', 'in')).toMatch(/itself/))
  it('refuses flow into value', () => expect(check('a', 'out', 'i', 'b')).toMatch(/mixed/))
  it('refuses mismatched types', () =>
    expect(check('t', 'weekday', 's', 'value')).toBe("Can't connect string to boolean"))
  it('refuses a second wire into a value input', () =>
    expect(check('t', 'minute', 'i', 'a')).toMatch(/already/))
  it('lets a number feed a string input', () => {
    const g: Graph = { nodes: [node('t', 'data.getTime'), node('x', 'action.typeText')], edges: [] }
    expect(
      connectionProblem(g, blocks, { nodeId: 't', port: 'hour' }, { nodeId: 'x', port: 'text' }),
    ).toBeNull()
  })
})

describe('copy and paste', () => {
  const graph: Graph = {
    nodes: [node('a', 'logic.delay'), node('b', 'logic.delay'), node('c', 'logic.delay')],
    edges: [edge('e1', 'a', 'out', 'b', 'in'), edge('e2', 'b', 'out', 'c', 'in')],
  }

  it('keeps only wires between copied nodes', () => {
    const clip = copyNodes(graph, ['a', 'b'])
    expect(clip.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(clip.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('pastes with fresh ids, remapped wires and an offset', () => {
    const pasted = pasteNodes(copyNodes(graph, ['a', 'b']))
    const ids = pasted.nodes.map((n) => n.id)
    expect(ids).not.toContain('a')
    expect(pasted.edges[0]?.from.nodeId).toBe(ids[0])
    expect(pasted.edges[0]?.to.nodeId).toBe(ids[1])
    expect(pasted.nodes[0]?.position).toEqual({ x: 32, y: 32 })
  })

  it('removes nodes with their wires', () => {
    expect(removeNodes(graph, ['b'])).toEqual({
      nodes: [graph.nodes[0], graph.nodes[2]],
      edges: [],
    })
  })
})

describe('helpers', () => {
  it('finds free cells', () => {
    const page = sampleProfile.pages[0]
    expect(page && freeCells(page)).toEqual([
      { col: 2, row: 3 },
      { col: 0, row: 4 },
      { col: 1, row: 4 },
      { col: 2, row: 4 },
    ])
  })

  it('summarises params', () => {
    expect(
      summarise(node('o', 'action.openApp', { app: 'Discord' }), blocks.get('action.openApp')),
    ).toBe('Discord')
    expect(
      summarise(
        node('s', 'action.setSetting', { setting: 'darkMode', value: false }),
        blocks.get('action.setSetting'),
      ),
    ).toBe('Dark mode · On: off')
  })

  it('describes combos for each OS', () => {
    expect(describeCombo('mod+shift+s', 'darwin')).toEqual({ ok: true, text: '⌘ ⇧ S' })
    expect(describeCombo('mod+shift+s', 'win32')).toEqual({ ok: true, text: 'Ctrl + Shift + S' })
    expect(describeCombo('ctrl+banana', 'linux').ok).toBe(false)
  })
})

describe('condition builder', () => {
  it('round-trips a single comparison', () => {
    const c = { kind: 'compare', left: '{{input.a}}', op: '>=', right: 18 } as const
    const b = fromCondition(c)
    expect(b).toEqual({
      mode: 'and',
      rows: [{ left: '{{input.a}}', op: '>=', right: '18', negate: false }],
    })
    expect(b && toCondition(b)).toEqual(c)
  })

  it('round-trips groups with not', () => {
    const c: Condition = {
      kind: 'or',
      items: [
        { kind: 'compare', left: 'a', op: '==', right: 'b' },
        { kind: 'not', item: { kind: 'compare', left: 'x', op: 'empty' } },
      ],
    }
    const b = fromCondition(c)
    expect(b?.rows[1]?.negate).toBe(true)
    expect(b && toCondition(b)).toEqual(c)
  })

  it('declines conditions nested deeper than rows', () => {
    expect(
      fromCondition({
        kind: 'and',
        items: [{ kind: 'or', items: [{ kind: 'compare', left: 1, op: 'empty' }] }],
      }),
    ).toBeNull()
  })
})

describe('editor store', () => {
  beforeEach(() => {
    useEditor.setState(useEditor.getInitialState(), true)
    useEditor.getState().load(structuredClone(sampleProfile), descriptors)
  })
  const s = () => useEditor.getState()
  const tile = () => findTile(s().profile, s().selectedTileId)

  it('selects the first tile on load', () => {
    expect(s().selectedTileId).toBe('discord')
  })

  it('adds blocks with their defaults and selects them', () => {
    s().addNode('logic.delay', { x: 10, y: 20 })
    const added = tile()?.graph.nodes.at(-1)
    expect(added).toMatchObject({
      type: 'logic.delay',
      params: { ms: 500 },
      position: { x: 10, y: 20 },
    })
    expect(s().selectedNodeIds).toEqual([added?.id])
    expect(s().save.kind).toBe('pending')
  })

  it('undoes and redoes', () => {
    s().updateTile('discord', { label: 'Chat' })
    expect(tile()?.label).toBe('Chat')
    s().undo()
    expect(tile()?.label).toBe('Discord')
    s().redo()
    expect(tile()?.label).toBe('Chat')
  })

  it('groups rapid edits to the same field into one undo step', () => {
    s().updateTile('discord', { label: 'D' }, 'label')
    s().updateTile('discord', { label: 'Di' }, 'label')
    s().updateTile('discord', { label: 'Dis' }, 'label')
    s().undo()
    expect(tile()?.label).toBe('Discord')
  })

  it('starts a new undo step after a pause', () => {
    vi.useFakeTimers()
    try {
      s().updateTile('discord', { label: 'A' }, 'label')
      vi.advanceTimersByTime(2000)
      s().updateTile('discord', { label: 'AB' }, 'label')
      s().undo()
      expect(tile()?.label).toBe('A')
    } finally {
      vi.useRealTimers()
    }
  })

  it('copies and pastes nodes', () => {
    s().selectNodes(['action'])
    s().copy()
    s().paste()
    expect(tile()?.graph.nodes).toHaveLength(3)
    expect(s().selectedNodeIds).toHaveLength(1)
    expect(s().selectedNodeIds[0]).not.toBe('action')
  })

  it('adds a tile with a trigger in an empty cell', () => {
    s().addTile({ col: 2, row: 4 })
    expect(tile()).toMatchObject({
      position: { col: 2, row: 4 },
      graph: { nodes: [{ type: 'trigger.press' }] },
    })
  })

  it('duplicates a tile into the first free cell with fresh node ids', () => {
    s().duplicateTile('dark')
    const copy = tile()
    expect(copy).toMatchObject({ label: 'Dark mode by time copy', position: { col: 2, row: 3 } })
    expect(copy?.graph.nodes.map((n) => n.id)).not.toContain('if')
    expect(copy?.graph.edges).toHaveLength(4)
  })

  it('clears selection when undo removes the selected tile', () => {
    s().addTile({ col: 2, row: 4 })
    s().undo()
    expect(s().selectedTileId).toBeNull()
  })

  it('tracks engine events per tile', () => {
    s().applyEngineEvent({ type: 'run:start', runId: 'r', tileId: 'discord', trigger: 'press' })
    s().applyEngineEvent({
      type: 'node',
      runId: 'r',
      tileId: 'discord',
      nodeId: 'action',
      status: 'error',
      error: 'Nope',
    })
    expect(s().runningTiles['discord']).toBe(true)
    s().applyEngineEvent({
      type: 'run:end',
      runId: 'r',
      tileId: 'discord',
      status: 'error',
      error: 'Nope',
      failedNodeId: 'action',
      ms: 5,
      steps: 2,
    })
    expect(s().nodeRuns['discord']?.['action']).toEqual({ status: 'error', error: 'Nope' })
    expect(s().runs.at(-1)).toMatchObject({ status: 'error', failedNodeId: 'action', ms: 5 })
    expect(s().runningTiles['discord']).toBeUndefined()
  })
})
