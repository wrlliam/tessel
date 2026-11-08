import { describe, expect, it } from 'vitest'
import { createRegistry, validateGraph, type Graph } from '../src/index.ts'
import { node, wire } from './helpers.ts'

const registry = createRegistry()
const errors = (graph: Graph) =>
  validateGraph(graph, registry)
    .filter((i) => i.severity === 'error')
    .map((i) => i.message)

describe('validateGraph', () => {
  it('accepts a simple graph', () => {
    const graph: Graph = {
      nodes: [node('p', 'trigger.press'), node('o', 'action.openApp', { app: 'Mail' })],
      edges: [wire('p.out', 'o.in')],
    }
    expect(validateGraph(graph, registry)).toEqual([])
  })

  it('rejects loops', () => {
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('a', 'logic.delay', { ms: 1 }),
        node('b', 'logic.delay', { ms: 1 }),
      ],
      edges: [wire('p.out', 'a.in'), wire('a.out', 'b.in'), wire('b.out', 'a.in')],
    }
    expect(errors(graph)).toEqual([expect.stringMatching(/loop/)])
  })

  it('rejects mixing flow and value wires', () => {
    const graph: Graph = {
      nodes: [node('p', 'trigger.press'), node('t', 'data.getTime')],
      edges: [wire('t.hour', 'p.out')],
    }
    expect(errors(graph)).toHaveLength(1)
    const mixed: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('i', 'logic.if', { condition: { kind: 'compare', op: 'empty' } }),
      ],
      edges: [wire('p.out', 'i.a')],
    }
    expect(errors(mixed)).toEqual(['Flow wires and value wires cannot be mixed'])
  })

  it('rejects incompatible value types', () => {
    const graph: Graph = {
      nodes: [
        node('t', 'data.getTime'),
        node('s', 'action.setSetting', { setting: 'darkMode', value: true }),
      ],
      edges: [wire('t.weekday', 's.value')],
    }
    expect(errors(graph)).toEqual(["Can't connect string to boolean"])
  })

  it('rejects two wires into one value input', () => {
    const graph: Graph = {
      nodes: [
        node('t', 'data.getTime'),
        node('i', 'logic.if', { condition: { kind: 'compare', op: 'empty' } }),
      ],
      edges: [wire('t.hour', 'i.a'), wire('t.minute', 'i.a')],
    }
    expect(errors(graph)).toContain('A value input can only take one wire')
  })

  it('reports unknown blocks and bad params in plain words', () => {
    const graph: Graph = {
      nodes: [node('x', 'plugin.gone'), node('o', 'action.openApp', { app: '' })],
      edges: [],
    }
    expect(errors(graph)).toEqual([
      'Unknown block "plugin.gone". Is its plugin installed?',
      'Open app: app: Choose an app to open',
    ])
  })

  it('skips param checks for templated values', () => {
    const graph: Graph = { nodes: [node('d', 'logic.delay', { ms: '{{var.wait}}' })], edges: [] }
    expect(errors(graph)).toEqual([])
  })

  it('warns when there is no trigger', () => {
    const graph: Graph = { nodes: [node('o', 'action.openApp', { app: 'Mail' })], edges: [] }
    expect(validateGraph(graph, registry)).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ])
  })
})
