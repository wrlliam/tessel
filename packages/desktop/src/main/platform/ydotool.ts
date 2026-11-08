import {
  UserFacingError,
  type KeyCombo,
  type MediaKey,
  type Modifier,
  type MouseAction,
} from '@tessel/core'
import { isMissingProgram, type Run } from './exec.ts'
import type { ClipboardAccess } from './input.ts'

/** Linux input event codes (linux/input-event-codes.h) for the keys Tessel knows. */
export const EVDEV: Record<string, number> = {
  escape: 1,
  minus: 12,
  equal: 13,
  backspace: 14,
  tab: 15,
  bracketleft: 26,
  bracketright: 27,
  enter: 28,
  semicolon: 39,
  quote: 40,
  grave: 41,
  backslash: 43,
  comma: 51,
  period: 52,
  slash: 53,
  space: 57,
  capslock: 58,
  printscreen: 99,
  home: 102,
  up: 103,
  pageup: 104,
  left: 105,
  right: 106,
  end: 107,
  down: 108,
  pagedown: 109,
  insert: 110,
  delete: 111,
  q: 16,
  w: 17,
  e: 18,
  r: 19,
  t: 20,
  y: 21,
  u: 22,
  i: 23,
  o: 24,
  p: 25,
  a: 30,
  s: 31,
  d: 32,
  f: 33,
  g: 34,
  h: 35,
  j: 36,
  k: 37,
  l: 38,
  z: 44,
  x: 45,
  c: 46,
  v: 47,
  b: 48,
  n: 49,
  m: 50,
  '1': 2,
  '2': 3,
  '3': 4,
  '4': 5,
  '5': 6,
  '6': 7,
  '7': 8,
  '8': 9,
  '9': 10,
  '0': 11,
  f1: 59,
  f2: 60,
  f3: 61,
  f4: 62,
  f5: 63,
  f6: 64,
  f7: 65,
  f8: 66,
  f9: 67,
  f10: 68,
  f11: 87,
  f12: 88,
  f13: 183,
  f14: 184,
  f15: 185,
  f16: 186,
  f17: 187,
  f18: 188,
  f19: 189,
  f20: 190,
  f21: 191,
  f22: 192,
  f23: 193,
  f24: 194,
}

const MODIFIER: Record<Modifier, number> = { ctrl: 29, shift: 42, alt: 56, meta: 125 }
const MEDIA: Record<MediaKey, number> = {
  mute: 113,
  volumeDown: 114,
  volumeUp: 115,
  next: 163,
  playPause: 164,
  previous: 165,
  stop: 166,
}
// ydotool click codes: 0xC0 left, 0xC1 right, 0xC2 middle (press and release).
const BUTTON = { left: '0xC0', right: '0xC1', middle: '0xC2' }

const TYPEABLE = /^[\x20-\x7E\n\t]*$/

/** Down events in order, then up events in reverse: `29:1 46:1 46:0 29:0`. */
export const keyArgs = (codes: number[]) => [
  ...codes.map((c) => `${c}:1`),
  ...[...codes].reverse().map((c) => `${c}:0`),
]

export function comboCodes(combo: KeyCombo): number[] {
  const key = EVDEV[combo.key]
  if (key === undefined) throw new Error(`No key code for "${combo.key}"`)
  return [...combo.modifiers.map((m) => MODIFIER[m]), key]
}

/** Keys and mouse through ydotool, for Wayland sessions where nut-js can't send input. */
export function createYdotoolInput<T>(deps: {
  run: Run
  clipboard: ClipboardAccess<T>
  sleep?: (ms: number) => Promise<void>
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function ydotool(args: string[]) {
    try {
      await deps.run('ydotool', args)
    } catch (err) {
      if (isMissingProgram(err)) {
        throw new UserFacingError(
          'On Wayland, Tessel types and clicks with ydotool. Install it (for example: sudo apt install ydotool) and start the ydotoold service.',
        )
      }
      throw new UserFacingError(
        `ydotool couldn't send input. Is the ydotoold service running? (${(err as Error).message})`,
      )
    }
  }

  return {
    async typeText(text: string) {
      if (text === '') return
      if (TYPEABLE.test(text)) return ydotool(['type', '--', text])
      const saved = await deps.clipboard.save()
      try {
        await deps.clipboard.writeText(text)
        await ydotool(['key', ...keyArgs([MODIFIER.ctrl, EVDEV['v'] as number])])
        await sleep(200)
      } finally {
        await deps.clipboard.restore(saved)
      }
    },
    pressCombo: (combo: KeyCombo) => ydotool(['key', ...keyArgs(comboCodes(combo))]),
    mediaKey: (key: MediaKey) => ydotool(['key', ...keyArgs([MEDIA[key]])]),
    mouse(action: MouseAction) {
      switch (action.kind) {
        case 'move':
          return ydotool([
            'mousemove',
            '--absolute',
            '-x',
            String(action.x),
            '-y',
            String(action.y),
          ])
        case 'click':
          return ydotool(['click', BUTTON.left])
        case 'doubleClick':
          return ydotool(['click', '--repeat', '2', BUTTON.left])
        case 'rightClick':
          return ydotool(['click', BUTTON.right])
        case 'middleClick':
          return ydotool(['click', BUTTON.middle])
      }
    },
  }
}
