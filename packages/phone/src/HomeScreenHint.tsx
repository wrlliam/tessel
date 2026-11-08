import { Share } from 'lucide-react'
import { useState } from 'react'
import { inNativeApp, isIosSafari, isStandalone } from './device.ts'

const KEY = 'tessel.homeHintDismissed'

function dismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

export function HomeScreenHint() {
  const [hidden, setHidden] = useState(
    () => dismissed() || isStandalone() || inNativeApp() || !isIosSafari(),
  )
  if (hidden) return null
  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-2xl bg-surface py-2 pr-2 pl-4 text-sm shadow-[inset_0_0_0_1px_var(--key-line)]">
      <Share className="size-[18px] shrink-0 text-muted" aria-hidden />
      <p className="flex-1 text-muted">
        Full screen: Share, then <span className="text-text">Add to Home Screen</span>
      </p>
      <button
        type="button"
        className="min-h-11 px-3 text-glaze"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1')
          } catch {
            // Storage blocked; hide for this session only.
          }
          setHidden(true)
        }}
      >
        Got it
      </button>
    </div>
  )
}
