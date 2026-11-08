import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createGooglePlugin, searchUrl } from '../src/plugin.ts'

describe('google plugin', () => {
  it('builds search links', async () => {
    expect(searchUrl('maps', 'coffee near me')).toBe(
      'https://www.google.com/maps/search/coffee%20near%20me',
    )
    const h = createHarness(createGooglePlugin(vi.fn()))
    expect(await h.run('search', { where: 'web', query: '' }, { text: 'tessel app' })).toEqual({
      values: { url: 'https://www.google.com/search?q=tessel%20app' },
    })
    await expect(h.run('search', { where: 'web', query: '' })).rejects.toThrow(/Nothing to search/)
  })

  it('asks Gemini with the key in a header, not the URL', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Short answer.' }] } }] }),
        ),
    )
    const h = createHarness(createGooglePlugin(fetchFn), {
      settings: { apiKey: 'k123', model: 'gemini-x' },
    })
    await h.load()
    expect(await h.run('gemini', { prompt: 'Sum up:', model: '' }, { text: 'long text' })).toEqual({
      values: { answer: 'Short answer.' },
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/models/gemini-x:generateContent')
    expect(url).not.toContain('k123')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k123')
  })

  it('asks for a key when there is none', async () => {
    const h = createHarness(createGooglePlugin(vi.fn()))
    await h.load()
    await expect(h.run('gemini', { prompt: 'Hi', model: '' })).rejects.toThrow(/API key/)
  })
})
