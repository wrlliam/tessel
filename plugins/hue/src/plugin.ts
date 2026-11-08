import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>
const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

type HueReply = Array<{ success?: unknown; error?: { type: number; description: string } }>

export function createHuePlugin(fetchFn: Fetch) {
  let bridge = ''
  let appKey = ''
  const apply = (s: Record<string, unknown>) => {
    bridge = String(s['bridge'] ?? '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    appKey = String(s['appKey'] ?? '')
  }
  const base = () => {
    if (!bridge)
      throw new PluginError('Set the bridge address in Plugins › Philips Hue › Settings.')
    return `http://${bridge}/api`
  }
  async function hue<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchFn(`${base()}${path}`, {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
      })
    } catch (err) {
      if (err instanceof PluginError) throw err
      throw new PluginError(`Can't reach the Hue bridge at ${bridge}.`)
    }
    const data = (await res.json()) as T
    const first = Array.isArray(data) ? (data as HueReply)[0] : undefined
    if (first?.error) {
      if (first.error.type === 1)
        throw new PluginError(
          'The bridge doesn’t know this app. Press its button, then run Hue: connect.',
        )
      if (first.error.type === 101)
        throw new PluginError('Press the button on the Hue bridge, then run this again.')
      throw new PluginError(`Hue: ${first.error.description}`)
    }
    return data
  }
  const keyed = (path: string) => {
    if (!appKey)
      throw new PluginError('Connect first: press the bridge button, then run Hue: connect.')
    return `/${appKey}${path}`
  }
  /** A light or room by number or by name (any case). */
  async function find(kind: 'lights' | 'groups', wanted: string): Promise<string> {
    if (/^\d+$/.test(wanted.trim())) return wanted.trim()
    const all = await hue<Record<string, { name: string }>>(keyed(`/${kind}`))
    const hit = Object.entries(all).find(
      ([, v]) => v.name.toLowerCase() === wanted.trim().toLowerCase(),
    )
    if (!hit)
      throw new PluginError(`No Hue ${kind === 'lights' ? 'light' : 'room'} called "${wanted}".`)
    return hit[0]
  }

  return definePlugin({
    async onLoad(ctx) {
      apply(ctx.settings)
      // A key from Hue: connect is kept in storage when the settings have none.
      if (!appKey) appKey = (await ctx.storage.get<string>('appKey')) ?? ''
    },
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'connect',
        name: 'Hue: connect',
        description:
          'Press the round button on the Hue bridge, then run this within 30 seconds. It gets an app key and keeps it.',
        inputs: [flowIn],
        outputs: [flowOut, { id: 'appKey', kind: 'value', type: 'string' }],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => {
          const reply = await hue<Array<{ success?: { username: string } }>>('', 'POST', {
            devicetype: 'tessel#desktop',
          })
          const key = reply[0]?.success?.username
          if (!key) throw new PluginError('The bridge gave no key. Press its button and try again.')
          appKey = key
          await ctx.storage.set('appKey', key)
          ctx.log.info(
            'Connected to the Hue bridge. Paste the app key into the plugin settings to keep it.',
          )
          return { values: { appKey: key } }
        },
      }),
      defineBlock({
        id: 'light',
        name: 'Hue: light',
        description: "Turns a light or a room on or off, or toggles it. Goes out 'on' or 'off'.",
        inputs: [flowIn],
        outputs: [
          { id: 'on', kind: 'flow' },
          { id: 'off', kind: 'flow' },
        ],
        paramsSchema: z.object({
          target: z.enum(['light', 'room']).default('light'),
          name: z.string().min(1, 'Type a light or room').max(100),
          action: z.enum(['toggle', 'on', 'off']).default('toggle'),
        }),
        fields: [
          {
            key: 'target',
            label: 'What',
            widget: 'select',
            options: [
              { value: 'light', label: 'A light' },
              { value: 'room', label: 'A room' },
            ],
          },
          { key: 'name', label: 'Name or number', widget: 'text', placeholder: 'Desk lamp' },
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
        defaults: { target: 'light', name: '1', action: 'toggle' },
        run: async (ctx, p) => {
          const kind = p.target === 'room' ? 'groups' : 'lights'
          const id = await find(kind, p.name)
          let on = p.action === 'on'
          if (p.action === 'toggle') {
            const now = await hue<{
              state?: { on: boolean }
              state_any?: unknown
              action?: { on: boolean }
            }>(keyed(`/${kind}/${id}`))
            on = !(kind === 'lights' ? now.state?.on : now.action?.on)
          }
          await hue(keyed(`/${kind}/${id}/${kind === 'lights' ? 'state' : 'action'}`), 'PUT', {
            on,
          })
          ctx.setTileState('on', on)
          return { next: on ? 'on' : 'off' }
        },
      }),
      defineBlock({
        id: 'brightness',
        name: 'Hue: brightness',
        description:
          'Sets a light or room to a brightness from 0 to 100. Wire a slider into level.',
        inputs: [flowIn, { id: 'level', kind: 'value', type: 'number' }],
        outputs: [flowOut],
        paramsSchema: z.object({
          target: z.enum(['light', 'room']).default('light'),
          name: z.string().min(1).max(100),
          level: z.coerce.number().min(0).max(100),
        }),
        fields: [
          {
            key: 'target',
            label: 'What',
            widget: 'select',
            options: [
              { value: 'light', label: 'A light' },
              { value: 'room', label: 'A room' },
            ],
          },
          { key: 'name', label: 'Name or number', widget: 'text' },
          { key: 'level', label: 'Brightness', widget: 'number' },
        ],
        defaults: { target: 'light', name: '1', level: 70 },
        run: async (_ctx, p) => {
          const kind = p.target === 'room' ? 'groups' : 'lights'
          const id = await find(kind, p.name)
          const bri = Math.round((p.level / 100) * 253) + 1
          await hue(keyed(`/${kind}/${id}/${kind === 'lights' ? 'state' : 'action'}`), 'PUT', {
            on: p.level > 0,
            ...(p.level > 0 && { bri }),
          })
        },
      }),
      defineBlock({
        id: 'scene',
        name: 'Hue: scene',
        description: 'Recalls a Hue scene in a room, by their names.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({
          room: z.string().min(1).max(100),
          scene: z.string().min(1).max(100),
        }),
        fields: [
          { key: 'room', label: 'Room', widget: 'text', placeholder: 'Living room' },
          { key: 'scene', label: 'Scene', widget: 'text', placeholder: 'Relax' },
        ],
        defaults: { room: 'Living room', scene: 'Relax' },
        run: async (_ctx, p) => {
          const group = await find('groups', p.room)
          const scenes = await hue<Record<string, { name: string; group?: string }>>(
            keyed('/scenes'),
          )
          const hit = Object.entries(scenes).find(
            ([, s]) =>
              s.name.toLowerCase() === p.scene.toLowerCase() && (!s.group || s.group === group),
          )
          if (!hit) throw new PluginError(`No scene "${p.scene}" in ${p.room}.`)
          await hue(keyed(`/groups/${group}/action`), 'PUT', { scene: hit[0] })
        },
      }),
    ],
  })
}
