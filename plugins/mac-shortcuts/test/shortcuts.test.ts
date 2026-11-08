import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createShortcutsPlugin } from '../src/plugin.ts'

function files() {
  const store = { input: '', output: '', done: false }
  return {
    store,
    files: {
      temp: async () => ({
        input: '/t/in.txt',
        output: '/t/out.txt',
        read: async () => store.output,
        write: async (t: string) => void (store.input = t),
        done: async () => void (store.done = true),
      }),
    },
  }
}

describe('Shortcuts plugin', () => {
  it('runs a shortcut with text in and out, and cleans up', async () => {
    const f = files()
    const run = vi.fn(async () => {
      f.store.output = 'Hello back\n'
      return ''
    })
    const h = createHarness(createShortcutsPlugin(run, f.files), { os: 'darwin' })
    expect(await h.run('run', { name: 'Echo' }, { input: 'hi' })).toEqual({
      values: { output: 'Hello back' },
    })
    expect(run).toHaveBeenCalledWith([
      'run',
      'Echo',
      '--output-path',
      '/t/out.txt',
      '--input-path',
      '/t/in.txt',
    ])
    expect(f.store.input).toBe('hi')
    expect(f.store.done).toBe(true)
  })

  it('says when there is no such shortcut', async () => {
    const f = files()
    const h = createHarness(
      createShortcutsPlugin(async () => {
        throw new Error("Error: Couldn't find shortcut")
      }, f.files),
    )
    await expect(h.run('run', { name: 'Nope' })).rejects.toThrow(/no shortcut called "Nope"/)
    expect(f.store.done).toBe(true)
  })
})
