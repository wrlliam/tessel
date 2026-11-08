import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createKeyLightPlugin, kelvinToMired } from '../src/plugin.ts'

describe('Key Light plugin', () => {
  it('toggles every light from the first one’s state', async () => {
    const puts: Array<[string, unknown]> = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push([url, JSON.parse(String(init.body))])
      return new Response(
        JSON.stringify({
          numberOfLights: 1,
          lights: [{ on: 0, brightness: 20, temperature: 200 }],
        }),
      )
    })
    const h = createHarness(createKeyLightPlugin(fetchFn), {
      settings: { lights: '10.0.0.5, 10.0.0.6' },
    })
    await h.load()
    expect(await h.run('power', { light: 'all', action: 'toggle' })).toEqual({ next: 'on' })
    expect(puts.map((p) => p[0])).toEqual([
      'http://10.0.0.5:9123/elgato/lights',
      'http://10.0.0.6:9123/elgato/lights',
    ])
    expect(puts[0]?.[1]).toEqual({ numberOfLights: 1, lights: [{ on: 1 }] })
  })

  it('sets brightness and warmth on one light', async () => {
    const fetchFn = vi.fn(async () => new Response('{}'))
    const h = createHarness(createKeyLightPlugin(fetchFn), {
      settings: { lights: '10.0.0.5,10.0.0.6' },
    })
    await h.load()
    await h.run('set', { light: '2', level: 40, kelvin: 5000 })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://10.0.0.6:9123/elgato/lights')
    expect(JSON.parse(String(init.body)).lights[0]).toEqual({
      on: 1,
      brightness: 40,
      temperature: 200,
    })
    expect(kelvinToMired(2900)).toBe(344)
    expect(kelvinToMired(9000)).toBe(143)
  })

  it('asks for addresses first', async () => {
    const h = createHarness(createKeyLightPlugin(vi.fn()))
    await h.load()
    await expect(h.run('power', { light: 'all', action: 'on' })).rejects.toThrow(/addresses/)
  })
})
