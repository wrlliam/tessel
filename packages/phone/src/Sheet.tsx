import type { ReactNode } from 'react'

/** A panel that rises from the bottom edge, over a dimmed page. */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close"
        className="sheet-backdrop absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="sheet-panel absolute inset-x-0 bottom-0 rounded-t-[20px] bg-surface px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[0_-8px_24px_rgb(0_0_0/0.2)]">
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line" aria-hidden />
        {children}
      </div>
    </div>
  )
}

export function SheetRow({
  icon,
  label,
  detail,
  danger,
  onClick,
}: {
  icon: ReactNode
  label: string
  detail?: ReactNode
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors active:bg-line [&_svg]:size-[18px] [&_svg]:shrink-0 ${danger ? 'text-signal' : 'text-text'}`}
    >
      <span className={danger ? '' : 'text-muted'}>{icon}</span>
      <span className="flex-1">{label}</span>
      {detail && <span className="text-sm text-muted">{detail}</span>}
    </button>
  )
}
