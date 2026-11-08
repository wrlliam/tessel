import { describe, expect, it } from 'vitest'
import { parseDarwin, parseLinux, parseWin32 } from '../src/main/platform/now-playing.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('album art', () => {
  it('comes from Spotify’s artwork link and Apple Music’s saved file', () => {
    expect(
      parseDarwin('Spotify\tSong\tBand\tAlbum\t200\t30\tplaying\thttps://i.scdn.co/image/abc')
        ?.artwork,
    ).toBe('https://i.scdn.co/image/abc')
    expect(
      parseDarwin('Music\tSong\tBand\tAlbum\t200\t30\tplaying\tfile:///tmp/tessel-art-1')?.artwork,
    ).toBe('file:///tmp/tessel-art-1')
    expect(parseDarwin('Music\tSong\tBand\tAlbum\t200\t30\tplaying\t')?.artwork).toBeUndefined()
  })

  it('comes from MPRIS on Linux and the media session on Windows', () => {
    expect(
      parseLinux('spotify\tSong\tBand\tAlbum\t2e8\t3e7\tPlaying\thttps://i.scdn.co/x')?.artwork,
    ).toBe('https://i.scdn.co/x')
    expect(
      parseWin32(JSON.stringify({ title: 'Song', artist: 'Band', playing: true, artwork: PNG }))
        ?.artwork,
    ).toBe(PNG)
  })
})
