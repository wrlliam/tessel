import type { PhoneTile } from '@tessel/core'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Connection, Point, TileOverride } from './connection.ts'

const RANGES = [
  { label: '1 min', ms: 60_000 },
  { label: '10 min', ms: 600_000 },
  { label: '1 h', ms: 3_600_000 },
  { label: '24 h', ms: 86_400_000 },
] as const

const W = 1000
const H = 400

const clock = (t: number, withSeconds: boolean) =>
  new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  })

const span = (minutes: number) =>
  minutes >= 1440
    ? `${Math.round(minutes / 1440)} ${minutes >= 2880 ? 'days' : 'day'}`
    : minutes >= 60
      ? `${Math.round(minutes / 60)} h`
      : `${minutes} min`

/**
 * A chart tile's whole history, full screen. Drag sideways to go back in time; older points
 * load as you reach them. Back at the right edge it follows new values again.
 */
export function HistoryView({
  tile,
  look,
  connection,
  onClose,
}: {
  tile: PhoneTile
  look: TileOverride & { label: string; colour: string }
  connection: Connection
  onClose: () => void
}) {
  const display = tile.display
  const [points, setPoints] = useState<Point[]>([])
  const [more, setMore] = useState(false)
  const [keep, setKeep] = useState<number>()
  const [range, setRange] = useState<number>(RANGES[1].ms)
  // Where the right edge of the chart is; undefined follows the newest point.
  const [end, setEnd] = useState<number>()
  const [readout, setReadout] = useState<Point>()
  const loading = useRef(false)
  const [openedAt] = useState(() => Date.now())
  const drag = useRef<{ x: number; end: number; width: number } | null>(null)

  useEffect(() => {
    const off = connection.onHistory((e) => {
      if (e.tileId !== tile.id) return
      if (e.kind === 'live') {
        setPoints((p) => [...p, e.point])
        return
      }
      loading.current = false
      if (e.keepMinutes > 0) setKeep(e.keepMinutes)
      if (e.before === undefined) {
        setPoints(e.points)
        setMore(e.more)
      } else {
        setPoints((p) => [...e.points.filter((x) => x[0] < (p[0]?.[0] ?? Infinity)), ...p])
        setMore(e.more)
      }
    })
    loading.current = true
    connection.requestHistory(tile.id)
    return off
  }, [connection, tile.id])

  const newest = points.at(-1)?.[0] ?? openedAt
  const right = end ?? newest
  const left = right - range
  const first = points[0]?.[0]

  // Reaching the oldest loaded point asks for the ones before it.
  useEffect(() => {
    if (more && first !== undefined && left < first && !loading.current) {
      loading.current = true
      connection.requestHistory(tile.id, first)
    }
  }, [more, first, left, connection, tile.id])

  const visible = useMemo(() => {
    // One point either side, so lines run to the edges.
    let a = points.findIndex((p) => p[0] >= left)
    if (a < 0) a = points.length
    let b = points.findIndex((p) => p[0] > right)
    if (b < 0) b = points.length
    return points.slice(Math.max(0, a - 1), Math.min(points.length, b + 1))
  }, [points, left, right])

  if (!display) return null
  const lo = display.min
  const hi = display.max === display.min ? display.min + 1 : display.max
  const x = (t: number) => ((t - left) / range) * W
  const y = (v: number) => H - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * H
  const colour = look.meter?.colour ?? look.colour
  const line = visible.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')

  function pointAt(clientX: number, box: DOMRect): Point | undefined {
    const t = left + ((clientX - box.left) / box.width) * range
    let best: Point | undefined
    for (const p of visible) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p
    return best
  }

  function down(e: PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const box = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX, end: right, width: box.width }
    setReadout(pointAt(e.clientX, box))
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current
    if (!d) return
    const shifted = d.end - ((e.clientX - d.x) / d.width) * range
    const oldest = (first ?? newest) + range * 0.5
    const next = Math.max(oldest, Math.min(newest, shifted))
    setEnd(next >= newest ? undefined : next)
    setReadout(pointAt(e.clientX, e.currentTarget.getBoundingClientRect()))
  }
  function up() {
    drag.current = null
    setReadout(undefined)
  }

  const shown = readout ?? points.at(-1)
  const following = end === undefined
  const decimals = display.decimals
  const unit = display.unit
  const fmt = (v: number) => `${v.toFixed(decimals)}${unit}`
  const secs = range <= 600_000

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${look.label} history`}
      className="fixed inset-0 z-30 flex flex-col bg-bg px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+12px)]"
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-medium">{look.label}</h2>
          <p className="font-mono text-[28px] leading-9 tabular-nums" style={{ color: colour }}>
            {shown ? fmt(shown[1]) : '–'}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {shown
              ? readout
                ? clock(shown[0], true)
                : following
                  ? 'Now'
                  : clock(shown[0], true)
              : 'Nothing recorded yet'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-full bg-text px-4 text-sm font-medium text-bg"
        >
          Done
        </button>
      </header>

      <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Show">
        {RANGES.map((r) => (
          <button
            key={r.ms}
            type="button"
            role="radio"
            aria-checked={range === r.ms}
            onClick={() => setRange(r.ms)}
            className="h-8 rounded-full px-3 text-sm text-muted shadow-[inset_0_0_0_1px_var(--key-line)] aria-checked:bg-text aria-checked:text-bg aria-checked:shadow-none"
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="relative mt-4 min-h-0 flex-1">
        <span className="absolute top-0 left-0 font-mono text-[11px] text-muted">{fmt(hi)}</span>
        <span className="absolute bottom-0 left-0 font-mono text-[11px] text-muted">{fmt(lo)}</span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="size-full touch-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Chart. Drag sideways to go back in time."
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={H * f}
              y2={H * f}
              stroke="var(--line)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {display.zones.map((z) => (
            <line
              key={z.from}
              x1="0"
              x2={W}
              y1={y(z.from)}
              y2={y(z.from)}
              stroke={z.colour}
              strokeDasharray="6 6"
              strokeWidth="1"
              opacity="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {visible.length > 0 &&
            (display.kind === 'columns' ? (
              visible.map((p) => {
                const w = Math.max(2, (W / Math.max(1, visible.length)) * 0.7)
                return (
                  <rect
                    key={p[0]}
                    x={x(p[0]) - w / 2}
                    width={w}
                    y={y(p[1])}
                    height={H - y(p[1])}
                    fill={colour}
                    opacity="0.8"
                  />
                )
              })
            ) : (
              <>
                <polygon
                  points={`${x(visible[0]?.[0] ?? left)},${H} ${line} ${x(visible.at(-1)?.[0] ?? right)},${H}`}
                  fill={colour}
                  opacity="0.14"
                />
                <polyline
                  points={line}
                  fill="none"
                  stroke={colour}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ))}
          {readout && (
            <line
              x1={x(readout[0])}
              x2={x(readout[0])}
              y1="0"
              y2={H}
              stroke="var(--text)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted tabular-nums">
        <span>{clock(left, secs)}</span>
        {!following && (
          <button type="button" className="text-glaze" onClick={() => setEnd(undefined)}>
            Back to now
          </button>
        )}
        <span>{following ? 'Now' : clock(right, secs)}</span>
      </div>
      <p className="mt-3 text-xs text-muted">
        Drag sideways to go back.
        {keep !== undefined && ` Your computer keeps the last ${span(keep)}.`}
      </p>
    </div>
  )
}
