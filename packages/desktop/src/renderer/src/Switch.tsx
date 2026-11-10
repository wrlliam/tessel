interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Hide the text but keep it for screen readers. */
  hideLabel?: boolean
  /** Neutral switches stay grey when on; the accent is kept for the ones that matter. */
  tone?: 'accent' | 'neutral'
}

export function Switch({ checked, onChange, label, hideLabel, tone = 'accent' }: Props) {
  const on = tone === 'accent' ? 'bg-glaze' : 'bg-text'
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
      <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${checked ? on : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full transition-transform duration-150 ${checked ? `translate-x-4 ${tone === 'accent' ? 'bg-ink-900' : 'bg-bg'}` : 'bg-text/80'}`}
        />
      </button>
    </label>
  )
}
