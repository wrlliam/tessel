import { cn } from '../lib/cn.ts'

interface Props<T extends string> {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}

/** A small set of mutually exclusive choices, shown side by side. */
export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg bg-bg p-0.5 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-md px-3 text-sm transition-colors duration-150',
            o.value === value ? 'bg-line text-text' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
