import { Wordmark } from './Logo.tsx'

/** Full-screen state while there's nothing to press yet. */
export function StatusScreen({
  title,
  detail,
  tone,
}: {
  title: string
  detail: string
  tone: 'waiting' | 'error'
}) {
  return (
    <main className="flex h-full flex-col px-6 pt-[calc(env(safe-area-inset-top)+24px)] pb-[env(safe-area-inset-bottom)]">
      <Wordmark />
      <div className="mt-auto mb-auto space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${tone === 'error' ? 'bg-signal' : 'bg-cat-trigger'}`}
            aria-hidden
          />
          <h1 className="text-[22px] leading-7 font-medium">{title}</h1>
        </div>
        <p className="max-w-[32ch] text-muted">{detail}</p>
        <p className="font-mono text-xs text-muted">{location.host}</p>
      </div>
    </main>
  )
}
