import { cronError, nextRuns } from '@tessel/core'
import { Input } from '../../ui/input.tsx'

const when = (d: Date) =>
  d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

export function describeCron(pattern: string): { ok: boolean; text: string } {
  const error = cronError(pattern)
  if (error) return { ok: false, text: error }
  const next = nextRuns(pattern, 3)
  return next.length
    ? { ok: true, text: `Next: ${next.map(when).join(', ')}` }
    : { ok: false, text: 'This never runs' }
}

export function CronField({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  placeholder?: string | undefined
  onChange: (v: string) => void
}) {
  const result = value.trim() ? describeCron(value) : undefined
  return (
    <div className="space-y-1">
      <Input
        id={id}
        className="font-mono"
        value={value}
        placeholder={placeholder}
        aria-invalid={result && !result.ok ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {result && (
        <p className={result.ok ? 'text-xs text-muted' : 'text-xs text-signal'}>{result.text}</p>
      )}
    </div>
  )
}
