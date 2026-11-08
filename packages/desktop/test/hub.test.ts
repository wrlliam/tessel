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
    openApp: vi.fn(async (_app: string) => {}),
    openUrl: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    typeText: vi.fn(async (_text: string) => {}),
    pressCombo: vi.fn(async () => {}),
    mediaKey: vi.fn(async () => {}),
    mouse: vi.fn(async () => {}),
    setDarkMode: vi.fn(async () => {}),
    setMuted: vi.fn(async (_on: boolean | 'toggle') => {}),
    setVolume: vi.fn(async () => {}),
    setBrightness: vi.fn(async () => {}),
    lockScreen: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    setClipboard: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    runShell: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    http: vi.fn(async () => ({ status: 200, body: '' })),
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

describe('Hub editor API', () => {
  it('lists block descriptors without code', async () => {
    const { hub } = await makeHub()
    const blocks = hub.blocks()
    expect(blocks.map((b) => b.id)).toContain('action.openApp')
    expect(blocks[0]).not.toHaveProperty('run')
  })

  it('saves an edited profile but keeps variables set by tiles', async () => {
    const { hub, dataDir } = await makeHub()
    const edited = structuredClone(hub.getProfile('default')!)
    const tile = edited.pages[0]?.tiles[0]
    if (tile) tile.label = 'Chat'
    edited.variables = { email: 'stale@example.com' }
    expect(await hub.saveProfile(edited)).toEqual({ ok: true })
    const saved = JSON.parse(await readFile(join(dataDir, 'profiles', 'default.json'), 'utf8'))
    expect(saved.data.pages[0].tiles[0].label).toBe('Chat')
    expect(saved.data.variables.email).toBe('you@example.com')
  })

  it('rejects an invalid profile', async () => {
    const { hub } = await makeHub()
    const broken = structuredClone(hub.getProfile('default')!)
    const tile = broken.pages[0]?.tiles[0]
    if (tile) tile.position = { col: 9, row: 9 }
    const result = await hub.saveProfile(broken)
    expect(result.ok).toBe(false)
    expect(hub.getProfile('default')?.pages[0]?.tiles[0]?.position).toEqual({ col: 0, row: 0 })
  })

  it('validates graphs', async () => {
    const { hub } = await makeHub()
    expect(hub.checkGraph({ nodes: [{ id: 'x', type: 'nope' }], edges: [] })[0]?.message).toMatch(
      /Unknown block/,
    )
    expect(hub.checkGraph('garbage')).toEqual([
      { severity: 'error', message: 'The graph is not readable' },
    ])
  })

  it('test runs a tile and streams engine events', async () => {
    const { hub, platform } = await makeHub()
    const events: string[] = []
    hub.onEngineEvent((e) => events.push(e.event.type))
    hub.setPaused(true)
    await hub.testRun('default', 'calculator')
    expect(platform.openApp).toHaveBeenCalledWith('Calculator')
    expect(events[0]).toBe('run:start')
    expect(events.at(-1)).toBe('run:end')
  })
})

