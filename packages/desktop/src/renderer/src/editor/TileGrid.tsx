import type { Page } from '@tessel/core'
import { Plus } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import { freeCells } from './graph-utils.ts'
import { useEditor } from './store.ts'

const CELL = 64
const GAP = 8

/** Phone-shaped preview of the page. Click a tile to edit it, or an empty slot to add one. */
export function TileGrid({ page }: { page: Page }) {
  const selected = useEditor((s) => s.selectedTileId)
  const running = useEditor((s) => s.runningTiles)
  const { selectTile, addTile } = useEditor.getState()
  const step = CELL + GAP
  const place = (col: number, row: number, w = 1, h = 1) => ({
    left: col * step,
    top: row * step,
    width: w * step - GAP,
    height: h * step - GAP,
    borderRadius: Math.min(w, h) * CELL * 0.2,
  })

  return (
    <div className="mx-auto w-fit rounded-[32px] border border-line bg-bg p-4">
      <div
        className="relative"
        style={{ width: page.cols * step - GAP, height: page.rows * step - GAP }}
      >
        {freeCells(page).map(({ col, row }) => (
          <button
            key={`${col},${row}`}
            type="button"
            aria-label={`Add a tile in row ${row + 1}, column ${col + 1}`}
            onClick={() => addTile({ col, row })}
            className="group absolute flex items-center justify-center border border-dashed border-line text-muted/0 hover:border-muted hover:text-muted focus-visible:text-muted"
            style={place(col, row)}
          >
            <Plus className="size-4" />
          </button>
        ))}
        {page.tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === selected}
            onClick={() => selectTile(t.id)}
            className={cn(
              'absolute flex items-end overflow-hidden p-2 text-left text-[11px] leading-tight font-semibold',
              t.id === selected && 'ring-2 ring-glaze ring-offset-2 ring-offset-bg',
              running[t.id] && 'ring-2 ring-ember',
            )}
            style={{
              ...place(t.position.col, t.position.row, t.span.w, t.span.h),
              background: t.colour,
              color: textOn(t.colour),
            }}
          >
            <span className="line-clamp-2">{t.label || 'Untitled'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) > 150 ? '#0E1116' : '#F4F6F8'
}
