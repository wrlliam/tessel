import type { Tile, TileDisplay } from './model.ts'
import { renderTemplate, toText } from './engine/expression.ts'
import type { AppearanceChange } from './engine/block.ts'

export interface Appearance {
  label: string
  colour: string
  /** Empty for no icon. */
  icon: string
  /** A small picture shown instead of the icon (a data: URL); empty for none. */
  image: string
  /** Tiles with a display: the number now, its zone colour and how it reads. */
  meter?: Meter
}

export interface Meter {
  /** Null when the value isn't a number yet. */
  value: number | null
  colour: string
  text: string
}

/** The zone colour for a value: the last zone it reaches, else the tile's own colour. */
export function zoneColour(display: TileDisplay, value: number | null, fallback: string): string {
  let colour = fallback
  if (value === null) return colour
  for (const z of [...display.zones].sort((a, b) => a.from - b.from))
    if (value >= z.from) colour = z.colour
  return colour
}

export function formatReading(display: TileDisplay, value: number | null): string {
  if (value === null) return '–'
  return `${value.toFixed(display.decimals)}${display.unit}`
}

/** Works out the number a display shows. */
export function resolveMeter(
  tile: Tile,
  scope: Record<string, unknown>,
  colour: string,
): Meter | undefined {
  const d = tile.display
  if (!d) return undefined
  let value: number | null
  try {
    const raw = toText(renderTemplate(d.value, scope)).trim()
    const n = raw === '' ? NaN : Number(raw)
    value = Number.isFinite(n) ? n : null
  } catch {
    value = null
  }
  return { value, colour: zoneColour(d, value, colour), text: formatReading(d, value) }
}

/** Where a value sits between min and max, 0 to 1. */
export function meterFraction(display: Pick<TileDisplay, 'min' | 'max'>, value: number | null) {
  if (value === null || display.max === display.min) return 0
  return Math.min(1, Math.max(0, (value - display.min) / (display.max - display.min)))
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Layers a change from Set tile appearance on top of what is already showing. */
export function applyChange(
  current: Partial<Appearance> | undefined,
  change: AppearanceChange,
): Partial<Appearance> | undefined {
  if (change === 'reset') return undefined
  return { ...current, ...change }
}

/**
 * What a tile shows right now: its own look, then appearance bindings, then any change a
 * block made at run time. A binding that fails or yields a bad colour is skipped.
 */
export function resolveAppearance(
  tile: Tile,
  scope: Record<string, unknown>,
  override?: Partial<Appearance>,
): Appearance {
  const out: Appearance = {
    label: tile.label,
    colour: tile.colour,
    icon: tile.icon ?? '',
    image: tile.image ?? '',
  }
  for (const binding of tile.appearanceBindings) {
    let value: string
    try {
      value = toText(renderTemplate(binding.expression, scope)).trim()
    } catch {
      continue
    }
    if (binding.field === 'colour' && !HEX.test(value)) continue
    if (binding.field === 'label') value = value.slice(0, 40)
    out[binding.field] = value
  }
  if (override?.label !== undefined) out.label = override.label
  if (override?.colour !== undefined && HEX.test(override.colour)) out.colour = override.colour
  if (override?.icon !== undefined) out.icon = override.icon
  if (override?.image !== undefined && (override.image === '' || isImageData(override.image)))
    out.image = override.image
  const meter = resolveMeter(tile, scope, out.colour)
  if (meter) out.meter = meter
  return out
}

export const sameAppearance = (a: Appearance, b: Appearance) =>
  a.label === b.label &&
  a.colour === b.colour &&
  a.icon === b.icon &&
  a.image === b.image &&
  a.meter?.value === b.meter?.value &&
  a.meter?.colour === b.meter?.colour

/** Tile pictures travel as small data: URLs, so phones need no internet and nothing is fetched. */
export const isImageData = (s: string) =>
  s.length <= MAX_IMAGE_CHARS && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)

/** About 200 KB of picture. */
export const MAX_IMAGE_CHARS = 280_000
