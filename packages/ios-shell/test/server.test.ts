import { describe, expect, it } from 'vitest'
import { normaliseAddress, urlFromService } from '../src/server.ts'

describe('normaliseAddress', () => {
  it.each([
    ['192.168.1.20', 'http://192.168.1.20:4747/'],
    ['192.168.1.20:4800', 'http://192.168.1.20:4800/'],
    ['  http://mac.local:4747/whatever ', 'http://mac.local:4747/'],
    ['https://10.0.0.2', 'https://10.0.0.2:4747/'],
  ])('%s', (input, url) => expect(normaliseAddress(input)).toBe(url))

  it.each(['', 'http://', 'user:pass@1.2.3.4', 'not a host name!'])('rejects %j', (input) => {
    expect(normaliseAddress(input)).toBeUndefined()
  })
})

describe('urlFromService', () => {
  it('prefers the IPv4 address and drops the "Tessel on" prefix', () => {
    expect(
      urlFromService({
        name: 'Tessel on studio',
        host: 'studio.local.',
        port: 4747,
        addresses: ['10.0.0.5'],
      }),
    ).toEqual({
      name: 'studio',
      url: 'http://10.0.0.5:4747/',
    })
  })

  it('falls back to the .local host name', () => {
    expect(
      urlFromService({ name: 'x', host: 'studio.local.', port: 4747, addresses: [] })?.url,
    ).toBe('http://studio.local:4747/')
  })

  it('ignores incomplete results', () => {
    expect(urlFromService({ name: 'x', host: '', port: 0, addresses: [] })).toBeUndefined()
  })
})
