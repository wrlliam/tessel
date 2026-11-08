import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createAudioOutputPlugin, parseWindows } from '../src/plugin.ts'

describe('Audio output plugin', () => {
  it('reads the Windows helper’s list', () => {
    expect(parseWindows('*Speakers (Realtek)\t{a}\n Headphones (USB)\t{b}\n')).toEqual([
      { name: 'Speakers (Realtek)', id: '{a}', current: true },
      { name: 'Headphones (USB)', id: '{b}', current: false },
    ])
  })

  it('switches between two outputs on macOS', async () => {
    let current = 'MacBook Speakers'
    const run = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('-a')) return 'MacBook Speakers\nAirPods Pro\n'
      if (args.includes('-c')) return `${current}\n`
      current = args[1] ?? current
      return ''
    })
    const h = createHarness(createAudioOutputPlugin(run, () => 'darwin'))
    expect(await h.run('use', { output: 'speakers', other: 'airpods' })).toEqual({
      values: { name: 'AirPods Pro' },
    })
    expect(await h.run('use', { output: 'speakers', other: 'airpods' })).toEqual({
      values: { name: 'MacBook Speakers' },
    })
  })

  it('uses Core Audio through PowerShell on Windows', async () => {
    const run = vi.fn(async (_cmd: string, args: string[]) =>
      args.at(-1)?.includes('::List()') ? '*Speakers\t{s}\n Headset\t{h}\n' : '',
    )
    const h = createHarness(createAudioOutputPlugin(run, () => 'win32'))
    await h.run('use', { output: 'headset', other: '' })
    expect(String(run.mock.calls.at(-1)?.[1].at(-1))).toContain("::Use('{h}')")
  })

  it('explains the missing macOS helper', async () => {
    const h = createHarness(
      createAudioOutputPlugin(
        async () => {
          throw new Error('ENOENT spawn SwitchAudioSource')
        },
        () => 'darwin',
      ),
    )
    await expect(h.run('current', {})).rejects.toThrow(/brew install switchaudio-osx/)
  })
})
