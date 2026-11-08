interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function Switch({ checked, onChange, label }: Props) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-glaze' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full shadow transition-transform ${checked ? 'translate-x-5 bg-ink-900' : 'bg-text'}`}
        />
      </button>
    </label>
  )
}
