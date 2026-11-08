import { useState } from 'react'
import { Input } from '../ui/input.tsx'
import { BLOCK_MIME, groupBlocks } from './blocks-list.ts'
import { useEditor } from './store.ts'
import { CATEGORY } from './theme.ts'

export function Palette({ onAdd }: { onAdd: (type: string) => void }) {
  const blocks = useEditor((s) => s.blocks)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const match = (text: string) => text.toLowerCase().includes(q)
  const groups = groupBlocks(
    [...blocks.values()].filter((b) => !q || match(b.name) || match(b.description)),
  )

  return (
    <aside aria-label="Blocks" className="flex w-48 shrink-0 flex-col border-r border-line">
      <div className="p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a block"
          aria-label="Find a block"
        />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {groups.map(([category, list]) => (
          <section key={category}>
            <h3 className="px-1 pb-1 text-xs text-muted">{CATEGORY[category].label}</h3>
            <ul className="space-y-0.5">
              {list.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    draggable
                    title={b.description}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(BLOCK_MIME, b.id)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => onAdd(b.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-line/60"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: CATEGORY[category].colour }}
                    />
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="px-1 text-sm text-muted">No blocks match.</p>}
      </div>
      <p className="border-t border-line p-2 text-xs text-muted">
        Drag onto the canvas, or press <kbd className="font-mono">Space</kbd> there.
      </p>
    </aside>
  )
}
