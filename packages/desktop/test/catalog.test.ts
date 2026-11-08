import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { newer, PluginCatalog, type CatalogEntry } from '../src/main/catalog.ts'

const zip = zipSync({
  'manifest.json': strToU8('{}'),
  'dist/index.js': strToU8('export default {}'),
})
const entry: CatalogEntry = {
  id: 'obs',
  name: 'OBS Studio',
  version: '1.2.0',
  description: '',
  permissions: ['network'],
  url: 'https://example.test/obs-1.2.0.zip',
  size: zip.byteLength,
  sha256: createHash('sha256').update(zip).digest('hex'),
}

function server(body: Uint8Array = zip) {
  return vi.fn(async (url: string | URL | Request) =>
    String(url).endsWith('catalog.json')
      ? new Response(JSON.stringify({ schema: 1, plugins: [entry] }))
      : new Response(body as unknown as BodyInit),
  ) as unknown as typeof fetch
}

describe('plugin catalog', () => {
  it('compares versions', () => {
    expect(newer('1.10.0', '1.9.2')).toBe(true)
    expect(newer('1.0.0', '1.0.0')).toBe(false)
    expect(newer('0.9', '1.0.0')).toBe(false)
  })

  it('lists plugins and caches the list', async () => {
    const fetchFn = server()
    const c = new PluginCatalog(fetchFn, 'https://example.test/catalog.json')
    expect((await c.list()).map((p) => p.id)).toEqual(['obs'])
    await c.list()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('accepts only the exact file the list describes', async () => {
    expect(await new PluginCatalog(server()).download(entry)).toEqual(zip)
    const tampered = zip.slice()
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1
    await expect(new PluginCatalog(server(tampered)).download(entry)).rejects.toThrow(
      /doesn't match/,
    )
    await expect(new PluginCatalog(server(zip.slice(1))).download(entry)).rejects.toThrow(
      /completely/,
    )
  })

  it('refuses a damaged list', async () => {
    const bad = vi.fn(
      async () => new Response('{"schema":1,"plugins":[{"id":"x"}]}'),
    ) as unknown as typeof fetch
    await expect(new PluginCatalog(bad).list()).rejects.toThrow(/damaged/)
  })
})
