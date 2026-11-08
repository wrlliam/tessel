import { defineBlock, definePlugin, defineTrigger, PluginError } from '@tessel/plugin-sdk'
import { homeAssistant, parseJson } from '@tessel/plugin-sdk/std'
import { z } from 'zod'

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }
const entity = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_]+$/, 'Write the entity like light.desk')
  .max(120)

type Client = ReturnType<typeof homeAssistant>
export type Connect = (opts: { url: string; token: string; signal?: AbortSignal }) => Client

/** "on", "off" or "other", for choosing a path after reading a state. */
const pathFor = (state: string) => (state === 'on' || state === 'off' ? state : 'other')

export function createHomeAssistantPlugin(connect: Connect = homeAssistant) {
  let settings = { url: '', token: '', pollSeconds: 5 }
  const apply = (s: Record<string, unknown>) => {
    settings = {
      url: String(s['url'] ?? ''),
      token: String(s['token'] ?? ''),
      pollSeconds: Math.max(2, Number(s['pollSeconds'] ?? 5)),
    }
  }
  const client = (signal?: AbortSignal) => {
    if (!settings.token)
      throw new PluginError(
        'Add your Home Assistant address and token in Plugins › Home Assistant › Settings.',
      )
    try {
      return connect({ url: settings.url, token: settings.token, ...(signal && { signal }) })
    } catch (err) {
      throw new PluginError((err as Error).message)
    }
  }
  const friendly = (err: unknown): never => {
    const m = err instanceof Error ? err.message : String(err)
    if (/401/.test(m)) throw new PluginError('Home Assistant refused the token. Make a new one.')
    if (/404/.test(m)) throw new PluginError("Home Assistant doesn't know that entity or service.")
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|timed out|timeout/i.test(m))
      throw new PluginError(`Can't reach Home Assistant at ${settings.url}.`)
    throw err instanceof PluginError ? err : new PluginError(m)
  }

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'toggle',
        name: 'Home Assistant: toggle',
        description:
          "Toggles a light, switch, fan or anything that turns on and off, then goes out 'on' or 'off'.",
        inputs: [flowIn],
        outputs: [
          { id: 'on', kind: 'flow' },
          { id: 'off', kind: 'flow' },
          { id: 'state', kind: 'value', type: 'string' },
        ],
        paramsSchema: z.object({
          entity,
          action: z.enum(['toggle', 'turn_on', 'turn_off']).default('toggle'),
        }),
        fields: [
          { key: 'entity', label: 'Entity', widget: 'text', placeholder: 'light.desk' },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'toggle', label: 'Toggle' },
              { value: 'turn_on', label: 'Turn on' },
              { value: 'turn_off', label: 'Turn off' },
            ],
          },
        ],
        defaults: { entity: 'light.desk', action: 'toggle' },
        run: async (ctx, p) => {
          const ha = client(ctx.signal)
          try {
            await ha.call(`${p.entity.split('.')[0]}.${p.action}`, { entity_id: p.entity })
            const { state } = await ha.state(p.entity)
            ctx.setTileState('on', state === 'on')
            return { next: state === 'on' ? 'on' : 'off', values: { state } }
          } catch (err) {
            return friendly(err)
          }
        },
      }),
      defineBlock({
        id: 'service',
        name: 'Home Assistant: call a service',
        description:
          'Calls any service, e.g. scene.turn_on, light.turn_on with brightness, or media_player.volume_set.',
        inputs: [flowIn, { id: 'value', kind: 'value', type: 'any' }],
        outputs: [flowOut],
        paramsSchema: z.object({
          service: z
            .string()
            .regex(/^[a-z_]+\.[a-z0-9_]+$/, 'Write the service like light.turn_on'),
          entity: z.string().max(120).default(''),
          data: z.string().max(2000).default(''),
        }),
        fields: [
          { key: 'service', label: 'Service', widget: 'text', placeholder: 'scene.turn_on' },
          { key: 'entity', label: 'Entity', widget: 'text', placeholder: 'scene.movie_night' },
          {
            key: 'data',
            label: 'Extra data (JSON)',
            widget: 'textarea',
            placeholder: '{"brightness_pct": {{input.value}}}',
            help: 'Optional. {{input.value}} is the wired-in value, e.g. from a slider.',
          },
        ],
        defaults: { service: 'scene.turn_on', entity: '', data: '' },
        run: async (ctx, p, input) => {
          const raw = p.data.replaceAll('{{input.value}}', JSON.stringify(input['value'] ?? null))
          const extra = raw.trim() ? parseJson<Record<string, unknown> | null>(raw, null) : {}
          if (!extra || typeof extra !== 'object')
            throw new PluginError('Extra data must be a JSON object')
          try {
            await client(ctx.signal).call(p.service, {
              ...(p.entity && { entity_id: p.entity }),
              ...extra,
            })
          } catch (err) {
            friendly(err)
          }
        },
      }),
      defineBlock({
        id: 'state',
        name: 'Home Assistant: read a state',
        description: "Reads an entity's state and one attribute. Goes out 'on', 'off' or 'other'.",
        inputs: [flowIn],
        outputs: [
          { id: 'on', kind: 'flow' },
          { id: 'off', kind: 'flow' },
          { id: 'other', kind: 'flow' },
          { id: 'state', kind: 'value', type: 'string' },
          { id: 'attribute', kind: 'value', type: 'any' },
          { id: 'name', kind: 'value', type: 'string' },
        ],
        paramsSchema: z.object({ entity, attribute: z.string().max(80).default('') }),
        fields: [
          {
            key: 'entity',
            label: 'Entity',
            widget: 'text',
            placeholder: 'sensor.living_room_temperature',
          },
          {
            key: 'attribute',
            label: 'Attribute',
            widget: 'text',
            placeholder: 'unit_of_measurement',
          },
        ],
        defaults: { entity: 'sensor.living_room_temperature', attribute: '' },
        run: async (ctx, p) => {
          try {
            const s = await client(ctx.signal).state(p.entity)
            return {
              next: pathFor(s.state),
              values: {
                state: s.state,
                attribute: p.attribute ? (s.attributes[p.attribute] ?? null) : null,
                name: String(s.attributes['friendly_name'] ?? p.entity),
              },
            }
          } catch (err) {
            return friendly(err)
          }
        },
      }),
    ],
    triggers: [
      defineTrigger({
        id: 'watch',
        name: 'Home Assistant: when a state changes',
        description:
          'Starts the tile when an entity changes, and keeps its state in tile state, e.g. {{state.on}} for a light.',
        outputs: [{ id: 'state', kind: 'value', type: 'string' }],
        paramsSchema: z.object({ entity }),
        fields: [{ key: 'entity', label: 'Entity', widget: 'text', placeholder: 'light.desk' }],
        defaults: { entity: 'light.desk' },
        subscribe: (ctx, sub) => {
          let last: string | undefined
          let stopped = false
          const check = async () => {
            if (stopped || !settings.token) return
            try {
              const { state } = await client().state(sub.params.entity)
              sub.setTileState('state', state)
              sub.setTileState('on', state === 'on')
              if (last !== undefined && state !== last) sub.emit({ state })
              last = state
            } catch (err) {
              ctx.log.warn(`Home Assistant: ${(err as Error).message}`)
            }
          }
          void check()
          const timer = setInterval(() => void check(), settings.pollSeconds * 1000)
          return () => {
            stopped = true
            clearInterval(timer)
          }
        },
      }),
    ],
  })
}
