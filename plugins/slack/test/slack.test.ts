import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createSlackPlugin } from '../src/plugin.ts'

describe('Slack plugin', () => {
  it('sets a status that clears itself', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    const h = createHarness(createSlackPlugin(fetchFn), { settings: { token: 'xoxp-1' } })
    await h.load()
    await h.run('status', { text: 'In a meeting', emoji: 'calendar', minutes: 30 })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/users.profile.set')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer xoxp-1')
    expect(JSON.parse(String(init.body)).profile).toEqual({
      status_text: 'In a meeting',
      status_emoji: ':calendar:',
      status_expiration: 1767225600 + 1800,
    })
    vi.useRealTimers()
  })

  it('pauses notifications and explains Slack errors', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    const h = createHarness(createSlackPlugin(ok), { settings: { token: 'x' } })
    await h.load()
    await h.run('dnd', { action: 'pause', minutes: 45 })
    expect(
      JSON.parse(String((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    ).toEqual({ num_minutes: 45 })
    expect(h.tileState.get('paused')).toBe(true)
    const bad = createHarness(
      createSlackPlugin(
        async () => new Response(JSON.stringify({ ok: false, error: 'missing_scope' })),
      ),
      { settings: { token: 'x' } },
    )
    await bad.load()
    await expect(bad.run('dnd', { action: 'resume', minutes: 1 })).rejects.toThrow(/scopes/)
  })
})
