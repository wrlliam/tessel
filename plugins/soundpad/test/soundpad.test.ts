import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createSoundpadPlugin, findSound, parseSoundList } from '../src/plugin.ts'

const XML =
  '<Soundlist><Sound index="1" url="a.mp3" title="Air horn"/><Sound index="2" url="b.mp3" title="Sad &amp; trombone"/></Soundlist>'

describe('soundpad plugin', () => {
  it('reads the sound list and finds sounds by number or name', () => {
    const list = parseSoundList(XML)
    expect(list).toEqual([
      { index: 1, title: 'Air horn' },
      { index: 2, title: 'Sad & trombone' },
    ])
    expect(findSound(list, '2')?.index).toBe(2)
    expect(findSound(list, 'trombone')?.index).toBe(2)
    expect(findSound(list, 'nope')).toBeUndefined()
  })

  it('plays a sound by name on speakers only', async () => {
    const send = vi.fn(async (cmd: string) => (cmd.startsWith('GetSoundlist') ? XML : 'R-200'))
    const h = createHarness(createSoundpadPlugin(send))
    expect(await h.run('play', { sound: 'horn', where: 'speakers' })).toEqual({
      values: { title: 'Air horn' },
    })
    expect(send).toHaveBeenLastCalledWith('DoPlaySound(1, true, false)')
  })

  it('sends control, random and volume commands', async () => {
    const send = vi.fn(async () => 'R-200')
    const h = createHarness(createSoundpadPlugin(send))
    await h.run('control', { action: 'pause' })
    await h.run('random', { category: 'Memes' })
    await h.run('volume', { level: 42.4 })
    expect(send.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      'DoTogglePause()',
      'DoPlayRandomSoundFromCategory("Memes", true, true)',
      'SetVolume(42)',
    ])
  })

  it('explains when Soundpad is not running', async () => {
    const h = createHarness(
      createSoundpadPlugin(async () => {
        throw new Error('ENOENT')
      }),
    )
    await expect(h.run('control', { action: 'stop' })).rejects.toThrow(/Start Soundpad/)
  })
})
