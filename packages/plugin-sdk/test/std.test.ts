import { afterEach, describe, expect, it, vi } from 'vitest'
import { date, homeAssistant, math, text } from '../custom/std.ts'

afterEach(() => vi.unstubAllGlobals())

describe('std', () => {
  it('formats and compares dates', () => {
    const d = new Date(2026, 11, 25, 9, 5, 3)
    expect(date.format(d, 'dddd D MMMM YYYY HH:mm:ss')).toBe('Friday 25 December 2026 09:05:03')
    expect(date.month(d)).toBe(12)
    expect(date.isWeekend(d)).toBe(false)
    expect(date.daysBetween(new Date(2026, 11, 20), d)).toBe(5)
    expect(date.isAfter(d, '2026-01-01')).toBe(true)
  })

  it('handles text and numbers', () => {
    expect(text.truncate('Hello world', 8)).toBe('Hello w…')
    expect(text.slug('Hello, World!')).toBe('hello-world')
    expect(text.fill('Hi {name}, {x}', { name: 'Sam' })).toBe('Hi Sam, {x}')
    expect(math.map(50, 0, 100, -60, 12)).toBe(-24)
    expect(math.round(1.2345, 2)).toBe(1.23)
    expect(math.clamp(12, 0, 10)).toBe(10)
  })

  it('talks to Home Assistant with a bearer token', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/api/states/light.desk')
        ? new Response(
            JSON.stringify({
              entity_id: 'light.desk',
              state: 'on',
              attributes: {},
              last_changed: '',
            }),
          )
        : new Response('[]'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const ha = homeAssistant({ url: 'http://ha.local:8123/', token: 'tok' })
    await ha.toggle('light.desk')
    expect((await ha.state('light.desk')).state).toBe('on')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://ha.local:8123/api/services/light/toggle')
    expect(JSON.parse(String(init.body))).toEqual({ entity_id: 'light.desk' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok')
  })

  it('asks for a token before calling Home Assistant', () => {
    expect(() => homeAssistant({ url: 'http://x', token: '' })).toThrow(/token/)
  })
})
