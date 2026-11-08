import type { ReactNode } from 'react'

export function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string
  help?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs text-muted">
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-muted/80">{help}</p>}
    </div>
  )
}
