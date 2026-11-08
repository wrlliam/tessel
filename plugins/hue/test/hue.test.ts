import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createHuePlugin } from '../src/plugin.ts'

const json = (b: unknown) => new Response(JSON.stringify(b))

describe('Hue plugin', () => {
  it('connects after the button press and keeps the key', async () => {
    const fetchFn = vi.fn(async () => json([{ success: { username: 'k1' } }]))
    const h = createHarness(createHuePlugin(fetchFn), { settings: { bridge: '10.0.0.2' } })
    await h.load()
    expect(await h.run('connect', {})).toEqual({ values: { appKey: 'k1' } })
    expect(h.storage.get('appKey')).toBe('k1')
  })

  it('asks for the button press when the bridge says so', async () => {
    const h = createHarness(
      createHuePlugin(async () =>
        json([{ error: { type: 101, description: 'link button not pressed' } }]),
      ),
      { settings: { bridge: '10.0.0.2' } },
    )
    await h.load()
    await expect(h.run('connect', {})).rejects.toThrow(/Press the button/)
  })

  it('toggles a light found by name', async () => {
    const calls: Array<[string, string | undefined]> = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init?.body as string | undefined])
      if (url.endsWith('/lights')) return json({ '3': { name: 'Desk lamp' } })
      if (url.endsWith('/lights/3')) return json({ state: { on: false } })
      return json([{ success: {} }])
    })
    const h = createHarness(createHuePlugin(fetchFn), {
      settings: { bridge: '10.0.0.2', appKey: 'k' },
    })
    await h.load()
    expect(await h.run('light', { target: 'light', name: 'desk lamp', action: 'toggle' })).toEqual({
      next: 'on',
    })
    expect(calls.at(-1)).toEqual(['http://10.0.0.2/api/k/lights/3/state', '{"on":true}'])
  })

  it('maps 0-100 brightness onto Hue’s scale', async () => {
    const fetchFn = vi.fn(async () => json([{ success: {} }]))
    const h = createHarness(createHuePlugin(fetchFn), {
      settings: { bridge: '10.0.0.2', appKey: 'k' },
    })
    await h.load()
    await h.run('brightness', { target: 'room', name: '2', level: 100 })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://10.0.0.2/api/k/groups/2/action')
    expect(JSON.parse(String(init.body))).toEqual({ on: true, bri: 254 })
  })
})
