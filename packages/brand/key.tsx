// The Tessel key: one material shared by the phone and the editor's preview.
import type { CSSProperties } from 'react'
import { TileIcon } from './icons.tsx'
import { KeyMeter, type MeterDisplay, type MeterReading } from './meter.tsx'

export type KeyStyle = 'tinted' | 'solid' | 'outline' | 'glass'
export type KeyShape = 'rounded' | 'square' | 'round'

/** Corner radius for a key: rounded is 20% of the short side, round makes circles and pills. */
export function keyRadius(shape: KeyShape, width: number, height: number): number {
  const side = Math.min(width, height)
  return Math.round(side * (shape === 'round' ? 0.5 : shape === 'square' ? 0.08 : 0.2))
}

/** The colours offered for tiles, on the desktop and the phone. */
export const TILE_COLOURS = [
  '#22D3C5',
  '#4FA3F7',
  '#8B7CF6',
  '#F5B63D',
  '#FF7A59',
  '#F25C6E',
  '#1DB954',
  '#212833',
  '#161B22',
  '#F4F6F8',
]

export const ICON_SCALE = { small: 0.8, regular: 1, large: 1.25 } as const

export interface KeyLook {
  label: string
  colour: string
  icon: string
  /** A small picture (data: URL) shown instead of the icon, e.g. album art. */
  image?: string
  /** Display tiles: the number now. */
  meter?: MeterReading | undefined
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Ink or Paper text, whichever reads better on a colour. */
export const textOn = (hex: string) => (luminance(hex) > 0.25 ? '#0E1116' : '#F4F6F8')

/**
 * CSS variables for a key face. Tinted keys keep the face dark and let the colour show in a
 * soft tint and the indicator light; solid keys fill the face with the colour.
 */
export function keyVars(colour: string, style: KeyStyle, active?: boolean): CSSProperties {
  // Near-black tile colours (the Ink defaults) mean "no colour": plain face, unlit light.
  const plain = luminance(colour) < 0.03
  const light = plain ? 'var(--key-light-off)' : colour
  const tint = (pct: number) => `color-mix(in oklab, ${colour} ${pct}%, var(--key-face))`
  const vars: Record<string, string> =
    style === 'solid'
      ? { '--k-face': colour, '--k-text': textOn(colour), '--k-light': 'transparent' }
      : style === 'outline'
        ? {
            '--k-face': 'var(--key-face)',
            '--k-text': 'var(--text)',
            '--k-light': light,
            '--k-ring': plain
              ? 'var(--key-line)'
              : `color-mix(in oklab, ${colour} 70%, transparent)`,
            '--k-ring-w': '1.5px',
          }
        : style === 'glass'
          ? {
              '--k-face': plain ? 'var(--key-face)' : tint(24),
              '--k-text': 'var(--text)',
              '--k-light': light,
              '--k-ring': 'rgb(255 255 255 / 0.10)',
              '--k-sheen':
                'linear-gradient(180deg, rgb(255 255 255 / 0.10), rgb(255 255 255 / 0) 55%)',
            }
          : {
              '--k-face': plain
                ? 'var(--key-face)'
                : `color-mix(in oklab, ${colour} 16%, var(--key-face))`,
              '--k-text': 'var(--text)',
              '--k-light': light,
            }
  // Something on the computer says this key is on (e.g. its app is open): light it and ring it.
  if (active === true) {
    const lit = plain ? 'var(--glaze)' : colour
    vars['--k-light'] = lit
    vars['--k-ring'] = `color-mix(in oklab, ${lit} 65%, transparent)`
    vars['--k-ring-w'] = '2px'
  } else if (active === false && style !== 'solid') vars['--k-light'] = 'var(--key-light-off)'
  return vars as CSSProperties
}

interface FaceProps {
  look: KeyLook
  /** Shorter side of the key in px; sizes inside scale from it. */
  size: number
  labels?: boolean
  labelSize?: 'small' | 'regular' | 'large'
  folder?: boolean
  /** Number of keys inside a folder, shown instead of the light. */
  count?: number
  /** Lays the icon beside the label, for keys much wider than tall. */
  wide?: boolean
  /** Icon size relative to the usual. */
  iconScale?: number
  /** The small indicator light in the corner. */
  lights?: boolean
  /** Round keys keep the light and count further in, inside the curve. */
  shape?: KeyShape
  /** Draws a ring, bar or chart instead of the icon. */
  display?: MeterDisplay | undefined
  /** Chart tiles: recent values, oldest first. */
  points?: number[] | undefined
}

const LABEL = { small: [10, 0.1, 13], regular: [11, 0.115, 15], large: [12, 0.135, 17] } as const

/** What sits on a key: a centred icon with its label below, plus the indicator light or folder count. */
export function KeyFace({
  look,
  size,
  labels = true,
  labelSize = 'regular',
  folder,
  count,
  wide,
  iconScale = 1,
  lights = true,
  shape = 'rounded',
  display,
  points,
}: FaceProps) {
  if (display) {
    // Near-black tile colours mean "no colour": draw in Glaze so the graphic shows.
    const lit = (c: string) =>
      /^#[0-9a-fA-F]{6}$/.test(c) && luminance(c) < 0.03 ? 'var(--glaze)' : c
    const reading = look.meter ?? { value: null, colour: look.colour, text: '–' }
    return (
      <span className="key-face">
        <KeyMeter
          display={display}
          reading={{ ...reading, colour: lit(reading.colour) }}
          label={look.label}
          points={points}
          size={size}
          base={lit(look.colour)}
          showLabel={labels}
        />
      </span>
    )
  }
  const [min, ratio, max] = LABEL[labelSize]
  const font = Math.round(Math.max(min, Math.min(max, size * ratio)))
  const icon = look.icon || (folder ? 'folder' : '')
  const corner = Math.round(Math.max(8, size * (shape === 'round' ? 0.2 : 0.1)))
  const iconSize = Math.round(Math.min(labels ? 34 : 44, size * (labels ? 0.28 : 0.36)) * iconScale)
  return (
    <span
      className="key-face"
      data-wide={wide || undefined}
      style={{
        padding: wide ? `0 ${corner * 2}px` : corner,
        gap: Math.round(size * (wide ? 0.2 : 0.07)),
      }}
    >
      {folder
        ? count !== undefined && (
            <span className="key-count" style={{ top: corner, right: corner }} aria-hidden>
              {count}
            </span>
          )
        : lights && (
            <span className="key-light" style={{ top: corner, right: corner }} aria-hidden />
          )}
      {look.image ? (
        // A picture sits where the icon would, a little larger, like a preview.
        <img
          src={look.image}
          alt=""
          className="key-image"
          style={{
            width: Math.round(iconSize * 1.55),
            height: Math.round(iconSize * 1.55),
            borderRadius: Math.max(4, Math.round(iconSize * 0.22)),
          }}
        />
      ) : (
        icon && <TileIcon icon={icon} size={iconSize} className="key-icon" />
      )}
      {(labels || !icon) && (
        <span className="key-label" style={{ fontSize: font }}>
          {look.label}
        </span>
      )}
    </span>
  )
}
