import { parseCombo, resolveCombo, type OS } from '@tessel/core'
import { Input } from '../../ui/input.tsx'

const MAC = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' } as const
const OTHER = { meta: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' } as const

export function describeCombo(
  value: string,
  os: OS,
): { ok: true; text: string } | { ok: false; text: string } {
  if (value.includes('{{')) return { ok: true, text: 'Worked out when the tile runs' }
  try {
    const combo = resolveCombo(parseCombo(value), os)
    const names = os === 'darwin' ? MAC : OTHER
    const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key
    return {
      ok: true,
      text: [...combo.modifiers.map((m) => names[m]), key].join(os === 'darwin' ? ' ' : ' + '),
    }
  } catch (err) {
    return { ok: false, text: (err as Error).message }
  }
}

export function ComboField({
  id,
  value,
  os,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  os: OS
  placeholder?: string | undefined
  onChange: (v: string) => void
}) {
  const result = value ? describeCombo(value, os) : undefined
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
