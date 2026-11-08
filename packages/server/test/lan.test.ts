import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { lanAddresses } from '../src/lan.ts'

const v4 = (address: string, internal = false) =>
  ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo

describe('lanAddresses', () => {
  it('keeps reachable IPv4 addresses, private ranges first', () => {
    const result = lanAddresses({
      lo0: [v4('127.0.0.1', true)],
      utun: [v4('100.64.1.2')],
      en0: [v4('192.168.1.20'), { ...v4('fe80::1'), family: 'IPv6', scopeid: 0 }],
      bridge: [v4('169.254.3.4')],
    })
    expect(result).toEqual([
      { iface: 'en0', address: '192.168.1.20' },
      { iface: 'utun', address: '100.64.1.2' },
    ])
  })
})
