import type { Condition } from '@tessel/core'
import { Plus, X } from 'lucide-react'
import { Button } from '../../ui/button.tsx'
import { Input, Select } from '../../ui/input.tsx'
import { fromCondition, newRow, OPS, toCondition, type Builder, type Row } from '../condition.ts'

export function ConditionField({
  value,
  onChange,
}: {
  value: Condition
  onChange: (c: Condition) => void
}) {
  const builder = fromCondition(value)
  if (!builder) {
    return (
      <p className="text-sm text-muted">This condition is nested deeper than the builder shows.</p>
    )
  }
  const update = (next: Builder) => onChange(toCondition(next))
  const setRow = (i: number, patch: Partial<Row>) =>
    update({ ...builder, rows: builder.rows.map((r, j) => (i === j ? { ...r, ...patch } : r)) })

  return (
    <div className="space-y-2">
      {builder.rows.length > 1 && (
        <Select
          aria-label="Match"
          value={builder.mode}
          onChange={(e) => update({ ...builder, mode: e.target.value as Builder['mode'] })}
        >
          <option value="and">All of these are true</option>
          <option value="or">Any of these is true</option>
        </Select>
      )}
      {builder.rows.map((row, i) => {
        const unary = OPS.find((o) => o.value === row.op)?.unary
        return (
          <fieldset key={i} className="space-y-1.5 rounded-lg border border-line p-2">
            <legend className="sr-only">Condition {i + 1}</legend>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={row.negate}
                  onChange={(e) => setRow(i, { negate: e.target.checked })}
                />
                not
              </label>
              {builder.rows.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-6"
                  aria-label={`Remove condition ${i + 1}`}
                  onClick={() =>
                    update({ ...builder, rows: builder.rows.filter((_, j) => j !== i) })
                  }
                >
                  <X />
                </Button>
              )}
            </div>
            <Input
              aria-label="Value"
              className="font-mono"
              value={row.left}
              placeholder="{{input.a}}"
              onChange={(e) => setRow(i, { left: e.target.value })}
            />
            <Select
              aria-label="Comparison"
              value={row.op}
              onChange={(e) => setRow(i, { op: e.target.value as Row['op'] })}
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {!unary && (
              <Input
                aria-label="Compare with"
                className="font-mono"
                value={row.right}
                placeholder="18"
                onChange={(e) => setRow(i, { right: e.target.value })}
              />
            )}
          </fieldset>
        )
      })}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => update({ ...builder, rows: [...builder.rows, newRow()] })}
      >
        <Plus /> Add condition
      </Button>
    </div>
  )
}
