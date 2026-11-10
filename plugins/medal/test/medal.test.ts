import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createMedalPlugin, type SavedFile } from '../src/plugin.ts'

describe('Medal plugin', () => {
  it('says saved only once the clip lands in the library', async () => {
    const files: SavedFile[] = [{ path: 'old.mp4', name: 'old.mp4', mtime: 1 }]
    const h = createHarness(
      createMedalPlugin(
        async () => [...files],
        () => ['C:/m'],
      ),
      { settings: { clipKey: 'f8', waitSeconds: 5 } },
    )
    await h.load()
    setTimeout(() => files.push({ path: 'new.mp4', name: 'Clip 2.mp4', mtime: 2 }), 700)
    expect(await h.run('clip', {})).toEqual({
      next: 'saved',
      values: { name: 'Clip 2.mp4', path: 'new.mp4', problem: '' },
    })
  })

  it("explains when Medal saves nothing, or the library can't be found", async () => {
    const h = createHarness(
      createMedalPlugin(
        async () => [],
        () => ['C:/m'],
      ),
      {
        settings: { clipKey: 'f8', waitSeconds: 3 },
      },
    )
    await h.load()
    const r = await h.run('clip', {})
    expect(r.next).toBe('nothing')
    expect(String(r.values?.['problem'])).toMatch(/hotkey/)
    const lost = createHarness(
      createMedalPlugin(
        async () => {
          throw new Error('ENOENT')
        },
        () => ['C:/nope'],
      ),
    )
    await lost.load()
    const r2 = await lost.run('clip', {})
    expect(String(r2.values?.['problem'])).toMatch(/Can't find your Medal library/)
    expect(lost.keys).toEqual([])
  })

  it("presses Medal's hotkeys from settings", async () => {
    const h = createHarness(
      createMedalPlugin(
        async () => [],
        () => ['C:/m'],
      ),
      {
        settings: { clipKey: 'alt+f10', screenshotKey: '', waitSeconds: 3 },
      },
    )
    await h.load()
    const r = await h.run('clip', {})
    expect(h.keys).toEqual(['alt+f10'])
    expect(r.next).toBe('nothing')
    await expect(h.run('screenshot', {})).rejects.toThrow(/Set Medal's screenshot hotkey/)
  })

  it('tracks recording on and off', async () => {
    const h = createHarness(
      createMedalPlugin(
        async () => [],
        () => [],
      ),
      { settings: { recordKey: 'f9' } },
    )
    await h.load()
    expect(await h.run('record', {})).toEqual({ next: 'started' })
    expect(await h.run('record', {})).toEqual({ next: 'stopped' })
    expect(h.tileState.get('recording')).toBe(false)
  })

  it('finds the newest clip', async () => {
    const files: SavedFile[] = [
      { path: 'C:/m/a.mp4', name: 'a.mp4', mtime: 1000 },
      { path: 'C:/m/b.mp4', name: 'b.mp4', mtime: 61_000 },
      { path: 'C:/m/notes.txt', name: 'notes.txt', mtime: 99_000 },
    ]
    const h = createHarness(
      createMedalPlugin(
        async () => files,
        () => ['C:/m'],
        () => 121_000,
      ),
    )
    await h.load()
    expect(await h.run('latest', {})).toEqual({
      values: { name: 'b.mp4', path: 'C:/m/b.mp4', minutesAgo: 1 },
    })
  })

  it('fires once for each new clip, not for old ones', async () => {
    vi.useFakeTimers()
    let t = 10_000
    const files: SavedFile[] = [{ path: 'old.mp4', name: 'old.mp4', mtime: 5000 }]
    const h = createHarness(
      createMedalPlugin(
        async () => [...files],
        () => ['C:/m'],
        () => t,
      ),
    )
    await h.load()
    const sub = h.subscribe('saved', { what: 'clips' })
    await vi.advanceTimersByTimeAsync(10)
    t = 20_000
    files.push({ path: 'new.mp4', name: 'Clip 1.mp4', mtime: 19_000 })
    files.push({ path: 'shot.png', name: 'shot.png', mtime: 19_500 })
    await vi.advanceTimersByTimeAsync(3100)
    await vi.advanceTimersByTimeAsync(3100)
    expect(sub.events).toEqual([{ name: 'Clip 1.mp4', path: 'new.mp4', kind: 'clip' }])
    sub.stop()
    vi.useRealTimers()
  })
})
