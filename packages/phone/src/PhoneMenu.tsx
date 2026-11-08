import { useState } from 'react'

const DIM_KEY = 'tessel.dim'

export function loadDim() {
  try {
    return localStorage.getItem(DIM_KEY) === '1'
  } catch {
    return false
  }
}

interface Props {
  dim: boolean
  onDim: (on: boolean) => void
  onForget: () => void
}

export function PhoneMenu({ dim, onDim, onForget }: Props) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setConfirm(false)
        }}
        className="flex size-11 items-center justify-center rounded-full text-xl text-muted"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 bottom-12 z-10 w-56 space-y-1 rounded-2xl border border-line bg-surface p-2 text-sm shadow-xl">
          <button
            type="button"
            role="switch"
            aria-checked={dim}
            className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left"
            onClick={() => {
              const next = !dim
              try {
                localStorage.setItem(DIM_KEY, next ? '1' : '0')
              } catch {
                // Storage blocked: keep it for this session only.
              }
              onDim(next)
            }}
          >
            Dim screen <span className="text-muted">{dim ? 'On' : 'Off'}</span>
          </button>
          <button
            type="button"
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-signal"
            onClick={() => (confirm ? onForget() : setConfirm(true))}
          >
            {confirm ? 'Tap again to forget' : 'Forget this computer'}
          </button>
        </div>
      )}
    </div>
  )
}
