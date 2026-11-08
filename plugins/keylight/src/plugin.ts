import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>
const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

interface LightState {
  on: number
  brightness: number
  temperature: number
}

/** Kelvin (2900-7000) to the light's own scale (344-143). */
export const kelvinToMired = (k: number) =>
  Math.round(Math.min(344, Math.max(143, 1_000_000 / Math.min(7000, Math.max(2900, k)))))

export function createKeyLightPlugin(fetchFn: Fetch) {
  let lights: string[] = []
  const apply = (s: Record<string, unknown>) => {
    lights = String(s['lights'] ?? '')
      .split(/[,\s]+/)
      .map((a) => a.trim())
      .filter(Boolean)
  }
  const url = (addr: string) => `http://${addr.includes(':') ? addr : `${addr}:9123`}/elgato/lights`
  const targets = (which: string) => {
    if (!lights.length)
      throw new PluginError(
        'Add your Key Light addresses in Plugins › Elgato Key Light › Settings.',
      )
    if (!which.trim() || which === 'all') return lights
    const i = Number(which) - 1
    const pick = Number.isInteger(i) ? lights[i] : lights.find((l) => l === which.trim())
    if (!pick) throw new PluginError(`There's no light ${which}; you've set up ${lights.length}.`)
    return [pick]
  }
  async function get(addr: string): Promise<LightState> {
    try {
      const res = await fetchFn(url(addr))
      const body = (await res.json()) as { lights: LightState[] }
      const first = body.lights[0]
      if (!first) throw new Error('no light')
      return first
    } catch {
      throw new PluginError(`Can't reach the Key Light at ${addr}.`)
    }
  }
  async function put(addr: string, change: Partial<LightState>) {
    try {
      await fetchFn(url(addr), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numberOfLights: 1, lights: [change] }),
      })
    } catch {
      throw new PluginError(`Can't reach the Key Light at ${addr}.`)
    }
  }
  const which = {
    key: 'light',
    label: 'Light',
    widget: 'text' as const,
    placeholder: 'all, or 1, 2…',
  }

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'power',
        name: 'Key Light: on or off',
        description: "Turns Key Lights on, off or toggles them. Goes out 'on' or 'off'.",
        inputs: [flowIn],
        outputs: [
          { id: 'on', kind: 'flow' },
          { id: 'off', kind: 'flow' },
        ],
        paramsSchema: z.object({
          light: z.string().max(60).default('all'),
          action: z.enum(['toggle', 'on', 'off']).default('toggle'),
        }),
        fields: [
          which,
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'toggle', label: 'Toggle' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ],
          },
        ],
        defaults: { light: 'all', action: 'toggle' },
        run: async (ctx, p) => {
          const list = targets(p.light)
          const on = p.action === 'toggle' ? (await get(list[0] ?? '')).on === 0 : p.action === 'on'
          await Promise.all(list.map((a) => put(a, { on: on ? 1 : 0 })))
          ctx.setTileState('on', on)
          return { next: on ? 'on' : 'off' }
        },
      }),
      defineBlock({
        id: 'set',
        name: 'Key Light: brightness and warmth',
        description:
          'Sets brightness (0 to 100) and warmth (2900 K warm to 7000 K cool). Wire a slider into level.',
        inputs: [flowIn, { id: 'level', kind: 'value', type: 'number' }],
        outputs: [flowOut],
        paramsSchema: z.object({
          light: z.string().max(60).default('all'),
          level: z.coerce.number().min(0).max(100),
          kelvin: z.coerce.number().min(0).max(7000).default(0),
        }),
        fields: [
          which,
          { key: 'level', label: 'Brightness', widget: 'number' },
          {
            key: 'kelvin',
            label: 'Warmth (K)',
            widget: 'number',
            placeholder: '0 keeps it',
            help: '2900 to 7000; 0 leaves it as it is.',
          },
        ],
        defaults: { light: 'all', level: 50, kelvin: 0 },
        run: async (_ctx, p) => {
          const change: Partial<LightState> = {
            on: p.level > 0 ? 1 : 0,
            brightness: Math.round(Math.max(3, p.level)),
            ...(p.kelvin >= 2900 && { temperature: kelvinToMired(p.kelvin) }),
          }
          await Promise.all(targets(p.light).map((a) => put(a, change)))
        },
      }),
    ],
  })
}
