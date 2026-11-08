/** Turns what the user typed into the phone page URL, e.g. `192.168.1.20` → `http://192.168.1.20:4747/`. */
export function normaliseAddress(input: string, defaultPort = 4747): string | undefined {
  let text = input.trim()
  if (!text) return undefined
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (!url.hostname || url.username || url.password) return undefined
  if (!url.port) url.port = String(defaultPort)
  return `${url.protocol}//${url.host}/`
}

export interface FoundComputer {
  name: string
  url: string
}

/** Builds a URL from a Bonjour result, preferring an IPv4 address over the .local name. */
export function urlFromService(service: {
  name: string
  host: string
  port: number
  addresses: string[]
}): FoundComputer | undefined {
  const host = service.addresses[0] ?? service.host.replace(/\.$/, '')
  if (!host || !service.port) return undefined
  return { name: service.name.replace(/^Tessel on /, ''), url: `http://${host}:${service.port}/` }
}
