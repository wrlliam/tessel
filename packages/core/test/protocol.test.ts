import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  sampleProfile,
  toPhoneProfile,
} from '../src/index.ts'

describe('client messages', () => {
  it('parses hello', () => {
    const r = parseClientMessage(
      JSON.stringify({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'abc',
        deviceName: 'iPhone',
      }),
    )
    expect(r.ok).toBe(true)
  })

  it('parses press', () => {
    const r = parseClientMessage(
      JSON.stringify({ type: 'press', tileId: 'discord', phase: 'down' }),
    )
    expect(r).toEqual({ ok: true, message: { type: 'press', tileId: 'discord', phase: 'down' } })
  })

  it('rejects invalid JSON', () => {
    expect(parseClientMessage('{nope')).toEqual({ ok: false, error: 'Message is not valid JSON' })
  })

  it('rejects unknown message types so phones cannot send commands', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'run', command: 'rm -rf /' }))
    expect(r.ok).toBe(false)
  })

  it('rejects a bad press phase', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'press', tileId: 'a', phase: 'hold' }))
    expect(r.ok).toBe(false)
  })
})

describe('server messages', () => {
  it('round-trips a profile message', () => {
    const msg = { type: 'profile', profile: toPhoneProfile(sampleProfile) }
    expect(parseServerMessage(JSON.stringify(msg))).toEqual({ ok: true, message: msg })
  })
})

describe('toPhoneProfile', () => {
  it('strips graphs and bindings', () => {
    const phone = toPhoneProfile(sampleProfile)
    const tile = phone.pages[0]?.tiles[0]
    expect(tile).toBeDefined()
    expect(tile).not.toHaveProperty('graph')
    expect(tile).not.toHaveProperty('appearanceBindings')
  })
})

describe('phone settings', () => {
  it('fills defaults and round-trips as a message', async () => {
    const { defaultPhoneSettings, parseServerMessage } = await import('../src/index.ts')
    const settings = defaultPhoneSettings()
    expect(settings).toMatchObject({
      theme: 'system',
      keyStyle: 'tinted',
      spacing: 'regular',
      dimLevel: 60,
      landscape: 'reflow',
      shareLocation: false,
    })
    const msg = { type: 'phoneSettings', settings: { ...settings, theme: 'dark' } }
    expect(parseServerMessage(JSON.stringify(msg))).toEqual({ ok: true, message: msg })
  })
})
