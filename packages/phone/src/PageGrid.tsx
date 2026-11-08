import { TileIcon } from '@tessel/brand/icons'
import type { PhonePage, PhoneTile } from '@tessel/core'
import type { TileOverride } from './connection.ts'
import { fitGrid, orient, textOn } from './layout.ts'

interface Props {
  page: PhonePage
  width: number
  height: number
  overrides: Record<string, TileOverride>
  pressedId: string | undefined
  disabled: boolean
}

const BACK: PhoneTile = {
  id: '__back',
  label: 'Back',
  icon: 'arrow-left',
  colour: '#212833',
  kind: 'action',
  position: { col: 0, row: 0 },
  span: { w: 1, h: 1 },
}

/** Draws one page. Gestures are handled by the Pager around it. */
export function PageGrid({ page, width, height, overrides, pressedId, disabled }: Props) {
  const shown = orient(page, width > height)
  const { size, gap } = fitGrid(width, height, shown.cols, shown.rows)
  if (size <= 0) return null
  const step = size + gap
  const tiles = page.kind === 'folder' ? [BACK, ...shown.tiles] : shown.tiles

  return (
    <div
      className="relative"
      style={{ width: shown.cols * step - gap, height: shown.rows * step - gap }}
    >
      {tiles.map((t) => {
        const tile = { ...t, ...overrides[t.id] }
        const short = Math.min(t.span.w, t.span.h) * size
        const kind = t.id === BACK.id ? 'back' : t.kind
        const icon = tile.icon || (t.kind === 'folder' ? 'folder' : '')
        return (
          <div
            key={t.id}
            role="button"
            aria-label={kind === 'folder' ? `${tile.label} folder` : tile.label}
            aria-disabled={disabled || undefined}
            data-tile-id={t.id}
            data-tile-kind={kind}
            data-target={t.targetPageId}
            data-pressed={pressedId === t.id}
            className="tile absolute flex flex-col justify-between overflow-hidden text-left leading-tight font-semibold aria-disabled:opacity-60"
            style={{
              left: t.position.col * step,
              top: t.position.row * step,
              width: t.span.w * step - gap,
              height: t.span.h * step - gap,
              borderRadius: short * 0.2,
              padding: Math.round(size * 0.1),
              fontSize: Math.max(11, Math.min(18, size * 0.13)),
              background: tile.colour,
              color: textOn(tile.colour),
            }}
          >
            <TileIcon icon={icon} size={Math.round(short * 0.3)} />
            <span className="line-clamp-3 [overflow-wrap:anywhere]">{tile.label}</span>
          </div>
        )
      })}
    </div>
  )
}
