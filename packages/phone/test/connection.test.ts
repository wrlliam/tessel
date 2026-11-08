import { describe, expect, it } from 'vitest'
import { backoffDelay, wsUrl } from '../src/connection.ts'
import { guessDeviceName } from '../src/device.ts'

describe('backoffDelay', () => {
  it('grows exponentially and caps at 10 s', () => {
    const max = () => 1
    expect(backoffDelay(0, max)).toBe(500)
    expect(backoffDelay(3, max)).toBe(4000)
    expect(backoffDelay(20, max)).toBe(10_000)
  })

  it('applies jitter down to half', () => {
    expect(backoffDelay(0, () => 0)).toBe(250)
  })
})

describe('wsUrl', () => {
  it('matches the page scheme', () => {
    expect(wsUrl({ protocol: 'http:', host: '192.168.1.2:4747' })).toBe('ws://192.168.1.2:4747/ws')
    expect(wsUrl({ protocol: 'https:', host: 'mac.local:4747' })).toBe('wss://mac.local:4747/ws')
  })
})

describe('guessDeviceName', () => {
  it('recognises common phones', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone')
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 15)')).toBe('Android phone')
  })
})
