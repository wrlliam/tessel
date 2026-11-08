import type { Category, ValueType } from '@tessel/core'

export const CATEGORY: Record<Category, { colour: string; label: string }> = {
  trigger: { colour: '#F5B63D', label: 'Triggers' },
  action: { colour: '#22D3C5', label: 'Actions' },
  logic: { colour: '#8B7CF6', label: 'Logic' },
  data: { colour: '#4FA3F7', label: 'Data' },
  plugin: { colour: '#FF7A59', label: 'Plugins' },
}

export const CATEGORY_ORDER: Category[] = ['trigger', 'action', 'logic', 'data', 'plugin']

export const VALUE_COLOUR: Record<ValueType, string> = {
  number: '#4FA3F7',
  string: '#22D3C5',
  boolean: '#8B7CF6',
  any: '#A9B4C2',
}

export const TILE_COLOURS = [
  '#22D3C5',
  '#4FA3F7',
  '#8B7CF6',
  '#F5B63D',
  '#FF7A59',
  '#F25C6E',
  '#212833',
  '#161B22',
  '#F4F6F8',
]
