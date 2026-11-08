import type { PhonePage, PhoneTile } from '@tessel/core'
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { TileOverride } from './connection.ts'
import { haptic } from './device.ts'
import { fitGrid, orient, textOn } from './layout.ts'

const MIN_PRESS_MS = 90

interface Props {
  page: PhonePage
  overrides: Record<string, TileOverride>
  disabled: boolean
  onPress: (tileId: string, phase: 'down' | 'up') => void
}

function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

export function Grid({ page, overrides, disabled, onPress }: Props) {
  const [ref, box] = useBoxSize()
  const shown = orient(page, box.width > box.height)
  const { size, gap } = fitGrid(box.width, box.height, shown.cols, shown.rows)
  const step = size + gap

  return (
    <div ref={ref} className="relative min-h-0 flex-1 p-3">
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: shown.cols * step - gap, height: shown.rows * step - gap }}
      >
        {size > 0 &&
          shown.tiles.map((tile) => (
            <Tile
              key={tile.id}
              tile={{ ...tile, ...overrides[tile.id] }}
              style={{
                left: tile.position.col * step,
                top: tile.position.row * step,
                width: tile.span.w * step - gap,
                height: tile.span.h * step - gap,
                borderRadius: Math.min(tile.span.w, tile.span.h) * size * 0.2,
                fontSize: Math.max(11, Math.min(18, size * 0.13)),
                padding: Math.round(size * 0.1),
              }}
              disabled={disabled}
              onPress={(phase) => onPress(tile.id, phase)}
            />
          ))}
      </div>
    </div>
  )
}

interface TileProps {
  tile: PhoneTile
  style: CSSProperties
  disabled: boolean
  onPress: (phase: 'down' | 'up') => void
}

function Tile({ tile, style, disabled, onPress }: TileProps) {
  const [pressed, setPressed] = useState(false)
  const downAt = useRef(0)

  function down(e: PointerEvent<HTMLButtonElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    downAt.current = performance.now()
    setPressed(true)
    haptic()
    onPress('down')
  }

  function up() {
    if (!pressed) return
    onPress('up')
    // Keep the pressed look visible for a beat even on very quick taps.
    const wait = Math.max(0, MIN_PRESS_MS - (performance.now() - downAt.current))
    setTimeout(() => setPressed(false), wait)
  }

  return (
    <button
      type="button"
      className="tile absolute flex items-end overflow-hidden text-left leading-tight font-semibold disabled:opacity-60"
      data-pressed={pressed}
      disabled={disabled}
      style={{ ...style, background: tile.colour, color: textOn(tile.colour) }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="line-clamp-3 [overflow-wrap:anywhere]">{tile.label}</span>
    </button>
  )
}