describe('Hub profiles', () => {
  it('creates, activates and deletes profiles, keeping one', async () => {
    const { hub } = await makeHub()
    const id = await hub.createProfile('Gaming')
    expect(hub.state().profiles.map((p) => p.name)).toEqual(['Default', 'Gaming'])
    await hub.setActiveProfile(id)
    expect(hub.state().activeProfileId).toBe(id)
    expect(await hub.deleteProfile(id)).toBe(true)
    expect(hub.state().activeProfileId).toBe('default')
    expect(await hub.deleteProfile('default')).toBe(false)
  })

  it('runs presses against the active profile only', async () => {
    const { hub, platform } = await makeHub()
    const id = await hub.createProfile('Empty')
    await hub.setActiveProfile(id)
    await hub.press({ deviceId: 'd', tileId: 'calculator', phase: 'down' })
    expect(platform.openApp).not.toHaveBeenCalled()
  })

  it('keeps variables separate per profile', async () => {
    const { hub } = await makeHub()
    const copy = await hub.duplicateProfile('default')
    hub.addVariables(copy as string, { email: 'other@example.com', extra: 1 })
    expect(hub.getProfile(copy as string)?.variables).toEqual({
      email: 'you@example.com',
      extra: 1,
    })
    expect(hub.getProfile('default')?.variables).toEqual({ email: 'you@example.com' })
  })

  it('round-trips a profile through export and import as a new profile', async () => {
    const { hub } = await makeHub()
    const bytes = await hub.exportProfile('default')
    const preview = hub.previewImport(bytes as Uint8Array)
    expect(preview.blocks).toContain('Open app')
    const id = await hub.addImported(preview.profile)
    expect(id).not.toBe('default')
    expect(hub.state().profiles.find((p) => p.id === id)?.name).toBe('Default (2)')
  })

  it('pushes live appearance from bindings when variables change', async () => {
    const { hub } = await makeHub()
    const profile = structuredClone(hub.getProfile('default')!)
    const tile = profile.pages[0]!.tiles.find((t) => t.id === 'email')!
    tile.appearanceBindings = [{ field: 'label', expression: 'Count {{var.n ?? 0}}' }]
    await hub.saveProfile(profile)
    expect(hub.state().liveAppearance['email']?.label).toBe('Count 0')
    hub.addVariables('default', { n: 5 })
    expect(hub.state().liveAppearance['email']?.label).toBe('Count 5')
  })

  it('applies Set tile appearance to the pressed tile and resets it', async () => {
    const { hub } = await makeHub()
    const profile = structuredClone(hub.getProfile('default')!)
    const tile = profile.pages[0]!.tiles.find((t) => t.id === 'lock')!
    tile.graph = {
      nodes: [
        { id: 'p', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
        {
          id: 's',
          type: 'action.setTileAppearance',
          params: { label: 'Locked', colour: '#F25C6E', icon: 'lock', reset: false },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [{ id: 'e', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 's', port: 'in' } }],
    }
    await hub.saveProfile(profile)
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    expect(hub.state().liveAppearance['lock']).toEqual({
      label: 'Locked',
      colour: '#F25C6E',
      icon: 'lock',
    })
    tile.graph.nodes[1]!.params = { label: '', colour: '', icon: '', reset: true }
    await hub.saveProfile(profile)
    expect(hub.state().liveAppearance['lock']).toBeDefined()
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    expect(hub.state().liveAppearance['lock']).toBeUndefined()
  })
})

type Hub_ = Awaited<ReturnType<typeof makeHub>>['hub']
const n = (id: string, type: string, params: Record<string, unknown> = {}) => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
})
const w = (from: string, fp: string, to: string, tp = 'in') => ({
  id: `${from}-${fp}-${to}`,
  from: { nodeId: from, port: fp },
  to: { nodeId: to, port: tp },
})

async function withLockGraph(
  hub: Hub_,
  graph: { nodes: ReturnType<typeof n>[]; edges: ReturnType<typeof w>[] },
  change?: (t: { appearanceBindings: unknown[] }) => void,
) {
  const profile = structuredClone(hub.getProfile('default')!)
  const tile = profile.pages[0]!.tiles.find((t) => t.id === 'lock')!
  tile.graph = graph
  change?.(tile as never)
  expect(await hub.saveProfile(profile)).toEqual({ ok: true })
}

describe('Hub triggers', () => {
  const app = (name: string) => n(name, 'action.openApp', { app: name })

  it('fires On press on touch when the tile has no long press', async () => {
    const { hub, platform } = await makeHub()
    await withLockGraph(hub, {
      nodes: [n('p', 'trigger.press'), app('tap'), n('r', 'trigger.release'), app('up')],
      edges: [w('p', 'out', 'tap'), w('r', 'out', 'up')],
    })
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    expect(platform.openApp.mock.calls.flat()).toEqual(['tap'])
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'up' })
    expect(platform.openApp.mock.calls.flat()).toEqual(['tap', 'up'])
  })

  it('makes press and long press exclusive', async () => {
    const { hub, platform } = await makeHub()
    await withLockGraph(hub, {
      nodes: [n('p', 'trigger.press'), app('short'), n('l', 'trigger.longPress'), app('long')],
      edges: [w('p', 'out', 'short'), w('l', 'out', 'long')],
    })
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'up' })
    expect(platform.openApp.mock.calls.flat()).toEqual(['short'])

    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    await new Promise((r) => setTimeout(r, 600))
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'up' })
    expect(platform.openApp.mock.calls.flat()).toEqual(['short', 'long'])
  })

  it('runs On page open for tiles on the opened page', async () => {
    const { hub, platform } = await makeHub()
    await withLockGraph(hub, {
      nodes: [n('o', 'trigger.pageOpen'), app('opened')],
      edges: [w('o', 'out', 'opened')],
    })
    await hub.pageOpened('home')
    expect(platform.openApp).toHaveBeenCalledWith('opened')
  })

  it('keeps Toggle state, exposes it to live appearance, and survives editor saves', async () => {
    const { hub, platform } = await makeHub()
    await withLockGraph(
      hub,
      {
        nodes: [
          n('p', 'trigger.press'),
          n('t', 'logic.toggle', { key: 'on' }),
          n('m', 'action.setSetting', { setting: 'mute', value: 'toggle' }),
        ],
        edges: [w('p', 'out', 't'), w('t', 'on', 'm'), w('t', 'off', 'm')],
      },
      (t) =>
        (t.appearanceBindings = [
          { field: 'colour', expression: '{{state.on ? "#F25C6E" : "#161B22"}}' },
        ]),
    )
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    expect(platform.setMuted).toHaveBeenCalledWith('toggle')
    expect(hub.getProfile('default')?.tileState['lock']).toEqual({ on: true })
    expect(hub.state().liveAppearance['lock']?.colour).toBe('#F25C6E')
    // An editor save carrying stale state must not reset it.
    const stale = structuredClone(hub.getProfile('default')!)
    stale.tileState = {}
    await hub.saveProfile(stale)
    expect(hub.getProfile('default')?.tileState['lock']).toEqual({ on: true })
  })
})

