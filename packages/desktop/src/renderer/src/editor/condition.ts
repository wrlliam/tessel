import type { Condition } from '@tessel/core'

type CompareOp = Extract<Condition, { kind: 'compare' }>['op']

export interface Row {
  left: string
  op: CompareOp
  right: string
  negate: boolean
}

export interface Builder {
  mode: 'and' | 'or'
  rows: Row[]
}

export const OPS: Array<{ value: CompareOp; label: string; unary?: boolean }> = [
  { value: '==', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: 'contains', label: 'contains' },
  { value: 'empty', label: 'is empty', unary: true },
  { value: 'notEmpty', label: 'is not empty', unary: true },
]

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const value = (s: string): unknown =>
  s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s

function toRow(c: Condition): Row | null {
  if (c.kind === 'compare')
    return { left: text(c.left), op: c.op, right: text(c.right), negate: false }
  if (c.kind === 'not' && c.item.kind === 'compare') {
    const row = toRow(c.item)
    return row && { ...row, negate: true }
  }
  return null
}

/** Flattens a condition into rows, or null if it is nested deeper than the builder shows. */
export function fromCondition(c: Condition): Builder | null {
  const single = toRow(c)
  if (single) return { mode: 'and', rows: [single] }
  if (c.kind === 'and' || c.kind === 'or') {
    const rows = c.items.map(toRow)
    if (rows.every((r): r is Row => r !== null)) return { mode: c.kind, rows }
  }
  return null
}

export function toCondition(b: Builder): Condition {
  const items = b.rows.map((r): Condition => {
    const unary = OPS.find((o) => o.value === r.op)?.unary
    const compare: Condition = unary
      ? { kind: 'compare', left: value(r.left), op: r.op }
      : { kind: 'compare', left: value(r.left), op: r.op, right: value(r.right) }
    return r.negate ? { kind: 'not', item: compare } : compare
  })
  return items.length === 1 && items[0] ? items[0] : { kind: b.mode, items }
}

export const newRow = (): Row => ({ left: '{{input.a}}', op: '==', right: '', negate: false })
