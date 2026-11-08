import { z } from 'zod'
import { defineBlock, flowIn, flowOut } from '../block.ts'
import { parseCombo, resolveCombo } from '../combo.ts'
import { toBool } from '../expression.ts'

const text = (message: string) => z.string().trim().min(1, message)
const bool = z.preprocess(
  (v) => (typeof v === 'string' || typeof v === 'number' ? toBool(v) : v),
  z.boolean(),
)

export const openApp = defineBlock({
  id: 'action.openApp',
  category: 'action',
  name: 'Open app',
  description: 'Opens an app by name, e.g. Discord, or by path.',
  inputs: [flowIn, { id: 'app', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({ app: text('Choose an app to open') }),
  fields: [
    { key: 'app', label: 'App', widget: 'text', placeholder: 'Discord', help: 'Name or full path' },
  ],
  defaults: { app: '' },
  run: (ctx, { app }) => ctx.platform.openApp(app),
})

export const typeText = defineBlock({
  id: 'action.typeText',
  category: 'action',
  name: 'Type text',
  description: 'Types text into whatever has focus.',
  inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    text: z.preprocess(
      (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v),
      z.string().max(10_000),
    ),
  }),
  fields: [{ key: 'text', label: 'Text', widget: 'textarea', placeholder: 'Hello {{var.name}}' }],
  defaults: { text: '' },
  run: (ctx, { text }) => ctx.platform.typeText(text),
})

export const keyCombo = defineBlock({
  id: 'action.keyCombo',
  category: 'action',
  name: 'Key combo',
  description: 'Presses a shortcut. Use "mod" for Cmd on macOS and Ctrl elsewhere.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({
    combo: z.string().transform((s, ctx) => {
      try {
        return parseCombo(s)
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message })
        return z.NEVER
      }
    }),
  }),
  fields: [{ key: 'combo', label: 'Shortcut', widget: 'combo', placeholder: 'mod+shift+s' }],
  defaults: { combo: '' },
  run: (ctx, { combo }) => ctx.platform.pressCombo(resolveCombo(combo, ctx.platform.os)),
})

export const setSetting = defineBlock({
  id: 'action.setSetting',
  category: 'action',
  name: 'Set setting',
  description: 'Changes a system setting.',
  inputs: [flowIn, { id: 'value', kind: 'value', type: 'boolean' }],
  outputs: [flowOut],
  paramsSchema: z.object({ setting: z.enum(['darkMode']), value: bool }),
  fields: [
    {
      key: 'setting',
      label: 'Setting',
      widget: 'select',
      options: [{ value: 'darkMode', label: 'Dark mode' }],
    },
    { key: 'value', label: 'On', widget: 'toggle' },
  ],
  defaults: { setting: 'darkMode', value: true },
  run: (ctx, { value }) => ctx.platform.setDarkMode(value),
})

const optionalText = z.preprocess(
  (v) => (v === null || v === undefined ? '' : String(v)),
  z.string().max(64),
)

export const setTileAppearance = defineBlock({
  id: 'action.setTileAppearance',
  category: 'action',
  name: 'Set tile appearance',
  description:
    'Changes how this tile looks on the phone, e.g. to show a status. Leave a field empty to keep it.',
  inputs: [flowIn, { id: 'label', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    label: optionalText,
    colour: z.union([
      z.literal(''),
      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #22D3C5'),
    ]),
    icon: optionalText,
    reset: bool,
  }),
  fields: [
    { key: 'label', label: 'Label', widget: 'text', placeholder: '{{var.count}}' },
    { key: 'colour', label: 'Colour', widget: 'text', placeholder: '#F25C6E' },
    {
      key: 'icon',
      label: 'Icon',
      widget: 'text',
      placeholder: 'mic-off',
      help: 'An icon name from the tile icon picker, or one emoji.',
    },
    { key: 'reset', label: 'Reset to the tile’s own look', widget: 'toggle' },
  ],
  defaults: { label: '', colour: '', icon: '', reset: false },
  run: (ctx, { label, colour, icon, reset }) => {
    if (reset) return ctx.setAppearance('reset')
    ctx.setAppearance({
      ...(label !== '' && { label }),
      ...(colour !== '' && { colour }),
      ...(icon !== '' && { icon }),
    })
  },
})

export const actionBlocks = [openApp, typeText, keyCombo, setSetting, setTileAppearance]
