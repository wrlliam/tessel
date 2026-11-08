import { type KeyCombo, type Modifier, type OS } from '@tessel/core'

/** The slice of nut-js Tessel uses, so tests can swap in a fake. */
export interface Nut {
  keyboard: {
    config: { autoDelayMs: number }
    type(...input: string[]): Promise<unknown>
    pressKey(...keys: number[]): Promise<unknown>
    releaseKey(...keys: number[]): Promise<unknown>
  }
  Key: Record<string, number>
}

export interface ClipboardAccess<T> {
  save(): Promise<T>
  restore(saved: T): Promise<void>
  writeText(text: string): Promise<void>
}

export interface InputDeps<T> {
  os: OS
  loadNut: () => Promise<Nut>
  clipboard: ClipboardAccess<T>
  /** Throws a plain-language error when the OS won't let Tessel send keys. */
  ensureAllowed: () => void
  sleep?: (ms: number) => Promise<void>
}

const NAMED: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  minus: 'Minus',
  equal: 'Equal',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
  backslash: 'Backslash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  grave: 'Grave',
  bracketleft: 'LeftBracket',
  bracketright: 'RightBracket',
  capslock: 'CapsLock',
  printscreen: 'Print',
}

export function nutKeyName(key: string): string {
  if (/^[a-z]$/.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return `Num${key}`
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase()
  const name = NAMED[key]
  if (!name) throw new Error(`No key mapping for "${key}"`)
  return name
}

export function nutModifierName(mod: Modifier, os: OS): string {
  switch (mod) {
    case 'ctrl':
      return 'LeftControl'
    case 'alt':
      return 'LeftAlt'
    case 'shift':
      return 'LeftShift'
    case 'meta':
      return os === 'darwin' ? 'LeftCmd' : 'LeftSuper'
  }
}

// keyboard.type is reliable for plain ASCII; anything else goes through the clipboard.
const TYPEABLE = /^[\x20-\x7E\n\t]*$/
const PASTE_SETTLE_MS = 200

export function createInput<T>(deps: InputDeps<T>) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let nut: Promise<Nut> | undefined

  async function keyboard() {
    deps.ensureAllowed()
    nut ??= deps.loadNut().then((n) => {
      n.keyboard.config.autoDelayMs = 2
      return n
    })
    return nut
  }

  async function press(n: Nut, combo: KeyCombo) {
    const keys = [
      ...combo.modifiers.map((m) => nutModifierName(m, deps.os)),
      nutKeyName(combo.key),
    ].map((name) => {
      const code = n.Key[name]
      if (code === undefined) throw new Error(`Key "${name}" is missing from nut-js`)
      return code
    })
    await n.keyboard.pressKey(...keys)
    await n.keyboard.releaseKey(...keys.reverse())
  }

  return {
    async typeText(text: string) {
      if (text === '') return
      const n = await keyboard()
      if (TYPEABLE.test(text)) {
        await n.keyboard.type(text)
        return
      }
      const saved = await deps.clipboard.save()
      try {
        await deps.clipboard.writeText(text)
        await press(n, { modifiers: [deps.os === 'darwin' ? 'meta' : 'ctrl'], key: 'v' })
        // The target app reads the clipboard asynchronously; restoring too soon pastes the old content.
        await sleep(PASTE_SETTLE_MS)
      } finally {
        await deps.clipboard.restore(saved)
      }
    },

    async pressCombo(combo: KeyCombo) {
      await press(await keyboard(), combo)
    },
  }
}
