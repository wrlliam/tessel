import {
  MiniMap,
  Panel,
  useReactFlow,
  useStore,
  useViewport,
  type MiniMapNodeProps,
} from '@xyflow/react'
import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'

const MAP_KEY = 'tessel.editor.overview'

function remembered(): boolean {
  try {
    return localStorage.getItem(MAP_KEY) !== 'off'
  } catch {
    return true
  }
}

/** A block on the map: its category colour, with a ring when selected, failed or running. */
function MapBlock({ x, y, width, height, color, selected, strokeColor }: MiniMapNodeProps) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={10}
        fill={color}
        fillOpacity={selected ? 1 : 0.75}
        stroke={strokeColor ?? (selected ? 'var(--text)' : 'none')}
        strokeWidth={strokeColor || selected ? 6 : 0}
      />
      <rect x={x} y={y} width={width} height={Math.min(14, height / 3)} rx={10} fill={color} />
    </g>
  )
}

const iconButton =
  'flex size-7 items-center justify-center rounded-md text-muted hover:bg-line hover:text-text disabled:opacity-40'

/**
 * Bottom of the canvas: zoom out, the zoom level (click for 100%), zoom in, fit everything, and
 * a map of the whole flow that shows where you are, with each block in its category colour.
 */
export function Overview({
  count,
  colourOf,
  ringOf,
}: {
  count: number
  colourOf: (nodeId: string) => string
  ringOf: (nodeId: string) => string | undefined
}) {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const { zoom } = useViewport()
  const [map, setMap] = useState(remembered)
  const toggle = () => {
    setMap(!map)
    try {
      localStorage.setItem(MAP_KEY, map ? 'off' : 'on')
    } catch {
      // Storage blocked; the choice lasts until the editor reloads.
    }
  }
  // A narrow canvas (wide sidebar) has no room for both; the zoom bar wins.
  const roomy = useStore((st) => st.width >= 560)
  const showMap = map && count > 1 && roomy

  return (
    <>
      <Panel position="bottom-left" className="!m-3">
        <div
          role="toolbar"
          aria-label="View"
          className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm"
        >
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            className={iconButton}
            onClick={() => void zoomOut({ duration: 150 })}
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            title="Back to 100%"
            aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
            className="h-7 w-12 rounded-md font-mono text-xs text-muted tabular-nums hover:bg-line hover:text-text"
            onClick={() => void zoomTo(1, { duration: 150 })}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            className={iconButton}
            onClick={() => void zoomIn({ duration: 150 })}
          >
            <Plus className="size-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button
            type="button"
            aria-label="Fit all blocks"
            title="Fit all blocks"
            className={iconButton}
            onClick={() => void fitView({ maxZoom: 1, padding: 0.3, duration: 200 })}
          >
            <Maximize className="size-4" />
          </button>
          <button
            type="button"
            aria-pressed={map}
            aria-label={map ? 'Hide the map' : 'Show the map'}
            title={map ? 'Hide the map' : 'Show the map'}
            className={cn(iconButton, map && 'bg-line text-text')}
            onClick={toggle}
          >
            <MapIcon className="size-4" />
          </button>
        </div>
      </Panel>
      {showMap && (
        <MiniMap
          pannable
          zoomable
          ariaLabel="Map of the whole flow. Drag to move around."
          className="overview-map !m-3"
          style={{ width: 208, height: 136 }}
          nodeComponent={MapBlock}
          nodeColor={(n) => colourOf(n.id)}
          nodeStrokeColor={(n) => ringOf(n.id) ?? ''}
          maskStrokeColor="var(--glaze)"
          maskStrokeWidth={2}
          offsetScale={8}
        />
      )}
    </>
  )
}
