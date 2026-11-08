import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_SCHEMA_VERSION, sampleProfile, type Platform } from '@tessel/core'
import { Hub } from '../src/main/hub.ts'
import { SETTINGS_SCHEMA_VERSION } from '../src/main/settings.ts'

const hubs: Hub[] = []

const mockPlatform = () =>
  ({
    os: 'darwin',
    openApp: vi.fn(async () => {}),
    typeText: vi.fn(async () => {}),
    pressCombo: vi.fn(async () => {}),
    setDarkMode: vi.fn(async () => {}),
  }) satisfies Platform
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
  const platform = mockPlatform()
  const hub = new Hub({
    dataDir,
    platform,
    phoneDir: join(dataDir, 'none'),
    addresses: () => [{ iface: 'en0', address: '192.168.1.20' }],
    mdns: false,
  })
  hubs.push(hub)
  await hub.init()
  return { hub, dataDir, port, platform }
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

    const again = new Hub({
      dataDir,
      platform: mockPlatform(),
      phoneDir: dataDir,
      addresses: () => [],
      mdns: false,
    })
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

  it('writes the starter profile on first run', async () => {
    const { dataDir } = await makeHub()
    const saved = JSON.parse(await readFile(join(dataDir, 'profiles', 'default.json'), 'utf8'))
    expect(saved).toMatchObject({ schemaVersion: PROFILE_SCHEMA_VERSION, data: { id: 'default' } })
  })

  it('logs pause changes', async () => {
    const { hub } = await makeHub()
    hub.setPaused(true)
    expect(hub.state().paused).toBe(true)
    expect(hub.state().log.at(-1)?.message).toBe('Paused all tiles')
  })
})

describe('Hub tiles', () => {
  const down = (tileId: string) => ({ deviceId: 'd', tileId, phase: 'down' as const })

  it('runs the tile graph on press and logs the result', async () => {
    const { hub, platform } = await makeHub()
    await hub.press(down('discord'))
    expect(platform.openApp).toHaveBeenCalledWith('Discord')
    expect(hub.state().log.at(-1)?.message).toMatch(/^"Discord" ran in \d+ ms$/)
  })

  it('does nothing on release when there is no release trigger', async () => {
    const { hub, platform } = await makeHub()
    await hub.press({ ...down('discord'), phase: 'up' })
    expect(platform.openApp).not.toHaveBeenCalled()
  })

  it('logs failures with the block name', async () => {
    const { hub, platform } = await makeHub()
    platform.openApp.mockRejectedValueOnce(new Error('Couldn\'t find an app called "Discord".'))
    await hub.press(down('discord'))
    expect(hub.state().log.at(-1)).toMatchObject({
      level: 'error',
      message: '"Discord" › Open app: Couldn\'t find an app called "Discord".',
    })
  })

  it('uses profile variables in templates', async () => {
    const { hub, platform } = await makeHub()
    await hub.press(down('email'))
    expect(platform.typeText).toHaveBeenCalledWith('you@example.com')
  })

  it('says when a tile has no blocks', async () => {
    const { hub } = await makeHub()
    await hub.press(down('lock'))
    expect(hub.state().log.at(-1)?.message).toBe('"Lock" has no blocks yet')
  })

  it('ignores presses while paused', async () => {
    const { hub, platform } = await makeHub()
    hub.setPaused(true)
    await hub.press(down('discord'))
    expect(platform.openApp).not.toHaveBeenCalled()
  })

  it('persists global variables set by a tile', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'tessel-hub-'))
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dataDir, 'profiles'))
    const profile = {
      ...sampleProfile,
      pages: [
        {
          id: 'home',
          name: 'Home',
          tiles: [
            {
              id: 'count',
              label: 'Count',
              position: { col: 0, row: 0 },
              graph: {
                nodes: [
                  { id: 'p', type: 'trigger.press' },
                  {
                    id: 's',
                    type: 'data.setVariable',
                    params: { name: 'n', value: '{{(var.n ?? 0) + 1}}' },
                  },
                ],
                edges: [
                  { id: 'e', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 's', port: 'in' } },
                ],
              },
            },
          ],
        },
      ],
    }
    await writeFile(
      join(dataDir, 'profiles', 'default.json'),
      JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, data: profile }),
    )
    const { hub } = await makeHub({}, dataDir)
    await hub.press(down('count'))
    await hub.press(down('count'))
    await hub.dispose()

    const saved = JSON.parse(await readFile(join(dataDir, 'profiles', 'default.json'), 'utf8'))
    expect(saved.data.variables.n).toBe(2)
  })
})
