import { z } from 'zod'
import { defineBlock, flowIn, flowOut } from '../block.ts'
import { compareValues, isNumeric, looseEqual, toText } from '../expression.ts'

export const CompareOp = z.enum(['==', '!=', '<', '<=', '>', '>=', 'contains', 'empty', 'notEmpty'])

export type Condition =
  | { kind: 'compare'; left?: unknown; op: z.infer<typeof CompareOp>; right?: unknown }
  | { kind: 'and' | 'or'; items: Condition[] }
  | { kind: 'not'; item: Condition }

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('compare'),
      left: z.unknown().optional(),
      op: CompareOp,
      right: z.unknown().optional(),
    }),
    z.object({ kind: z.enum(['and', 'or']), items: z.array(Condition).min(1) }),
    z.object({ kind: z.literal('not'), item: Condition }),
  ]),
) as z.ZodType<Condition>

export function checkCondition(c: Condition): boolean {
  switch (c.kind) {
    case 'and':
      return c.items.every(checkCondition)
    case 'or':
      return c.items.some(checkCondition)
    case 'not':
      return !checkCondition(c.item)
    case 'compare': {
      const { left, right } = c
      switch (c.op) {
        case '==':
          return looseEqual(left, right)
        case '!=':
          return !looseEqual(left, right)
        case '<':
        case '<=':
        case '>':
        case '>=': {
          // Comparing a number to text is almost always a mistake; treat it as false.
          if (isNumeric(left) !== isNumeric(right)) return false
          const d = compareValues(left, right)
          return c.op === '<' ? d < 0 : c.op === '<=' ? d <= 0 : c.op === '>' ? d > 0 : d >= 0
        }
        case 'contains':
          return toText(left).toLowerCase().includes(toText(right).toLowerCase())
        case 'empty':
          return toText(left).trim() === ''
        case 'notEmpty':
          return toText(left).trim() !== ''
      }
    }
  }
}

export const ifBlock = defineBlock({
  id: 'logic.if',
  category: 'logic',
  name: 'If',
  description:
    'Goes down "yes" when the condition holds, otherwise "no". Inputs a and b can be used as {{input.a}}.',
  inputs: [
    flowIn,
    { id: 'a', kind: 'value', type: 'any' },
    { id: 'b', kind: 'value', type: 'any' },
  ],
  outputs: [
    { id: 'yes', kind: 'flow', label: 'yes' },
    { id: 'no', kind: 'flow', label: 'no' },
  ],
  paramsSchema: z.object({ condition: Condition }),
  fields: [{ key: 'condition', label: 'Condition', widget: 'condition' }],
  defaults: { condition: { kind: 'compare', left: '{{input.a}}', op: '==', right: '' } },
  run: (_ctx, { condition }) => ({ next: checkCondition(condition) ? 'yes' : 'no' }),
})

export const MAX_DELAY_MS = 10 * 60_000

export const delay = defineBlock({
  id: 'logic.delay',
  category: 'logic',
  name: 'Delay',
  description: 'Waits before carrying on.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({ ms: z.coerce.number().int().min(0).max(MAX_DELAY_MS) }),
  fields: [{ key: 'ms', label: 'Milliseconds', widget: 'number', placeholder: '500' }],
  defaults: { ms: 500 },
  run: (ctx, { ms }) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(ctx.signal.reason)
        },
        { once: true },
      )
    }),
})

const CASES = ['case1', 'case2', 'case3', 'case4'] as const
const caseText = z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(200))

export const switchBlock = defineBlock({
  id: 'logic.switch',
  category: 'logic',
  name: 'Switch',
  description:
    'Goes down the first output whose value matches, otherwise "else". Leave a case empty to skip it.',
  inputs: [flowIn, { id: 'value', kind: 'value', type: 'any' }],
  outputs: [
    ...CASES.map((id, i) => ({ id, kind: 'flow' as const, label: `${i + 1}` })),
    { id: 'else', kind: 'flow', label: 'else' },
  ],
  paramsSchema: z.object({
    value: z.unknown(),
    case1: caseText,
    case2: caseText,
    case3: caseText,
    case4: caseText,
  }),
  fields: [
    { key: 'value', label: 'Value', widget: 'text', placeholder: '{{var.mode}}' },
    ...CASES.map((key, i) => ({ key, label: `Case ${i + 1}`, widget: 'text' as const })),
  ],
  defaults: { value: '', case1: '', case2: '', case3: '', case4: '' },
  run: (_ctx, params) => {
    const match = CASES.find((c) => params[c] !== '' && looseEqual(params.value, params[c]))
    return { next: match ?? 'else' }
  },
})

