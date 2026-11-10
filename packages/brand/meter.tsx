// Graphic tile faces: a ring or bar that fills with a number, or a chart of its recent values.
// Shared by the phone and the editor's preview.

export interface MeterDisplay {
  kind: 'ring' | 'bar' | 'line' | 'columns'
  min: number
  max: number
  zones: Array<{ from: number; colour: string }>
}

export interface MeterReading {
  value: number | null
  colour: string
  text: string
}

const fraction = (d: MeterDisplay, v: number | null) =>
  v === null || d.max === d.min ? 0 : Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min)))

/** Zone colour for a past value, so chart points keep the colour they had. */
function colourAt(d: MeterDisplay, v: number, fallback: string) {
  let c = fallback
  for (const z of [...d.zones].sort((a, b) => a.from - b.from)) if (v >= z.from) c = z.colour
  return c
}

const track = 'color-mix(in oklab, var(--k-text) 14%, transparent)'

interface Props {
  display: MeterDisplay
  reading: MeterReading
  label: string
  /** Recent values for charts, oldest first. */
  points?: number[]
  /** Shorter side of the key in px. */
  size: number
  /** Tile colour, used below the first zone. */
  base: string
  showLabel?: boolean
}

/** The face of a display tile. Fills the key, inside its padding. */
export function KeyMeter({
  display,
  reading,
  label,
  points = [],
  size,
  base,
  showLabel = true,
}: Props) {
  const pad = Math.round(Math.max(8, size * 0.1))
  const small = Math.round(Math.max(10, Math.min(15, size * 0.11)))
  const big = Math.round(Math.max(14, Math.min(40, size * 0.24)))
  const f = fraction(display, reading.value)
  const box = { position: 'absolute', inset: pad, display: 'flex' } as const
  const labelEl = showLabel && label && (
    <span
      className="key-label"
      style={{ fontSize: small, WebkitLineClamp: 1, opacity: 0.8, textAlign: 'left' }}
    >
      {label}
    </span>
  )

  if (display.kind === 'ring') {
    const r = 42
    const c = 2 * Math.PI * r
    // A 270° gauge, open at the bottom, like a dial.
    const arc = c * 0.75
    return (
      <span
        style={{
          ...box,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <span style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}>
          <svg
            viewBox="0 0 100 100"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            aria-hidden
          >
            <g transform="rotate(135 50 50)">
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={track}
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${arc} ${c}`}
              />
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={reading.colour}
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0.001, arc * f)} ${c}`}
                style={{ transition: 'stroke-dasharray 300ms ease, stroke 300ms ease' }}
              />
            </g>
          </svg>
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: Math.round(big * 0.8),
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {reading.text}
          </span>
        </span>
        {showLabel && label && (
          <span className="key-label" style={{ fontSize: small, WebkitLineClamp: 1, opacity: 0.8 }}>
            {label}
          </span>
        )}
      </span>
    )
  }

  const header = (
    <span
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 6,
        minWidth: 0,
      }}
    >
      {labelEl || <span />}
      <span
        style={{
          fontSize: big * 0.75,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          color: reading.colour === base ? undefined : reading.colour,
        }}
      >
        {reading.text}
      </span>
    </span>
  )

  if (display.kind === 'bar') {
    return (
      <span style={{ ...box, flexDirection: 'column', justifyContent: 'space-between' }}>
        {header}
        <span
          style={{
            position: 'relative',
            height: Math.max(6, Math.round(size * 0.09)),
            borderRadius: 999,
            background: track,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: 0,
              width: `${f * 100}%`,
              background: reading.colour,
              borderRadius: 999,
              transition: 'width 300ms ease, background 300ms ease',
            }}
          />
        </span>
      </span>
    )
  }

  // Charts: scale to the display's range, newest on the right.
  const shown = points.slice(-60)
  const n = shown.length
  const W = 100
  const H = 40
  const y = (v: number) => H - fraction(display, v) * H
  return (
    <span style={{ ...box, flexDirection: 'column', gap: 4 }}>
      {header}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ flex: 1, width: '100%', minHeight: 0, overflow: 'visible' }}
        aria-hidden
      >
        {n === 0 ? (
          <line
            x1="0"
            x2={W}
            y1={H}
            y2={H}
            stroke={track}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : display.kind === 'columns' ? (
          shown.map((v, i) => {
            const w = W / Math.max(n, 20)
            const x = W - (n - i) * w
            return (
              <rect
                key={i}
                x={x + w * 0.15}
                width={w * 0.7}
                y={y(v)}
                height={H - y(v)}
                rx={0.8}
                fill={colourAt(display, v, base)}
                opacity={i === n - 1 ? 1 : 0.75}
              />
            )
          })
        ) : (
          (() => {
            const step = n > 1 ? W / (n - 1) : 0
            const pts = shown.map(
              (v, i) => `${(n > 1 ? i * step : W).toFixed(2)},${y(v).toFixed(2)}`,
            )
            return (
              <>
                <polygon
                  points={`0,${H} ${pts.join(' ')} ${W},${H}`}
                  fill={reading.colour}
                  opacity="0.16"
                />
                <polyline
                  points={pts.join(' ')}
                  fill="none"
                  stroke={reading.colour}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )
          })()
        )}
      </svg>
    </span>
  )
}
