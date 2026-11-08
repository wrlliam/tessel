import { createRegistry, defineBlock, flowOut, templates, Tile, validateGraph } from '@tessel/core'
import { describe, expect, it } from 'vitest'
import { MockVoicemeeter } from '../../../plugins/voicemeeter/src/mock.ts'
import { createVoicemeeterPlugin } from '../../../plugins/voicemeeter/src/plugin.ts'

// Templates that use first-party plugin blocks, checked against the plugins' own definitions.
describe('plugin templates', () => {
  const registry = createRegistry()
  const plugins = { voicemeeter: createVoicemeeterPlugin(async () => new MockVoicemeeter()) }
  for (const [id, plugin] of Object.entries(plugins)) {
    for (const b of plugin.blocks ?? [])
      registry.register(
        defineBlock({
          id: `${id}.${b.id}`,
          category: 'plugin',
          name: b.name,
          description: b.description,
          inputs: b.inputs as never,
          outputs: b.outputs as never,
          paramsSchema: b.paramsSchema as never,
          run: () => {},
        }),
      )
    for (const t of plugin.triggers ?? [])
      registry.register(
        defineBlock({
          id: `${id}.${t.id}`,
          category: 'plugin',
          name: t.name,
          description: t.description,
          trigger: 'plugin',
          inputs: [],
          outputs: [flowOut, ...(t.outputs as never[])],
          paramsSchema: t.paramsSchema as never,
          run: () => {},
        }),
      )
  }

  it.each(templates.filter((t) => t.plugin).map((t) => [t.id, t] as const))(
    '%s is a valid tile with a valid graph',
    (_, t) => {
      expect(Object.keys(plugins)).toContain(t.plugin)
      expect(Tile.safeParse({ ...t.tile, id: 'x', position: { col: 0, row: 0 } }).success).toBe(
        true,
      )
      expect(validateGraph(t.tile.graph, registry).filter((i) => i.severity === 'error')).toEqual(
        [],
      )
    },
  )
})
