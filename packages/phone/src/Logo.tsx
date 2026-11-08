import logoUrl from '@tessel/brand/logo-mark.svg'

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <img src={logoUrl} alt="" className="size-6" />
      <span className="font-display text-[17px] font-semibold">Tessel</span>
    </div>
  )
}