describe('Hub settings', () => {
  it('saves allowed settings and ignores the rest', async () => {
    const { hub, dataDir } = await makeHub()
    expect(
      await hub.updateSettings({ shell: 'confirm', logLevel: 'error', allowPhones: false }),
    ).toEqual({ ok: true })
    expect(hub.state().settings).toMatchObject({ shell: 'confirm', logLevel: 'error' })
    expect(hub.state().allowPhones).toBe(true)
    expect(hub.shellPolicy()).toBe('confirm')
    const saved = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))
    expect(saved.data.shell).toBe('confirm')
  })

  it('rejects invalid values', async () => {
    const { hub } = await makeHub()
    expect((await hub.updateSettings({ port: 80 })).ok).toBe(false)
  })

  it('filters the activity log by level', async () => {
    const { hub } = await makeHub()
    await hub.updateSettings({ logLevel: 'error' })
    const before = hub.state().log.length
    hub.setPaused(true)
    expect(hub.state().log.length).toBe(before)
  })

  it('restarts sharing on a new port', async () => {
    const { hub } = await makeHub()
    const port = await freePort()
    await hub.updateSettings({ port })
    expect(hub.state()).toMatchObject({ listening: true, port })
    expect(hub.state().urls[0]).toContain(`:${port}/`)
  })
})

describe('Hub phone settings and remembered looks', () => {
  it('saves phone settings and rejects bad values', async () => {
    const { hub, dataDir } = await makeHub()
    expect(
      await hub.updatePhoneSettings({ theme: 'light', landscape: 'rotate', dimLevel: 80 }),
    ).toEqual({ ok: true })
    expect(hub.state().phoneSettings).toMatchObject({
      theme: 'light',
      landscape: 'rotate',
      dimLevel: 80,
      keyStyle: 'tinted',
    })
    expect((await hub.updatePhoneSettings({ dimLevel: 5 })).ok).toBe(false)
    const saved = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))
    expect(saved.data.phone.theme).toBe('light')
  })

  it('remembers a look set on another tile across restarts', async () => {
    const { hub, dataDir } = await makeHub()
    const profile = structuredClone(hub.getProfile('default')!)
    const tile = profile.pages[0]!.tiles.find((t) => t.id === 'lock')!
    tile.graph = {
      nodes: [
        { id: 'p', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
        {
          id: 's',
          type: 'action.setTileAppearance',
          params: {
            tile: 'email',
            label: 'Sent',
            colour: '#22D3C5',
            icon: '',
            reset: false,
            remember: true,
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [{ id: 'e', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 's', port: 'in' } }],
    }
    await hub.saveProfile(profile)
    await hub.press({ deviceId: 'd', tileId: 'lock', phase: 'down' })
    expect(hub.state().liveAppearance['email']).toMatchObject({ label: 'Sent', colour: '#22D3C5' })
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
    expect(again.state().liveAppearance['email']).toMatchObject({
      label: 'Sent',
      colour: '#22D3C5',
    })
  })
})
