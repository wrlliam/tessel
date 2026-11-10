import { Smartphone } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { DesktopState } from '../../shared/api.ts'
import { useNow } from './useDesktopState.ts'

/**
 * Asks before a phone gets in. The pairing code only opens the request; nothing connects until
 * someone here presses Approve.
 */
export function ApprovePhone({ state }: { state: DesktopState }) {
  const phone = state.pendingPhones[0]
  const refuse = useRef<HTMLButtonElement>(null)
  const now = useNow()
  // Focus Refuse, so a stray Enter never lets a phone in.
  useEffect(() => refuse.current?.focus(), [phone?.id])
  if (!phone) return null
  const secondsLeft = Math.max(0, Math.round((phone.expiresAt - now) / 1000))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approve-title"
        aria-describedby="approve-body"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-line">
            <Smartphone className="size-5 text-muted" aria-hidden />
          </span>
          <h2 id="approve-title" className="text-base font-medium">
            Let this phone connect?
          </h2>
        </div>
        <div id="approve-body" className="mt-4 space-y-2 text-sm">
          <p>
            <span className="text-text">{phone.name}</span>{' '}
            <span className="font-mono text-xs text-muted">{phone.ip}</span>
          </p>
          {phone.replaces && (
            <p className="text-muted">
              Replaces <span className="text-text">{phone.replaces.name}</span>, which stops
              working.
            </p>
          )}
          <p className="text-muted">
            It will be able to run every tile. Only approve a phone you're holding or expected.
          </p>
          <p className="text-xs text-muted tabular-nums">
            Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            {state.pendingPhones.length > 1 && ` · ${state.pendingPhones.length - 1} more waiting`}
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={refuse}
            type="button"
            onClick={() => void window.tessel.denyPhone(phone.id)}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-text"
          >
            Refuse
          </button>
          <button
            type="button"
            onClick={() => void window.tessel.approvePhone(phone.id)}
            className="rounded-lg bg-glaze px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
