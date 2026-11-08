import { TILE_COLOURS } from '@tessel/brand/key'
import { TILE_ICON_NAMES, TileIcon } from '@tessel/brand/icons'
import type { PhoneTile } from '@tessel/core'
import { ArrowLeftRight, Check } from 'lucide-react'
import { useState } from 'react'
import { Sheet } from './Sheet.tsx'

export interface KeyEdit {
  label?: string
  colour?: string
  icon?: string
}

/** Changes one key's name, colour and icon, or starts swapping it with another. */
export function EditSheet({
  tile,
  look,
  onSave,
  onSwap,
  onClose,
}: {
  tile: PhoneTile
  look: { label: string; colour: string; icon: string }
  onSave: (edit: KeyEdit) => void
  onSwap: () => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(look.label)
  const [colour, setColour] = useState(look.colour)
  const [icon, setIcon] = useState(look.icon)
  const save = () => {
    const edit: KeyEdit = {}
    if (label !== tile.label) edit.label = label
    if (colour !== tile.colour) edit.colour = colour
    if (icon !== (tile.icon ?? '')) edit.icon = icon
    if (Object.keys(edit).length) onSave(edit)
    onClose()
  }
  return (
    <Sheet open onClose={onClose} label={`Edit ${look.label || 'key'}`}>
      <div className="space-y-4 px-1 pb-1">
        <label className="block">
          <span className="text-xs text-muted">Name</span>
          <input
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl bg-bg px-3 text-[15px] outline-none focus:ring-2 focus:ring-glaze"
          />
        </label>
        <div>
          <span className="text-xs text-muted">Colour</span>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {TILE_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c.toLowerCase() === colour.toLowerCase()}
                aria-label={c}
                onClick={() => setColour(c)}
                className="size-9 rounded-full border border-line aria-checked:ring-2 aria-checked:ring-text aria-checked:ring-offset-2 aria-checked:ring-offset-surface"
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <span className="text-xs text-muted">Icon</span>
          <div
            className="mt-2 grid max-h-40 grid-cols-8 gap-1 overflow-y-auto"
            role="radiogroup"
            aria-label="Icon"
          >
            <button
              type="button"
              role="radio"
              aria-checked={icon === ''}
              onClick={() => setIcon('')}
              className="flex h-10 items-center justify-center rounded-lg text-xs text-muted aria-checked:bg-line aria-checked:text-text"
            >
              None
            </button>
            {TILE_ICON_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={icon === name}
                aria-label={name}
                onClick={() => setIcon(name)}
                className="flex h-10 items-center justify-center rounded-lg text-muted aria-checked:bg-line aria-checked:text-text"
              >
                <TileIcon icon={name} size={20} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              onSwap()
              onClose()
            }}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-bg text-[15px]"
          >
            <ArrowLeftRight className="size-4" /> Swap with…
          </button>
          <button
            type="button"
            onClick={save}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-text text-[15px] font-medium text-bg"
          >
            <Check className="size-4" /> Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}
