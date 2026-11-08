import {
  defineBlock,
  definePlugin,
  defineTrigger,
  PluginError,
  type PluginContext,
} from '@tessel/plugin-sdk'
import { z } from 'zod'
import {
  checkIndex,
  LAYOUT,
  PARAM_NAME,
  paramName,
  scriptValue,
  toDb,
  VoicemeeterError,
  type VoicemeeterApi,
} from './api.ts'

const POLL_MS = 50
const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

const target = z.enum(['strip', 'bus'])
/** People count from 1; Voicemeeter counts from 0. */
const index = z.coerce
  .number()
  .int()
  .min(1)
  .max(8)
  .transform((n) => n - 1)
const onOffToggle = z.enum(['on', 'off', 'toggle'])
const param = z.string().trim().regex(PARAM_NAME, 'Use a name like Strip[0].Gain')

const targetFields = [
  {
    key: 'target',
    label: 'Channel',
    widget: 'select' as const,
    options: [
      { value: 'strip', label: 'Input (strip)' },
      { value: 'bus', label: 'Output (bus)' },
    ],
  },
  { key: 'index', label: 'Number', widget: 'number' as const, placeholder: '1' },
]

/** Builds the plugin around a way to connect, so tests can use the mock. */
export function createVoicemeeterPlugin(connect: () => Promise<VoicemeeterApi>) {
  let api: VoicemeeterApi | undefined
  let connecting: Promise<VoicemeeterApi> | undefined
  let ctx: PluginContext | undefined

  async function vm(): Promise<VoicemeeterApi> {
    if (ctx && ctx.os !== 'win32') throw new PluginError('Voicemeeter is Windows-only.')
    if (api) return api
    connecting ??= connect().then(
      (a) => (api = a),
      (err: unknown) => {
        connecting = undefined
        throw err instanceof VoicemeeterError ? new PluginError(err.message) : err
      },
    )
    return connecting
  }

  /** Wraps Voicemeeter errors as messages for the person pressing the tile. */
  const friendly = async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (err) {
      throw err instanceof VoicemeeterError ? new PluginError(err.message) : err
    }
  }

  async function flip(name: string, action: 'on' | 'off' | 'toggle'): Promise<boolean> {
    const v = await vm()
    return friendly(() => {
      const next = action === 'toggle' ? v.getFloat(name) < 0.5 : action === 'on'
      v.setFloat(name, next ? 1 : 0)
      return next
    })
  }

  // One poller serves every "On parameter change" trigger; it only runs while there are some.
  const watchers = new Map<
    symbol,
    { param: string; last?: number | string; onChange: (value: number | string) => void }
  >()
  let timer: ReturnType<typeof setInterval> | undefined

  function read(v: VoicemeeterApi, name: string): number | string {
    try {
      return v.getFloat(name)
    } catch {
      return v.getString(name)
    }
  }

  async function poll() {
    const v = api
    if (!v || !v.isDirty()) return
    for (const w of watchers.values()) {
      try {
        const value = read(v, w.param)
        if (value !== w.last) {
          w.last = value
          w.onChange(value)
        }
      } catch {
        // Parameter not available on this Voicemeeter type; ignore until it is.
      }
    }
  }

  function watch(name: string, onChange: (value: number | string) => void): () => void {
    const key = Symbol(name)
    const w: { param: string; last?: number | string; onChange: (value: number | string) => void } =
      { param: name, onChange }
    watchers.set(key, w)
    // Send the current value straight away so tiles start out right.
    void vm()
      .then((v) => {
        w.last = read(v, name)
        onChange(w.last)
      })
      .catch((err: Error) => ctx?.log.warn(err.message))
    timer ??= setInterval(() => void poll(), POLL_MS)
    return () => {
      watchers.delete(key)
      if (watchers.size === 0 && timer) {
        clearInterval(timer)
        timer = undefined
      }
    }
  }

  return definePlugin({
    onLoad(c) {
      ctx = c
      if (c.os === 'win32') vm().catch((err: Error) => c.log.warn(err.message))
    },
    onUnload() {
      if (timer) clearInterval(timer)
      api?.logout()
    },
    blocks: [
      defineBlock({
        id: 'setGain',
        name: 'Set gain',
        description: 'Sets the fader of an input or output, in dB (-60 to +12).',
        inputs: [flowIn, { id: 'gain', kind: 'value', type: 'number' }],
        outputs: [flowOut],
        paramsSchema: z.object({ target, index, gain: z.coerce.number().min(-60).max(12) }),
        fields: [
          ...targetFields,
          { key: 'gain', label: 'Gain (dB)', widget: 'number', placeholder: '0' },
        ],
        defaults: { target: 'strip', index: 1, gain: 0 },
        run: async (_c, p) => {
          const v = await vm()
          await friendly(() => {
            checkIndex(v, p.target, p.index)
            v.setFloat(paramName(p.target, p.index, 'Gain'), p.gain)
          })
        },
      }),
      defineBlock({
        id: 'mute',
        name: 'Mute',
        description:
          'Mutes, unmutes or toggles an input or output. Sets tile state "muted" for live appearance.',
        inputs: [flowIn],
        outputs: [flowOut, { id: 'muted', kind: 'value', type: 'boolean' }],
        paramsSchema: z.object({ target, index, action: onOffToggle }),
        fields: [
          ...targetFields,
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'on', label: 'Mute' },
              { value: 'off', label: 'Unmute' },
              { value: 'toggle', label: 'Toggle' },
            ],
          },
        ],
        defaults: { target: 'strip', index: 1, action: 'toggle' },
        run: async (c, p) => {
          checkIndex(await vm(), p.target, p.index)
          const muted = await flip(paramName(p.target, p.index, 'Mute'), p.action)
          c.setTileState('muted', muted)
          return { values: { muted } }
        },
      }),
      defineBlock({
        id: 'solo',
        name: 'Solo',
        description: 'Solos an input.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({ index, action: onOffToggle }),
        fields: [
          { key: 'index', label: 'Input number', widget: 'number', placeholder: '1' },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'on', label: 'Solo on' },
              { value: 'off', label: 'Solo off' },
              { value: 'toggle', label: 'Toggle' },
            ],
          },
        ],
        defaults: { index: 1, action: 'toggle' },
        run: async (c, p) => {
          checkIndex(await vm(), 'strip', p.index)
          c.setTileState('solo', await flip(paramName('strip', p.index, 'Solo'), p.action))
        },
      }),
      defineBlock({
        id: 'routing',
        name: 'Routing',
        description:
          'Sends an input to an output (A1–A5 hardware, B1–B3 virtual), or stops sending it.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({
          index,
          output: z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3']),
          action: onOffToggle,
        }),
        fields: [
          { key: 'index', label: 'Input number', widget: 'number', placeholder: '1' },
          {
            key: 'output',
            label: 'Output',
            widget: 'select',
            options: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3'].map((o) => ({
              value: o,
              label: o,
            })),
          },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'on', label: 'Send' },
              { value: 'off', label: 'Stop sending' },
              { value: 'toggle', label: 'Toggle' },
            ],
          },
        ],
        defaults: { index: 1, output: 'A1', action: 'toggle' },
        run: async (c, p) => {
          const v = await vm()
          checkIndex(v, 'strip', p.index)
          if (!LAYOUT[v.type()].outputs.includes(p.output)) {
            throw new PluginError(`Voicemeeter ${v.type()} has no ${p.output} output`)
          }
          c.setTileState(p.output, await flip(paramName('strip', p.index, p.output), p.action))
        },
      }),
      defineBlock({
        id: 'macroButton',
        name: 'Macro button',
        description: "Presses one of Voicemeeter's macro buttons.",
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({
          button: z.coerce.number().int().min(1).max(80),
          action: z.enum(['press', 'on', 'off']),
        }),
        fields: [
          { key: 'button', label: 'Button number', widget: 'number', placeholder: '1' },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'press', label: 'Press and release' },
              { value: 'on', label: 'Turn on' },
              { value: 'off', label: 'Turn off' },
            ],
          },
        ],
        defaults: { button: 1, action: 'press' },
        run: async (_c, p) => {
          const v = await vm()
          await friendly(() => {
            if (p.action !== 'off') v.setMacroButton(p.button - 1, 1)
            if (p.action !== 'on') v.setMacroButton(p.button - 1, 0)
          })
        },
      }),
      defineBlock({
        id: 'loadPreset',
        name: 'Load preset',
        description: 'Loads a saved Voicemeeter settings file (.xml).',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({
          path: z
            .string()
            .trim()
            .regex(/\.xml$/i, 'Choose a .xml settings file'),
        }),
        fields: [
          {
            key: 'path',
            label: 'Settings file',
            widget: 'text',
            placeholder: 'C:\\Users\\me\\Documents\\stream.xml',
          },
        ],
        defaults: { path: '' },
        run: async (_c, p) => {
          const v = await vm()
          await friendly(() => v.setString('Command.Load', p.path))
        },
      }),
      defineBlock({
        id: 'getLevel',
        name: 'Get level',
        description:
          'Reads a meter level. Type: 0 input before fader, 1 after fader, 2 after mute, 3 output.',
        inputs: [],
        outputs: [
          { id: 'db', kind: 'value', type: 'number', label: 'level (dB)' },
          { id: 'value', kind: 'value', type: 'number', label: 'level (0 to 1)' },
        ],
        paramsSchema: z.object({
          kind: z.coerce.number().int().min(0).max(3),
          channel: z.coerce.number().int().min(0).max(63),
        }),
        fields: [
          {
            key: 'kind',
            label: 'Meter',
            widget: 'select',
            options: [
              { value: '0', label: 'Input, before fader' },
              { value: '1', label: 'Input, after fader' },
              { value: '2', label: 'Input, after mute' },
              { value: '3', label: 'Output' },
            ],
          },
          { key: 'channel', label: 'Channel (from 0)', widget: 'number' },
        ],
        defaults: { kind: '1', channel: 0 },
        run: async (_c, p) => {
          const v = await vm()
          const value = await friendly(() => v.getLevel(p.kind, p.channel))
          return { values: { value, db: toDb(value) } }
        },
      }),
      defineBlock({
        id: 'getParameter',
        name: 'Get parameter',
        description: 'Reads any Voicemeeter parameter by name, e.g. Strip[0].Gain.',
        inputs: [],
        outputs: [{ id: 'value', kind: 'value', type: 'any' }],
        paramsSchema: z.object({ param }),
        fields: [
          { key: 'param', label: 'Parameter', widget: 'text', placeholder: 'Strip[0].Gain' },
        ],
        defaults: { param: 'Strip[0].Gain' },
        run: async (_c, p) => {
          const v = await vm()
          return { values: { value: await friendly(() => read(v, p.param)) } }
        },
      }),
      defineBlock({
        id: 'setParameter',
        name: 'Set parameter',
        description: 'Sets any Voicemeeter parameter by name, e.g. Strip[0].Label to Mic.',
        inputs: [flowIn, { id: 'value', kind: 'value', type: 'any' }],
        outputs: [flowOut],
        paramsSchema: z.object({ param, value: z.union([z.number(), z.string()]) }),
        fields: [
          { key: 'param', label: 'Parameter', widget: 'text', placeholder: 'Strip[0].Gain' },
          { key: 'value', label: 'Value', widget: 'text', placeholder: '-6' },
        ],
        defaults: { param: 'Strip[0].Gain', value: '0' },
        run: async (_c, p) => {
          const v = await vm()
          await friendly(() => v.setParameters(`${p.param}=${scriptValue(p.value)};`))
        },
      }),
    ],
    triggers: [
      defineTrigger({
        id: 'parameterChange',
        name: 'On parameter change',
        description:
          'Starts when a Voicemeeter parameter changes, and once when the profile loads. Can also keep it as tile state.',
        outputs: [{ id: 'value', kind: 'value', type: 'any' }],
        paramsSchema: z.object({
          param,
          stateKey: z
            .string()
            .regex(/^([A-Za-z_][A-Za-z0-9_]{0,31})?$/, 'Use letters, numbers and _')
            .default(''),
        }),
        fields: [
          { key: 'param', label: 'Parameter', widget: 'text', placeholder: 'Strip[0].Mute' },
          {
            key: 'stateKey',
            label: 'Keep as tile state named',
            widget: 'text',
            placeholder: 'muted',
            help: 'Then use {{state.muted}} in live appearance.',
          },
        ],
        defaults: { param: 'Strip[0].Mute', stateKey: '' },
        subscribe: (_c, sub) =>
          watch(sub.params.param, (value) => {
            if (sub.params.stateKey)
              sub.setTileState(
                sub.params.stateKey,
                typeof value === 'number' && (value === 0 || value === 1) ? value === 1 : value,
              )
            sub.emit({ value })
          }),
      }),
    ],
  })
}
