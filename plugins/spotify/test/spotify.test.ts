import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createSpotifyPlugin, toUri } from '../src/plugin.ts'

describe('Spotify plugin', () => {
  it('turns share links into Spotify URIs', () => {
    expect(toUri('https://open.spotify.com/playlist/37i9dQZF1DX?si=abc')).toBe(
      'spotify:playlist:37i9dQZF1DX',
    )
    expect(toUri('https://open.spotify.com/intl-de/album/1A2b')).toBe('spotify:album:1A2b')
    expect(() => toUri('https://example.com')).toThrow(/Spotify link/)
  })

  it('plays on macOS with AppleScript and opens the link elsewhere', async () => {
    const run = vi.fn(async (_cmd: string, _args: string[]) => '')
    const mac = createHarness(createSpotifyPlugin(run, () => 'darwin'))
    await mac.run('play', { link: 'spotify:album:x1' })
    expect(run.mock.calls[0]?.[1]).toEqual([
      '-e',
      'tell application "Spotify"\nplay track "spotify:album:x1"\nend tell',
    ])
    const win = createHarness(createSpotifyPlugin(run, () => 'win32'))
    await win.run('play', { link: 'spotify:album:x1' })
    expect(run.mock.calls[1]).toEqual(['cmd.exe', ['/c', 'start', '', 'spotify:album:x1']])
  })

  it('flips shuffle and reports the new state', async () => {
    const h = createHarness(
      createSpotifyPlugin(
        async () => 'true\n',
        () => 'darwin',
      ),
    )
    expect(await h.run('shuffle', { what: 'shuffling', action: 'toggle' })).toEqual({ next: 'on' })
    expect(h.tileState.get('shuffle')).toBe(true)
  })
})
