import { useState } from 'react'
import { isIosSafari, isStandalone } from './device.ts'

const KEY = 'tessel.homeHintDismissed'

function dismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

export function HomeScreenHint() {
  const [hidden, setHidden] = useState(() => dismissed() || isStandalone() || !isIosSafari())
  if (hidden) return null
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm">
      <p className="flex-1 text-muted">
        For full screen, tap Share, then <span className="text-text">Add to Home Screen</span>.
        You'll pair once more there.
      </p>
      <button
        type="button"
        className="min-h-11 px-2 text-glaze"
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
