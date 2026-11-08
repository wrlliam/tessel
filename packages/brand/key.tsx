// The Tessel key: one material shared by the phone and the editor's preview.
import type { CSSProperties } from 'react'
import { TileIcon } from './icons.tsx'

export type KeyStyle = 'tinted' | 'solid'

export interface KeyLook {
  label: string
  colour: string
  icon: string
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
export function keyVars(colour: string, style: KeyStyle): CSSProperties {
  // Near-black tile colours (the Ink defaults) mean "no colour": plain face, unlit light.
  const plain = luminance(colour) < 0.03
  const light = plain ? 'var(--key-light-off)' : colour
  const vars: Record<string, string> =
    style === 'solid'
      ? { '--k-face': colour, '--k-text': textOn(colour), '--k-light': 'transparent' }
      : {
          '--k-face': plain
            ? 'var(--key-face)'
            : `color-mix(in oklab, ${colour} 16%, var(--key-face))`,
          '--k-text': 'var(--text)',
          '--k-light': light,
        }
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
}: FaceProps) {
  const [min, ratio, max] = LABEL[labelSize]
  const font = Math.round(Math.max(min, Math.min(max, size * ratio)))
  const icon = look.icon || (folder ? 'folder' : '')
  const corner = Math.round(Math.max(8, size * 0.1))
  const iconSize = Math.round(Math.min(labels ? 34 : 44, size * (labels ? 0.28 : 0.36)))
  return (
    <span
      className="key-face"
      data-wide={wide || undefined}
      style={{
        padding: wide ? `0 ${corner * 2}px` : corner,
        gap: Math.round(size * (wide ? 0.2 : 0.07)),
      }}
    >
      {folder ? (
        count !== undefined && (
          <span className="key-count" style={{ top: corner, right: corner }} aria-hidden>
            {count}
          </span>
        )
      ) : (
        <span className="key-light" style={{ top: corner, right: corner }} aria-hidden />
      )}
      {icon && <TileIcon icon={icon} size={iconSize} className="key-icon" />}
      {(labels || !icon) && (
        <span className="key-label" style={{ fontSize: font }}>
          {look.label}
        </span>
      )}
    </span>
  )
}
