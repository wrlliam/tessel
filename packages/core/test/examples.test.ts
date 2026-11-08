// The two example graphs from the brief, section 5.
import { describe, expect, it } from 'vitest'
import type { Graph } from '../src/index.ts'
import { node, press, setup, tile, wire } from './helpers.ts'

describe('example (a): On press -> Open App "Discord"', () => {
  const graph: Graph = {
    nodes: [node('press', 'trigger.press'), node('open', 'action.openApp', { app: 'Discord' })],
    edges: [wire('press.out', 'open.in')],
  }

  it('opens Discord', async () => {
    const { engine, platform } = setup()
    const result = await engine.trigger(tile(graph), press)
    expect(result).toMatchObject({ status: 'ok', nodes: { press: 'ok', open: 'ok' } })
    expect(platform.openApp).toHaveBeenCalledExactlyOnceWith('Discord')
  })

  it('streams node status so the editor can light nodes up', async () => {
    const { engine, events } = setup()
    await engine.trigger(tile(graph), press)
    const statuses = events.flatMap((e) => (e.type === 'node' ? [`${e.nodeId}:${e.status}`] : []))
    expect(statuses).toEqual(['press:running', 'press:ok', 'open:running', 'open:ok'])
    expect(events[0]?.type).toBe('run:start')
    expect(events.at(-1)).toMatchObject({ type: 'run:end', status: 'ok', steps: 2 })
  })
})

describe('example (b): On press -> If (Get Time hour >= 18) -> dark mode on / off', () => {
  const graph: Graph = {
    nodes: [
      node('press', 'trigger.press'),
      node('time', 'data.getTime'),
      node('if', 'logic.if', {
        condition: { kind: 'compare', left: '{{input.a}}', op: '>=', right: 18 },
      }),
      node('dark', 'action.setSetting', { setting: 'darkMode', value: true }),
      node('light', 'action.setSetting', { setting: 'darkMode', value: false }),
    ],
    edges: [
      wire('press.out', 'if.in'),
      wire('time.hour', 'if.a'),
      wire('if.yes', 'dark.in'),
      wire('if.no', 'light.in'),
    ],
  }

  const at = (hour: number) => () => new Date(2026, 10, 8, hour, 30)

  it.each([18, 23])('turns dark mode on at %i:30', async (hour) => {
    const { engine, platform } = setup({ now: at(hour) })
    const result = await engine.trigger(tile(graph), press)
    expect(platform.setDarkMode).toHaveBeenCalledExactlyOnceWith(true)
    expect(result?.nodes).toMatchObject({ if: 'ok', dark: 'ok', light: 'skipped', time: 'ok' })
  })

  it.each([0, 9, 17])('turns dark mode off at %i:30', async (hour) => {
    const { engine, platform } = setup({ now: at(hour) })
    const result = await engine.trigger(tile(graph), press)
    expect(platform.setDarkMode).toHaveBeenCalledExactlyOnceWith(false)
    expect(result?.nodes).toMatchObject({ dark: 'skipped', light: 'ok' })
  })
})

describe('sample profile', () => {
  it('has only valid graphs', async () => {
    const { createRegistry, sampleProfile, validateGraph } = await import('../src/index.ts')
    const registry = createRegistry()
    for (const tile of sampleProfile.pages.flatMap((p) => p.tiles)) {
      const errors = validateGraph(tile.graph, registry).filter((i) => i.severity === 'error')
      expect(errors, tile.id).toEqual([])
    }
  })
})

describe('sample profile layout', () => {
  it('never stacks two blocks on the same spot', async () => {
    const { sampleProfile } = await import('../src/index.ts')
    for (const tile of sampleProfile.pages.flatMap((p) => p.tiles)) {
      const spots = tile.graph.nodes.map((n) => `${n.position.x},${n.position.y}`)
      expect(new Set(spots).size, tile.id).toBe(spots.length)
    }
  })
})
