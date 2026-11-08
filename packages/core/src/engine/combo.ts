import type { KeyCombo, Modifier, OS } from './platform.ts'

const MODIFIERS: Record<string, Modifier | 'mod'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  // Cmd on macOS, Ctrl elsewhere, so one tile works on every computer.
  mod: 'mod',
}

const ALIASES: Record<string, string> = {
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  backtick: 'grave',
  '`': 'grave',
  '-': 'minus',
  '=': 'equal',
  ',': 'comma',
  '.': 'period',
  '/': 'slash',
  '\\': 'backslash',
  ';': 'semicolon',
  "'": 'quote',
  '[': 'bracketleft',
  ']': 'bracketright',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  pgup: 'pageup',
  pgdn: 'pagedown',
}

export const KEY_NAMES = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
  'enter',
  'escape',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'minus',
  'equal',
  'comma',
  'period',
  'slash',
  'backslash',
  'semicolon',
  'quote',
  'grave',
  'bracketleft',
  'bracketright',
  'capslock',
  'printscreen',
])

export type ParsedCombo = { modifiers: Array<Modifier | 'mod'>; key: string }

/** Parses 'Cmd+Shift+4' or 'mod+s'. Throws with a readable message. */
export function parseCombo(input: string): ParsedCombo {
  const tokens = input
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (tokens.length === 0) throw new Error('Enter a shortcut, e.g. Cmd+Shift+4')

  const modifiers: Array<Modifier | 'mod'> = []
  let key: string | undefined
  for (const token of tokens) {
    const mod = MODIFIERS[token]
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod)
      continue
    }
    const name = ALIASES[token] ?? token
    if (!KEY_NAMES.has(name)) throw new Error(`"${token}" isn't a key Tessel knows`)
    if (key) throw new Error('A shortcut can only have one non-modifier key')
    key = name
  }
  if (!key) throw new Error('Add a key after the modifiers, e.g. Ctrl+C')
  return { modifiers, key }
}

/** Swaps 'mod' for the platform's main modifier. */
export function resolveCombo(combo: ParsedCombo, os: OS): KeyCombo {
  const modifiers = combo.modifiers.map((m): Modifier =>
    m === 'mod' ? (os === 'darwin' ? 'meta' : 'ctrl') : m,
  )
  return { modifiers: [...new Set(modifiers)], key: combo.key }
}
