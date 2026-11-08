import { KeyFace, keyVars } from '@tessel/brand/key'
import type { PhonePage, PhoneProfile, PhoneSettings, PhoneTile } from '@tessel/core'
import type { TileOverride } from './connection.ts'
import { cellsFor, GAP, orient } from './layout.ts'

interface Props {
  profile: PhoneProfile
  page: PhonePage
  width: number
  height: number
  overrides: Record<string, TileOverride>
  pressedId: string | undefined
  disabled: boolean
  settings: PhoneSettings
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

/** Draws one page of keys. Gestures are handled by the Pager around it. */
export function PageGrid({
  profile,
  page,
  width,
  height,
  overrides,
  pressedId,
  disabled,
  settings,
}: Props) {
  const sideways = width > height
  const shown = orient(page, sideways && settings.landscape === 'rotate')
  const cells = cellsFor(
    width,
    height,
    shown.cols,
    shown.rows,
    GAP[settings.spacing],
    sideways && settings.landscape === 'fill',
  )
  if (cells.width <= 0 || cells.height <= 0) return null
  const stepX = cells.width + cells.gap
  const stepY = cells.height + cells.gap
  const radius = Math.round(Math.min(cells.width, cells.height) * 0.2)
  const tiles = page.kind === 'folder' ? [BACK, ...shown.tiles] : shown.tiles

  return (
    <div
      className="relative"
      style={{ width: shown.cols * stepX - cells.gap, height: shown.rows * stepY - cells.gap }}
    >
      {tiles.map((t) => {
        const look = { label: t.label, colour: t.colour, icon: t.icon ?? '', ...overrides[t.id] }
        const w = t.span.w * stepX - cells.gap
        const h = t.span.h * stepY - cells.gap
        const kind = t.id === BACK.id ? 'back' : t.kind
        const folder = kind === 'folder'
        const count = folder
          ? profile.pages.find((p) => p.id === t.targetPageId)?.tiles.length
          : undefined
        return (
          <div
            key={t.id}
            role="button"
            aria-label={folder ? `${look.label}, folder` : look.label}
            aria-disabled={disabled || undefined}
            data-tile-id={t.id}
            data-tile-kind={kind}
            data-target={t.targetPageId}
            data-pressed={pressedId === t.id}
            className="key absolute aria-disabled:opacity-50"
            style={{
              left: t.position.col * stepX,
              top: t.position.row * stepY,
              width: w,
              height: h,
              borderRadius: radius,
              ...keyVars(look.colour, kind === 'back' ? 'tinted' : settings.keyStyle),
            }}
          >
            <KeyFace
              look={look}
              size={Math.min(w, h)}
              labels={settings.labels}
              labelSize={settings.labelSize}
              folder={folder}
              wide={w > h * 2}
              {...(count !== undefined && { count })}
            />
          </div>
        )
      })}
    </div>
  )
}
