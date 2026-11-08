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

export const actionBlocks = [openApp, typeText, keyCombo, setSetting]
