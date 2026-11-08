import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { createHomeAssistantPlugin, type Connect } from '../src/plugin.ts'

function fake(states: Record<string, string>) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const connect: Connect = () => ({
    call: async (service, data = {}) => {
      calls.push([service, data])
      const id = String(data['entity_id'] ?? '')
      if (service.endsWith('.toggle')) states[id] = states[id] === 'on' ? 'off' : 'on'
      return []
    },
    state: async (id) => ({
      entity_id: id,
      state: states[id] ?? 'unknown',
      attributes: { friendly_name: 'Desk', unit: '°C' },
      last_changed: '',
    }),
    states: async () => [],
    toggle: async () => [],
    turnOn: async () => [],
    turnOff: async () => [],
  })
  return { connect, calls, states }
}

describe('home assistant plugin', () => {
  it('toggles and goes out the new way', async () => {
    const f = fake({ 'light.desk': 'off' })
    const h = createHarness(createHomeAssistantPlugin(f.connect), {
      settings: { url: 'http://ha', token: 't' },
    })
    await h.load()
    expect(await h.run('toggle', { entity: 'light.desk', action: 'toggle' })).toEqual({
      next: 'on',
      values: { state: 'on' },
    })
    expect(f.calls[0]).toEqual(['light.toggle', { entity_id: 'light.desk' }])
    expect(h.tileState.get('on')).toBe(true)
  })

  it('calls a service with data from a slider', async () => {
    const f = fake({})
    const h = createHarness(createHomeAssistantPlugin(f.connect), {
      settings: { url: 'http://ha', token: 't' },
    })
    await h.load()
    await h.run(
      'service',
      {
        service: 'light.turn_on',
        entity: 'light.desk',
        data: '{"brightness_pct": {{input.value}}}',
      },
      { value: 40 },
    )
    expect(f.calls[0]).toEqual(['light.turn_on', { entity_id: 'light.desk', brightness_pct: 40 }])
  })

  it('reads a state and an attribute', async () => {
    const f = fake({ 'sensor.temp': '21.5' })
    const h = createHarness(createHomeAssistantPlugin(f.connect), {
      settings: { url: 'http://ha', token: 't' },
    })
    await h.load()
    expect(await h.run('state', { entity: 'sensor.temp', attribute: 'unit' })).toEqual({
      next: 'other',
      values: { state: '21.5', attribute: '°C', name: 'Desk' },
    })
  })

  it('asks for a token first', async () => {
    const h = createHarness(createHomeAssistantPlugin(fake({}).connect))
    await h.load()
    await expect(h.run('toggle', { entity: 'light.desk', action: 'toggle' })).rejects.toThrow(
      /token/,
    )
  })

  it('fires the trigger when the state changes', async () => {
    vi.useFakeTimers()
    const f = fake({ 'light.desk': 'off' })
    const h = createHarness(createHomeAssistantPlugin(f.connect), {
      settings: { url: 'http://ha', token: 't', pollSeconds: 2 },
    })
    await h.load()
    const sub = h.subscribe('watch', { entity: 'light.desk' })
    await vi.advanceTimersByTimeAsync(10)
    f.states['light.desk'] = 'on'
    await vi.advanceTimersByTimeAsync(2100)
    expect(sub.events).toEqual([{ state: 'on' }])
    sub.stop()
    vi.useRealTimers()
  })
})
