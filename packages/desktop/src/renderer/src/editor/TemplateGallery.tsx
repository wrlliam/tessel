import { templates, type TileTemplate } from '@tessel/core'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from '../ui/button.tsx'
import { TileFace, textOn } from './TileFace.tsx'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: TileTemplate) => void
}

export function TemplateGallery({ open, onOpenChange, onPick }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[80vh] w-[min(720px,90vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-semibold">
                Start from a template
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                Each one is an ordinary tile you can change afterwards.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <ul className="grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex h-full w-full items-start gap-3 rounded-xl border border-line p-3 text-left hover:border-muted"
                >
                  <span
                    aria-hidden
                    className="flex size-14 shrink-0 flex-col justify-between overflow-hidden rounded-[11px] p-1.5 text-[9px] leading-tight font-semibold"
                    style={{ background: t.tile.colour, color: textOn(t.tile.colour) }}
                  >
                    <TileFace
                      look={{ label: t.tile.label, colour: t.tile.colour, icon: t.tile.icon ?? '' }}
                      size={48}
                    />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="block text-xs text-muted">{t.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
