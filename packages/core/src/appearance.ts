import type { Tile } from './model.ts'
import { renderTemplate, toText } from './engine/expression.ts'
import type { AppearanceChange } from './engine/block.ts'

export interface Appearance {
  label: string
  colour: string
  /** Empty for no icon. */
  icon: string
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
  const out: Appearance = { label: tile.label, colour: tile.colour, icon: tile.icon ?? '' }
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
  return out
}

export const sameAppearance = (a: Appearance, b: Appearance) =>
  a.label === b.label && a.colour === b.colour && a.icon === b.icon
