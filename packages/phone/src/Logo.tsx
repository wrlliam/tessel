import logoUrl from '@tessel/brand/logo-mark.svg'

export function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <img src={logoUrl} alt="" className="size-10" />
      <span className="font-display text-3xl font-semibold tracking-tight">Tessel</span>
    </div>
  )
}
