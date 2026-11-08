import { z } from 'zod'
import { defineBlock, flowIn, flowOut } from '../block.ts'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (n: number) => String(n).padStart(2, '0')

export const getTime = defineBlock({
  id: 'data.getTime',
  category: 'data',
  name: 'Get time',
  description: "The computer's local time.",
  inputs: [],
  outputs: [
    { id: 'hour', kind: 'value', type: 'number' },
    { id: 'minute', kind: 'value', type: 'number' },
    { id: 'weekday', kind: 'value', type: 'string' },
    { id: 'weekdayNumber', kind: 'value', type: 'number', label: 'weekday (0 = Sunday)' },
    { id: 'date', kind: 'value', type: 'string', label: 'date (YYYY-MM-DD)' },
    { id: 'time', kind: 'value', type: 'string', label: 'time (HH:MM)' },
  ],
  paramsSchema: z.object({}),
  run: (ctx) => {
    const d = ctx.now()
    return {
      values: {
        hour: d.getHours(),
        minute: d.getMinutes(),
        weekday: WEEKDAYS[d.getDay()],
        weekdayNumber: d.getDay(),
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      },
    }
  },
})

const VariableName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Use letters, numbers and _ (start with a letter)')
const Scope = z.enum(['global', 'local']).default('global')

export const getVariable = defineBlock({
  id: 'data.getVariable',
  category: 'data',
  name: 'Get variable',
  description: 'Reads a variable. Global ones are saved with the profile.',
  inputs: [],
  outputs: [{ id: 'value', kind: 'value', type: 'any' }],
  paramsSchema: z.object({ name: VariableName, scope: Scope }),
  fields: [
    { key: 'name', label: 'Name', widget: 'text', placeholder: 'mood' },
    {
      key: 'scope',
      label: 'Scope',
      widget: 'select',
      options: [
        { value: 'global', label: 'Global (saved with profile)' },
        { value: 'local', label: 'Local (this run only)' },
      ],
    },
  ],
  defaults: { name: '', scope: 'global' },
  run: (ctx, { name, scope }) => ({
    values: { value: scope === 'local' ? ctx.locals.get(name) : ctx.globals.get(name) },
  }),
})

export const setVariable = defineBlock({
  id: 'data.setVariable',
  category: 'data',
  name: 'Set variable',
  description:
    'Stores a value. Global ones are saved with the profile; local ones last for this run.',
  inputs: [flowIn, { id: 'value', kind: 'value', type: 'any' }],
  outputs: [flowOut],
  paramsSchema: z.object({ name: VariableName, scope: Scope, value: z.unknown() }),
  fields: [
    { key: 'name', label: 'Name', widget: 'text', placeholder: 'mood' },
    { key: 'value', label: 'Value', widget: 'text', placeholder: '{{var.count + 1}}' },
    {
      key: 'scope',
      label: 'Scope',
      widget: 'select',
      options: [
        { value: 'global', label: 'Global (saved with profile)' },
        { value: 'local', label: 'Local (this run only)' },
      ],
    },
  ],
  defaults: { name: '', scope: 'global', value: '' },
  run: (ctx, { name, scope, value }) => {
    if (scope === 'local') ctx.locals.set(name, value)
    else ctx.globals.set(name, value)
  },
})

export const dataBlocks = [getTime, getVariable, setVariable]
