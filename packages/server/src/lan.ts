import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

export interface LanAddress {
  iface: string
  address: string
}

const isPrivate = (ip: string) =>
  ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)

/** IPv4 addresses a phone could reach, private ranges first. */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): LanAddress[] {
  const out: LanAddress[] = []
  for (const [iface, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue
      out.push({ iface, address: info.address })
    }
  }
  return out.sort((a, b) => Number(isPrivate(b.address)) - Number(isPrivate(a.address)))
}
