import { ICON_SCALE, KeyFace, keyRadius, keyVars } from '@tessel/brand/key'
import type { PhonePage, PhoneProfile, PhoneSettings, PhoneTile } from '@tessel/core'
import type { TileOverride } from './connection.ts'
import { cellsFor, GAP, orient, reflow } from './layout.ts'

interface Props {
  profile: PhoneProfile
  page: PhonePage
  width: number
  height: number
  overrides: Record<string, TileOverride>
  pressedId: string | undefined
  disabled: boolean
  settings: PhoneSettings
  /** Slider positions being dragged on this phone, ahead of the desktop's echo. */
  dragging: Record<string, number>
  editing?: boolean
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
  dragging,
  editing,
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
  const gap = GAP[settings.spacing]
  const mode = sideways ? settings.landscape : 'fit'
  // Folders keep their layout: the Back key must stay in the corner.
  const shown =
    mode === 'reflow' && page.kind !== 'folder'
      ? reflow(page, width, height, gap)
      : orient(page, mode === 'rotate')
  const cells = cellsFor(
    width,
    height,
    shown.cols,
    shown.rows,
    gap,
    mode === 'fill' || mode === 'reflow',
  )
  if (cells.width <= 0 || cells.height <= 0) return null
  const stepX = cells.width + cells.gap
  const stepY = cells.height + cells.gap
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
            data-editing={(editing && kind !== 'back') || undefined}
            className="key absolute aria-disabled:opacity-50"
            style={{
              left: t.position.col * stepX,
              top: t.position.row * stepY,
              width: w,
              height: h,
              borderRadius: keyRadius(settings.keyShape, w, h),
              ...keyVars(
                look.colour,
                kind === 'back' ? 'tinted' : (t.style ?? settings.keyStyle),
                overrides[t.id]?.active,
              ),
            }}
          >
            {kind === 'slider' && (
              <SliderFill
                position={dragging[t.id] ?? overrides[t.id]?.value ?? 50}
                vertical={h > w * 1.1}
                colour={look.colour}
                solid={settings.keyStyle === 'solid'}
              />
            )}
            <KeyFace
              look={look}
              size={Math.min(w, h)}
              labels={settings.labels}
              labelSize={settings.labelSize}
              folder={folder}
              wide={w > h * 2}
              iconScale={ICON_SCALE[settings.iconSize]}
              lights={settings.lights}
              shape={settings.keyShape}
              {...(count !== undefined && { count })}
            />
          </div>
        )
      })}
    </div>
  )
}

/** The filled part of a slider key, from the bottom (tall keys) or the left (wide keys). */
function SliderFill(props: {
  position: number
  vertical: boolean
  colour: string
  solid: boolean
}) {
  const pct = `${Math.max(0, Math.min(100, props.position))}%`
  const background = props.solid
    ? 'rgb(255 255 255 / 0.22)'
    : `color-mix(in oklab, ${props.colour} 42%, transparent)`
  return (
    <span
      aria-hidden
      className="key-fill"
      style={
        props.vertical
          ? { height: pct, width: '100%', background }
          : { width: pct, height: '100%', background }
      }
    />
  )
}
