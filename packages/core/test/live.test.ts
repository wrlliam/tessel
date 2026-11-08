import { describe, expect, it, vi } from 'vitest'
import { describeWeather, formatDuration, slideValue, type Graph } from '../src/index.ts'
import { mockPlatform, node, press, setup, tile, wire } from './helpers.ts'

/** press -> block -> Set variable `out` from the block's `port`. */
const capture = (n: ReturnType<typeof node>, port: string, flow = 'out'): Graph => ({
  nodes: [node('p', 'trigger.press'), n, node('s', 'data.setVariable', { name: 'out' })],
  edges: [
    wire('p.out', `${n.id}.in`),
    wire(`${n.id}.${flow}`, 's.in'),
    wire(`${n.id}.${port}`, 's.value'),
  ],
})

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(-3)).toBe('0:00')
  })

  it('maps slider positions onto a range with steps', () => {
    expect(slideValue(50, { min: 0, max: 100, step: 1 })).toBe(50)
    expect(slideValue(50, { min: -60, max: 12, step: 0.5 })).toBe(-24)
    expect(slideValue(33, { min: 0, max: 10, step: 5 })).toBe(5)
    expect(slideValue(150, { min: 0, max: 10, step: 1 })).toBe(10)
  })

  it('describes weather codes', () => {
    expect(describeWeather(0)).toEqual({ text: 'Clear', icon: 'sun' })
    expect(describeWeather(0, false).icon).toBe('moon')
    expect(describeWeather(63).text).toBe('Rain')
    expect(describeWeather(95).icon).toBe('cloud-lightning')
  })
})

describe('On slide', () => {
  it('passes the mapped value on', async () => {
    const { engine, globals } = setup()
    const graph: Graph = {
      nodes: [
        node('t', 'trigger.slide', { min: 0, max: 200, step: 10 }),
        node('s', 'data.setVariable', { name: 'out' }),
      ],
      edges: [wire('t.out', 's.in'), wire('t.value', 's.value')],
    }
    await engine.trigger(tile(graph), { type: 'slide', data: { value: 26 } })
    expect(globals.get('out')).toBe(50)
  })
})

describe('Countdown', () => {
  it('keeps the time left in tile state and clears it when done', async () => {
    const state = new Map<string, unknown>()
    const seen: unknown[] = []
    const { engine } = setup({
      timeoutMs: 50,
      tileState: {
        get: (_t, k) => state.get(k),
        set: (_t, k, v) => {
          state.set(k, v)
          if (k === 'left') seen.push(v)
        },
      },
    })
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('c', 'logic.countdown', { seconds: 2, key: 'left' }),
      ],
      edges: [wire('p.out', 'c.in')],
    }
    const result = await engine.trigger(tile(graph), press)
    expect(result?.status).toBe('ok')
    expect(seen.slice(0, 2)).toEqual(['0:02', '0:01'])
    expect(state.get('left')).toBe('')
  })

  it('clears the time left when the tile is stopped', async () => {
    const state = new Map<string, unknown>()
    const { engine } = setup({
      tileState: { get: (_t, k) => state.get(k), set: (_t, k, v) => void state.set(k, v) },
    })
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('c', 'logic.countdown', { seconds: 60, key: 'left' }),
      ],
      edges: [wire('p.out', 'c.in')],
    }
    const t = tile(graph, 'restart')
    const run = engine.trigger(t, press)
    await new Promise((r) => setTimeout(r, 30))
    expect(state.get('left')).toBe('1:00')
    engine.cancel(t.id)
    expect((await run)?.status).toBe('cancelled')
    expect(state.get('left')).toBe('')
  })
})

describe("What's playing", () => {
  it('reads the song and the time left', async () => {
    const platform = {
      ...mockPlatform(),
      nowPlaying: vi.fn(async () => ({
        title: 'Song',
        artist: 'Band',
        playing: true,
        position: 30,
        duration: 200,
      })),
    }
    const { engine, globals } = setup({ platform })
    await engine.trigger(tile(capture(node('n', 'data.nowPlaying'), 'left')), press)
    expect(globals.get('out')).toBe('-2:50')
    await engine.trigger(tile(capture(node('n', 'data.nowPlaying'), 'song')), press)
    expect(globals.get('out')).toBe('Song – Band')
  })

  it("follows 'nothing' when nothing plays", async () => {
    const platform = { ...mockPlatform(), nowPlaying: vi.fn(async () => undefined) }
    const { engine, globals } = setup({ platform })
    await engine.trigger(tile(capture(node('n', 'data.nowPlaying'), 'playing', 'nothing')), press)
    expect(globals.get('out')).toBe(false)
  })
})

describe('Weather', () => {
  const forecast = JSON.stringify({
    current: { temperature_2m: 12.4, weather_code: 3, is_day: 1 },
    daily: { temperature_2m_max: [15.2], temperature_2m_min: [7.6] },
  })

  it("uses the phone's location", async () => {
    const http = vi.fn(async () => ({ status: 200, body: forecast }))
    const platform = { ...mockPlatform(), http, location: () => ({ lat: 51.5, lon: -0.12 }) }
    const { engine, globals } = setup({ platform })
    const r = await engine.trigger(tile(capture(node('w', 'data.weather', {}), 'summary')), press)
    expect(r?.error).toBeUndefined()
    expect(globals.get('out')).toBe('12° Cloudy')
    expect(String((http.mock.calls[0] as unknown as [{ url: string }])[0].url)).toContain(
      'latitude=51.50&longitude=-0.12',
    )
  })

  it('looks up a typed place', async () => {
    const http = vi.fn(async (req: { url: string }) =>
      req.url.includes('geocoding')
        ? {
            status: 200,
            body: JSON.stringify({
              results: [{ latitude: 48.85, longitude: 2.35, name: 'Paris' }],
            }),
          }
        : { status: 200, body: forecast },
    )
    const platform = { ...mockPlatform(), http }
    const { engine, globals } = setup({ platform })
    await engine.trigger(
      tile(capture(node('w', 'data.weather', { place: 'Paris' }), 'place')),
      press,
    )
    expect(globals.get('out')).toBe('Paris')
  })

  it('explains when there is no location', async () => {
    const { engine } = setup({ platform: mockPlatform() })
    const r = await engine.trigger(tile(capture(node('w', 'data.weather', {}), 'summary')), press)
    expect(r?.error).toMatch(/Share location/)
  })
})
