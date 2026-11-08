import { KEY_NAMES } from '@tessel/core'
import { describe, expect, it, vi } from 'vitest'
import { ExecError, type Run } from '../src/main/platform/exec.ts'
import { comboCodes, createYdotoolInput, EVDEV, keyArgs } from '../src/main/platform/ydotool.ts'

function make(run: Run = vi.fn<Run>(async () => ({ stdout: '', stderr: '' }))) {
  const clipboard = {
    content: 'old',
    save: vi.fn(async () => clipboard.content),
    restore: vi.fn(async (v: string) => void (clipboard.content = v)),
    writeText: vi.fn(async (t: string) => void (clipboard.content = t)),
  }
  return { run, clipboard, input: createYdotoolInput({ run, clipboard, sleep: async () => {} }) }
}

describe('ydotool input', () => {
  it('has a Linux key code for every key Tessel accepts', () => {
    for (const name of KEY_NAMES) expect(EVDEV[name], name).toBeTypeOf('number')
  })

  it('presses modifiers first and releases them last', () => {
    expect(keyArgs(comboCodes({ modifiers: ['ctrl', 'shift'], key: 't' }))).toEqual([
      '29:1',
      '42:1',
      '20:1',
      '20:0',
      '42:0',
      '29:0',
    ])
  })

  it('types ASCII directly and pastes the rest, restoring the clipboard', async () => {
    const { input, run, clipboard } = make()
    await input.typeText('hi there')
    await input.typeText('héllo')
    expect(run).toHaveBeenNthCalledWith(1, 'ydotool', ['type', '--', 'hi there'])
    expect(run).toHaveBeenNthCalledWith(2, 'ydotool', ['key', '29:1', '47:1', '47:0', '29:0'])
    expect(clipboard.content).toBe('old')
  })

  it('sends media keys and mouse actions', async () => {
    const { input, run } = make()
    await input.mediaKey('playPause')
    await input.mouse({ kind: 'move', x: 5, y: 9 })
    await input.mouse({ kind: 'doubleClick' })
    expect(vi.mocked(run).mock.calls.map((c) => c[1])).toEqual([
      ['key', '164:1', '164:0'],
      ['mousemove', '--absolute', '-x', '5', '-y', '9'],
      ['click', '--repeat', '2', '0xC0'],
    ])
  })

  it('explains a missing ydotool', async () => {
    const { input } = make(vi.fn<Run>(async () => Promise.reject(new ExecError('x', 'ENOENT', ''))))
    await expect(input.pressCombo({ modifiers: [], key: 'f5' })).rejects.toThrow(
      /sudo apt install ydotool/,
    )
  })
})
