import { LogOut, Monitor, MoonStar } from 'lucide-react'
import { useState } from 'react'
import { chooseAnotherComputer, inNativeApp } from './device.ts'
import { Sheet, SheetRow } from './Sheet.tsx'

const DIM_KEY = 'tessel.dim'

export function loadDim() {
  try {
    return localStorage.getItem(DIM_KEY) === '1'
  } catch {
    return false
  }
}

interface Props {
  open: boolean
  onClose: () => void
  dim: boolean
  onDim: (on: boolean) => void
  onForget: () => void
}

export function PhoneMenu({ open, onClose, dim, onDim, onForget }: Props) {
  const [confirm, setConfirm] = useState(false)
  const close = () => {
    setConfirm(false)
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} label="Menu">
      <SheetRow
        icon={<MoonStar />}
        label="Dim screen"
        detail={dim ? 'On' : 'Off'}
        onClick={() => {
          try {
            localStorage.setItem(DIM_KEY, dim ? '0' : '1')
          } catch {
            // Storage blocked: keep it for this session only.
          }
          onDim(!dim)
        }}
      />
      {inNativeApp() && (
        <SheetRow
          icon={<Monitor />}
          label="Choose another computer"
          onClick={chooseAnotherComputer}
        />
      )}
      <SheetRow
        icon={<LogOut />}
        label={confirm ? 'Tap again to forget this computer' : 'Forget this computer'}
        danger
        onClick={() => (confirm ? onForget() : setConfirm(true))}
      />
      <p className="px-3 pt-3 font-mono text-xs text-muted">Connected to {location.host}</p>
    </Sheet>
  )
}
