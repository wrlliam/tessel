import { isIP } from 'node:net'

/**
 * Only accept Host headers a phone on the LAN would use. Rejecting other names
 * blocks DNS-rebinding attacks from web pages the desktop user visits.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false
  const name = stripPort(host).toLowerCase()
  if (name === 'localhost' || name.endsWith('.local')) return true
  return isIP(name.replace(/^\[|\]$/g, '')) !== 0
}

/** Browsers always send Origin on WebSocket upgrades and cross-site POSTs. */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

function stripPort(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
  const colons = host.split(':').length - 1
  return colons === 1 ? host.slice(0, host.indexOf(':')) : host
}
