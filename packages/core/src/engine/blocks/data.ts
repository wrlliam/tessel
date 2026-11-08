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

const number = z.coerce.number().refine(Number.isFinite, 'Not a number')

const MATH = {
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b,
  multiply: (a: number, b: number) => a * b,
  divide: (a: number, b: number) => (b === 0 ? NaN : a / b),
  remainder: (a: number, b: number) => (b === 0 ? NaN : a % b),
  min: Math.min,
  max: Math.max,
  power: (a: number, b: number) => a ** b,
  round: (a: number) => Math.round(a),
  floor: (a: number) => Math.floor(a),
  ceil: (a: number) => Math.ceil(a),
  abs: (a: number) => Math.abs(a),
} as const
type MathOp = keyof typeof MATH
const UNARY: MathOp[] = ['round', 'floor', 'ceil', 'abs']

export const math = defineBlock({
  id: 'data.math',
  category: 'data',
  name: 'Math',
  description: 'Works out a number from A and B.',
  inputs: [
    { id: 'a', kind: 'value', type: 'number' },
    { id: 'b', kind: 'value', type: 'number' },
  ],
  outputs: [{ id: 'result', kind: 'value', type: 'number' }],
  paramsSchema: z.object({
    op: z.enum(Object.keys(MATH) as [MathOp, ...MathOp[]]),
    a: number,
    b: number.default(0),
  }),
  fields: [
    { key: 'a', label: 'A', widget: 'number' },
    {
      key: 'op',
      label: 'Operation',
      widget: 'select',
      options: [
        { value: 'add', label: 'A + B' },
        { value: 'subtract', label: 'A − B' },
        { value: 'multiply', label: 'A × B' },
        { value: 'divide', label: 'A ÷ B' },
        { value: 'remainder', label: 'Remainder of A ÷ B' },
        { value: 'min', label: 'Smaller of A and B' },
        { value: 'max', label: 'Larger of A and B' },
        { value: 'power', label: 'A to the power of B' },
        { value: 'round', label: 'Round A' },
        { value: 'floor', label: 'Round A down' },
        { value: 'ceil', label: 'Round A up' },
        { value: 'abs', label: 'A without its sign' },
      ],
    },
    {
      key: 'b',
      label: 'B',
      widget: 'number',
      when: { key: 'op', is: Object.keys(MATH).filter((k) => !UNARY.includes(k as MathOp)) },
    },
  ],
  defaults: { op: 'add', a: 0, b: 0 },
  run: (_ctx, { op, a, b }) => {
    const result = MATH[op](a, b)
    if (!Number.isFinite(result))
      throw new Error("That doesn't work out to a number (dividing by zero?)")
    return { values: { result } }
  },
})

export const textBlock = defineBlock({
  id: 'data.text',
  category: 'data',
  name: 'Text',
  description: 'Builds text from a template, e.g. joining values: {{input.a}} – {{input.b}}.',
  inputs: [
    { id: 'a', kind: 'value', type: 'any' },
    { id: 'b', kind: 'value', type: 'any' },
    { id: 'c', kind: 'value', type: 'any' },
  ],
  outputs: [{ id: 'text', kind: 'value', type: 'string' }],
  paramsSchema: z.object({
    template: z.preprocess(
      (v) => (v == null ? '' : typeof v === 'string' ? v : String(v)),
      z.string().max(10_000),
    ),
  }),
  fields: [
    {
      key: 'template',
      label: 'Template',
      widget: 'textarea',
      placeholder: 'It is {{input.a}}:{{pad(input.b)}}',
    },
  ],
  defaults: { template: '' },
  run: (_ctx, { template }) => ({ values: { text: template } }),
})

export const random = defineBlock({
  id: 'data.random',
  category: 'data',
  name: 'Random',
  description: 'A whole number between min and max, both included. A new one each time it is read.',
  inputs: [],
  outputs: [{ id: 'value', kind: 'value', type: 'number' }],
  paramsSchema: z
    .object({ min: z.coerce.number().int(), max: z.coerce.number().int() })
    .refine((p) => p.max >= p.min, { message: 'Max must be at least min', path: ['max'] }),
  fields: [
    { key: 'min', label: 'Min', widget: 'number' },
    { key: 'max', label: 'Max', widget: 'number' },
  ],
  defaults: { min: 1, max: 6 },
  run: (_ctx, { min, max }) => ({
    values: { value: min + Math.floor(Math.random() * (max - min + 1)) },
  }),
})

export const dataBlocks = [getTime, getVariable, setVariable, math, textBlock, random]
