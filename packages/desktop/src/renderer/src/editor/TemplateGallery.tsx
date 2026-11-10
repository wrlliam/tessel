import { KeyFace, keyVars, type KeyStyle } from '@tessel/brand/key'
import { TEMPLATE_CATEGORIES, templates, type TileTemplate } from '@tessel/core'
import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState } from 'react'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { useEditor } from './store.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (template: TileTemplate) => void
  keyStyle: KeyStyle
}

export function TemplateGallery({ open, onOpenChange, onPick, keyStyle }: Props) {
  const blocks = useEditor((s) => s.blocks)
  const hasPlugin = (id: string) => [...blocks.keys()].some((b) => b.startsWith(`${id}.`))
  const [getting, setGetting] = useState<string>()
  const missing = [
    ...new Set(
      templates.filter((t) => t.plugin && !hasPlugin(t.plugin)).map((t) => t.plugin as string),
    ),
  ]
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = templates.filter(
    (t) => !q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q),
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[84vh] w-[min(820px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
          <div className="flex items-start gap-4 border-b border-line p-6 pb-4">
            <div className="flex-1 space-y-1">
              <Dialog.Title className="font-display text-lg font-medium">
                Add a ready-made tile
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                Each one is an ordinary tile you can change afterwards
              </Dialog.Description>
              {missing.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  Some need a plugin:
                  {missing.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled={getting !== undefined}
                      onClick={async () => {
                        setGetting(id)
                        const r = await window.tessel.installFromCatalog(id)
                        setGetting(undefined)
                        if (!r.ok && 'error' in r) useEditor.setState({ notice: r.error })
                      }}
                      className="rounded-md border border-line px-2 py-0.5 font-mono text-text hover:bg-line/60 disabled:opacity-50"
                    >
                      {getting === id ? `Getting ${id}…` : `Get ${id}`}
                    </button>
                  ))}
                </p>
              )}
            </div>
            <Input
              autoFocus
              aria-label="Find a template"
              placeholder="Find"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-48"
            />
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div className="space-y-6 overflow-y-auto p-6 pt-4">
            {TEMPLATE_CATEGORIES.map((category) => {
              const list = shown.filter((t) => t.category === category)
              if (list.length === 0) return null
              return (
                <section key={category} aria-label={category}>
                  <h3 className="mb-2 text-sm text-muted">{category}</h3>
                  <ul className="grid grid-cols-2 gap-2">
                    {list.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => onPick(t)}
                          className="flex h-full w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-line/60 focus-visible:bg-line/60"
                        >
                          <span
                            aria-hidden
                            className="key size-14 shrink-0 rounded-[11px]"
                            style={keyVars(t.tile.colour, keyStyle)}
                          >
                            <KeyFace
                              look={{
                                label: t.tile.label,
                                colour: t.tile.colour,
                                icon: t.tile.icon ?? '',
                              }}
                              size={56}
                              labels={false}
                            />
                          </span>
                          <span className="min-w-0 space-y-0.5">
                            <span className="block text-sm font-medium">{t.name}</span>
                            <span className="line-clamp-2 block text-xs text-muted">
                              {t.description}
                            </span>
                            {t.plugin && !hasPlugin(t.plugin) && (
                              <span className="block font-mono text-[11px] text-muted">
                                Needs the {t.plugin} plugin
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
            {shown.length === 0 && <p className="text-sm text-muted">No templates match</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
