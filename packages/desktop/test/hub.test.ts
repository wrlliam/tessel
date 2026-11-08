import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Hub } from '../src/main/hub.ts'
import { SETTINGS_SCHEMA_VERSION } from '../src/main/settings.ts'

const hubs: Hub[] = []
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((h) => h.dispose()))
})

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

async function makeHub(settings: Record<string, unknown> = {}, dir?: string) {
  const dataDir = dir ?? (await mkdtemp(join(tmpdir(), 'tessel-hub-')))
  const port = (settings['port'] as number | undefined) ?? (await freePort())
  await writeFile(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      data: { allowPhones: true, ...settings, port },
    }),
  )
  const hub = new Hub({
    dataDir,
    phoneDir: join(dataDir, 'none'),
    addresses: () => [{ iface: 'en0', address: '192.168.1.20' }],
    mdns: false,
  })
  hubs.push(hub)
  await hub.init()
  return { hub, dataDir, port }
}

describe('Hub', () => {
  it('starts sharing and offers a QR code per address', async () => {
    const { hub, port } = await makeHub()
    const state = hub.state()
    expect(state.listening).toBe(true)
    expect(state.urls).toEqual([`http://192.168.1.20:${port}/`])
    expect(state.qrCodes[state.urls[0] ?? '']).toMatch(/^data:image\/png;base64,/)
    expect(state.pairing.code).toMatch(/^\d{6}$/)
  })

  it('stops sharing when phones are turned off and remembers it', async () => {
    const { hub, dataDir, port } = await makeHub()
    await hub.setAllowPhones(false)
    expect(hub.state()).toMatchObject({ listening: false, urls: [] })
    await hub.dispose()

    const again = new Hub({ dataDir, phoneDir: dataDir, addresses: () => [], mdns: false })
    hubs.push(again)
    await again.init()
    expect(again.state()).toMatchObject({ allowPhones: false, listening: false, port })
  })

  it('explains a port clash in plain language', async () => {
    const port = await freePort()
    const blocker = createServer().listen(port, '0.0.0.0')
    await new Promise((r) => blocker.once('listening', r))
    try {
      const { hub } = await makeHub({ port })
      expect(hub.state().listening).toBe(false)
      expect(hub.state().serverError).toBe(
        `Port ${port} is already used by another app. Close it or pick another port.`,
      )
    } finally {
      blocker.close()
    }
  })

  it('logs pause changes', async () => {
    const { hub } = await makeHub()
    hub.setPaused(true)
    expect(hub.state().paused).toBe(true)
    expect(hub.state().log.at(-1)?.message).toBe('Paused all tiles')
  })
})
