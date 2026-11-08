import { describe, expect, it } from 'vitest'
import { isRunning, normalise, parseMac, parseTasklist } from '../src/main/platform/running.ts'

describe('running apps', () => {
  it('reads app bundles from macOS process paths', () => {
    const ps = [
      '/Applications/Spotify.app/Contents/MacOS/Spotify',
      '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
      '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper',
      '/usr/libexec/logd',
    ].join('\n')
    expect(parseMac(ps)).toEqual(['spotify', 'visualstudiocode', 'codehelper'])
  })

  it('reads Windows tasklist output', () => {
    expect(
      parseTasklist(
        '"Discord.exe","1","Console","1","90,000 K"\r\n"Code.exe","2","Console","1","1 K"',
      ),
    ).toEqual(['discord', 'code'])
  })

  it('matches names, paths and close variants', () => {
    const running = ['spotify', 'zoomus', 'code']
    expect(isRunning('Spotify', running)).toBe(true)
    expect(isRunning('/Applications/zoom.us.app', running)).toBe(true)
    expect(isRunning('Visual Studio Code', running)).toBe(true)
    expect(isRunning('Discord', running)).toBe(false)
    expect(normalise('Visual Studio Code.app')).toBe('visualstudiocode')
  })
})