export const compare = defineBlock({
  id: 'logic.compare',
  category: 'logic',
  name: 'Compare',
  description: 'Compares two values and outputs true or false.',
  inputs: [
    { id: 'a', kind: 'value', type: 'any' },
    { id: 'b', kind: 'value', type: 'any' },
  ],
  outputs: [{ id: 'result', kind: 'value', type: 'boolean' }],
  paramsSchema: z.object({ a: z.unknown(), op: CompareOp, b: z.unknown() }),
  fields: [
    { key: 'a', label: 'A', widget: 'text', placeholder: '{{input.a}}' },
    {
      key: 'op',
      label: 'Is',
      widget: 'select',
      options: [
        { value: '==', label: 'equal to' },
        { value: '!=', label: 'not equal to' },
        { value: '>', label: 'greater than' },
        { value: '>=', label: 'at least' },
        { value: '<', label: 'less than' },
        { value: '<=', label: 'at most' },
        { value: 'contains', label: 'containing' },
        { value: 'empty', label: 'empty' },
        { value: 'notEmpty', label: 'not empty' },
      ],
    },
    {
      key: 'b',
      label: 'B',
      widget: 'text',
      when: { key: 'op', is: ['==', '!=', '>', '>=', '<', '<=', 'contains'] },
    },
  ],
  defaults: { a: '{{input.a}}', op: '==', b: '' },
  run: (_ctx, { a, op, b }) => ({
    values: { result: checkCondition({ kind: 'compare', left: a, op, right: b }) },
  }),
})

export const toggle = defineBlock({
  id: 'logic.toggle',
  category: 'logic',
  name: 'Toggle',
  description:
    'Flips between on and off each time it runs, and remembers where it was. Use {{state.on}} in live appearance.',
  inputs: [flowIn],
  outputs: [
    { id: 'on', kind: 'flow', label: 'now on' },
    { id: 'off', kind: 'flow', label: 'now off' },
    { id: 'state', kind: 'value', type: 'boolean' },
  ],
  paramsSchema: z.object({
    key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, 'Use letters, numbers and _'),
  }),
  fields: [
    {
      key: 'key',
      label: 'Name',
      widget: 'text',
      placeholder: 'on',
      help: 'Use a different name for each Toggle on the same tile.',
    },
  ],
  defaults: { key: 'on' },
  run: (ctx, { key }) => {
    const next = ctx.tileState.get(key) !== true
    ctx.tileState.set(key, next)
    return { next: next ? 'on' : 'off', values: { state: next } }
  },
})

export const repeat = defineBlock({
  id: 'logic.repeat',
  category: 'logic',
  name: 'Repeat',
  description: 'Runs what is wired to "each time" several times, then carries on from "then".',
  inputs: [flowIn],
  outputs: [
    { id: 'body', kind: 'flow', label: 'each time' },
    { id: 'done', kind: 'flow', label: 'then' },
    { id: 'index', kind: 'value', type: 'number', label: 'count (from 0)' },
  ],
  paramsSchema: z.object({ times: z.coerce.number().int().min(1).max(100) }),
  fields: [{ key: 'times', label: 'Times', widget: 'number', placeholder: '3' }],
  defaults: { times: 3 },
  run: (_ctx, { times }) => ({ loop: { port: 'body', times }, next: 'done' }),
})

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

export const waitUntil = defineBlock({
  id: 'logic.waitUntil',
  category: 'logic',
  name: 'Wait until',
  description: 'Checks a condition again and again until it holds, or gives up after a while.',
  inputs: [
    flowIn,
    { id: 'a', kind: 'value', type: 'any' },
    { id: 'b', kind: 'value', type: 'any' },
  ],
  outputs: [
    { id: 'out', kind: 'flow', label: 'met' },
    { id: 'timeout', kind: 'flow', label: 'gave up' },
  ],
  paramsSchema: z.object({
    condition: Condition,
    everyMs: z.coerce.number().int().min(50).max(60_000),
    timeoutMs: z.coerce.number().int().min(100).max(MAX_DELAY_MS),
  }),
  fields: [
    { key: 'condition', label: 'Condition', widget: 'condition' },
    { key: 'everyMs', label: 'Check every (ms)', widget: 'number', placeholder: '250' },
    {
      key: 'timeoutMs',
      label: 'Give up after (ms)',
      widget: 'number',
      placeholder: '10000',
      help: 'Tiles also stop after 30 s in total.',
    },
  ],
  defaults: {
    condition: { kind: 'compare', left: '{{input.a}}', op: '==', right: '' },
    everyMs: 250,
    timeoutMs: 10_000,
  },
  run: async (ctx, first) => {
    const started = ctx.now().getTime()
    let params = first
    for (;;) {
      if (checkCondition(params.condition)) return { next: 'out' }
      if (ctx.now().getTime() - started >= params.timeoutMs) return { next: 'timeout' }
      await sleepFor(params.everyMs, ctx.signal)
      params = (await ctx.refreshParams()) as typeof first
    }
  },
})

export const logicBlocks = [ifBlock, switchBlock, compare, toggle, delay, repeat, waitUntil]
