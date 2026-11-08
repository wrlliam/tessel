// The plugin catalog: optional plugins people can add from the Plugins tab. CI publishes the
// zips and catalog.json on the "plugins" release; each download is checked against its SHA-256.
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const CATALOG_URL =
  process.env['TESSEL_CATALOG_URL'] ??
  'https://github.com/wrlliam/tessel/releases/download/plugins/catalog.json'
const MAX_ZIP_BYTES = 50 * 1024 * 1024
const CACHE_MS = 10 * 60_000

export const CatalogEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().max(60),
  version: z.string().max(40),
  description: z.string().max(400).default(''),
  author: z.string().max(80).optional(),
  icon: z.string().max(40).optional(),
  platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).optional(),
  permissions: z.array(z.string()).default([]),
  url: z.string().url(),
  size: z.int().min(1).max(MAX_ZIP_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
export type CatalogEntry = z.infer<typeof CatalogEntry>
const Catalog = z.object({ schema: z.literal(1), plugins: z.array(CatalogEntry).max(500) })

/** "1.10.0" > "1.9.2". */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

export class PluginCatalog {
  private cached?: { at: number; entries: CatalogEntry[] }

  constructor(
    private fetchFn: typeof fetch = fetch,
    private url = CATALOG_URL,
  ) {}

  async list(force = false): Promise<CatalogEntry[]> {
    if (!force && this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.entries
    let res: Response
    try {
      res = await this.fetchFn(this.url, { signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new Error("Can't reach the plugin list. Check the internet connection.")
    }
    if (!res.ok) throw new Error(`The plugin list answered ${res.status}.`)
    const parsed = Catalog.safeParse(await res.json().catch(() => null))
    if (!parsed.success) throw new Error('The plugin list is damaged.')
    this.cached = { at: Date.now(), entries: parsed.data.plugins }
    return parsed.data.plugins
  }

  /** Downloads a plugin's zip and checks it is exactly the file the catalog describes. */
  async download(entry: CatalogEntry): Promise<Uint8Array> {
    let res: Response
    try {
      res = await this.fetchFn(entry.url, { signal: AbortSignal.timeout(60_000) })
    } catch {
      throw new Error(`Couldn't download ${entry.name}.`)
    }
    if (!res.ok) throw new Error(`Downloading ${entry.name} failed (${res.status}).`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_ZIP_BYTES || bytes.byteLength !== entry.size)
      throw new Error(`${entry.name} didn't download completely. Try again.`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== entry.sha256)
      throw new Error(`${entry.name} doesn't match the plugin list, so it wasn't installed.`)
    return bytes
  }
}
