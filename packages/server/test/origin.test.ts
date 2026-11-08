import { describe, expect, it } from 'vitest'
import { isAllowedHost, isSameOrigin } from '../src/origin.ts'

describe('isAllowedHost', () => {
  it.each([
    '192.168.1.20:4747',
    '10.0.0.5',
    'localhost:4747',
    'wills-mac.local:4747',
    '[::1]:4747',
  ])('allows %s', (host) => expect(isAllowedHost(host)).toBe(true))
  it.each([undefined, '', 'evil.example.com', 'evil.example.com:4747', '192.168.1.20.evil.com'])(
    'blocks %s',
    (host) => expect(isAllowedHost(host)).toBe(false),
  )
})

describe('isSameOrigin', () => {
  it('matches origin to host', () => {
    expect(isSameOrigin('http://192.168.1.20:4747', '192.168.1.20:4747')).toBe(true)
  })
  it('rejects other origins, missing origins and garbage', () => {
    expect(isSameOrigin('http://evil.com', '192.168.1.20:4747')).toBe(false)
    expect(isSameOrigin(undefined, '192.168.1.20:4747')).toBe(false)
    expect(isSameOrigin('null', '192.168.1.20:4747')).toBe(false)
  })
})
