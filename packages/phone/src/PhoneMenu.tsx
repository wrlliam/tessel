import { Pencil, LogOut, Monitor, MoonStar } from 'lucide-react'
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
  /** Present when the computer lets phones edit keys. */
  onEdit?: () => void
}

export function PhoneMenu({ open, onClose, dim, onDim, onForget, onEdit }: Props) {
  const [confirm, setConfirm] = useState(false)
  const close = () => {
    setConfirm(false)
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} label="Menu">
      {onEdit && (
        <SheetRow
          icon={<Pencil />}
          label="Edit keys"
          detail="Name, colour, icon, place"
          onClick={() => {
            close()
            onEdit()
          }}
        />
      )}
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
