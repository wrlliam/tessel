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

const MAX_DELAY_MS = 10 * 60_000

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

export const logicBlocks = [ifBlock, delay]
