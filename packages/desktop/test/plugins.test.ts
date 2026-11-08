import { createRegistry, Engine, MemoryVariables, type Platform } from '@tessel/core'
import { strToU8, zipSync } from 'fflate'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginManager, type ManagerOptions } from '../src/main/plugins/manager.ts'
import { forkSpawner } from '../src/main/plugins/process.ts'

const runner = join(import.meta.dirname, '../../plugin-sdk/src/runner.ts')

const FIXTURE = `
const any = { safeParse: (v) => ({ success: true, data: v }) }
const textParams = { safeParse: (v) => typeof v?.text === 'string' ? { success: true, data: v } : { success: false, error: { issues: [{ message: 'Enter some text', path: ['text'] }] } } }
const flowIn = { id: 'in', kind: 'flow' }, flowOut = { id: 'out', kind: 'flow' }
export default {
  async onLoad(ctx) { ctx.log.info('hello from ' + ctx.pluginId + ' on ' + ctx.os + ' greeting=' + ctx.settings.greeting) },
  blocks: [
    { id: 'echo', name: 'Echo', description: 'Says it back', inputs: [flowIn], outputs: [flowOut, { id: 'text', kind: 'value', type: 'string' }],
      paramsSchema: textParams, fields: [{ key: 'text', label: 'Text', widget: 'text' }], defaults: { text: '' },
      run: (ctx, p) => { ctx.setTileState('said', p.text); return { values: { text: p.text.toUpperCase() } } } },
    { id: 'crash', name: 'Crash', description: '', inputs: [flowIn], outputs: [flowOut], paramsSchema: any, run: () => process.exit(3) },
    { id: 'slow', name: 'Slow', description: '', inputs: [flowIn], outputs: [flowOut], paramsSchema: any,
      run: (ctx) => new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve({}))) },
    { id: 'store', name: 'Store', description: '', inputs: [flowIn], outputs: [flowOut, { id: 'n', kind: 'value', type: 'number' }], paramsSchema: any,
      run: async (ctx) => { const n = ((await ctx.storage.get('n')) ?? 0) + 1; await ctx.storage.set('n', n); return { values: { n } } } },
  ],
  triggers: [
    { id: 'tick', name: 'Tick', description: '', outputs: [{ id: 'n', kind: 'value', type: 'number' }], paramsSchema: any,
      subscribe: (ctx, sub) => { sub.emit({ n: sub.params.n }); sub.setTileState('ticked', true) } },
  ],
}
`

async function writePlugin(dir: string, manifest: Record<string, unknown> = {}, code = FIXTURE) {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: 'echo',
      name: 'Echo',
      version: '1.0.0',
      apiVersion: 1,
      main: 'index.mjs',
      permissions: [],
      ...manifest,
    }),
  )
  await writeFile(join(dir, 'index.mjs'), code)
}

const managers: PluginManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.dispose()))
})

async function setup(
  overrides: Partial<ManagerOptions> = {},
  plugins: (builtin: string) => Promise<void> = (b) => writePlugin(join(b, 'echo')),
) {
  const root = await mkdtemp(join(tmpdir(), 'tessel-plugins-'))
  const builtin = join(root, 'builtin')
  await mkdir(builtin)
  await plugins(builtin)
  const registry = createRegistry()
  const logs: string[] = []
  const events: Array<[string, Record<string, unknown>]> = []
  const tileStates: Array<[string, string, unknown]> = []
  const manager = new PluginManager({
    dataDir: join(root, 'data'),
    builtinDirs: [builtin],
    spawn: forkSpawner(runner),
    os: 'darwin',
    registry,
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    confirmPermissions: vi.fn(async () => true),
    onChange: () => {},
    onEvent: (id, values) => events.push([id, values]),
    onTileState: (tileId, key, value) => tileStates.push([tileId, key, value]),
    restartDelaysMs: [50, 50],
    ...overrides,
  })
  managers.push(manager)
  await manager.load()
  return { root, builtin, registry, manager, logs, events, tileStates }
}

const until = async (check: () => boolean, ms = 4000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

function engineFor(registry: ReturnType<typeof createRegistry>) {
  const state = new Map<string, unknown>()
  const engine = new Engine({
    registry,
    platform: { os: 'darwin' } as Platform,
    globals: new MemoryVariables(),
    tileState: {
      get: (t, k) => state.get(`${t}:${k}`),
      set: (t, k, v) => void state.set(`${t}:${k}`, v),
    },
  })
  return { engine, state }
}

const tileWith = (type: string, params: Record<string, unknown> = {}) => ({
  id: 'tile',
  graph: {
    nodes: [
      { id: 'p', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
      { id: 'b', type, params, position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
  },
})

describe('plugin manager', () => {
  it('starts built-in plugins and registers their blocks under the plugin id', async () => {
    const { manager, registry, logs } = await setup()
    expect(manager.list()).toMatchObject([
      { id: 'echo', status: 'running', source: 'built-in', enabled: true, blockCount: 5 },
    ])
    expect(registry.get('echo.echo')).toMatchObject({
      category: 'plugin',
      name: 'Echo',
      fields: [{ key: 'text' }],
    })
    expect(registry.get('echo.tick')).toMatchObject({
      trigger: 'plugin',
      outputs: [{ id: 'out' }, { id: 'n' }],
    })
    expect(logs).toContain('Echo: hello from echo on darwin greeting=undefined')
  })

  it('runs plugin blocks through the engine, with tile state', async () => {
    const { registry } = await setup()
    const { engine, state } = engineFor(registry)
    const result = await engine.trigger(tileWith('echo.echo', { text: 'hi' }), { type: 'press' })
    expect(result?.status).toBe('ok')
    expect(state.get('tile:said')).toBe('hi')
  })

  it("reports the plugin's own validation messages", async () => {
    const { registry } = await setup()
    const { engine } = engineFor(registry)
    const result = await engine.trigger(tileWith('echo.echo', { text: 5 }), { type: 'press' })
    expect(result?.error).toBe('text: Enter some text')
  })

  it('cancels a running plugin block when the tile stops', async () => {
    const { registry } = await setup()
    const { engine } = engineFor(registry)
    const run = engine.trigger(tileWith('echo.slow'), { type: 'press' })
    await new Promise((r) => setTimeout(r, 100))
    engine.cancel('tile')
    expect((await run)?.status).toBe('cancelled')
  })

  it('keeps per-plugin storage on disk', async () => {
    const { registry, root } = await setup()
    const { engine } = engineFor(registry)
    await engine.trigger(tileWith('echo.store'), { type: 'press' })
    await engine.trigger(tileWith('echo.store'), { type: 'press' })
    const saved = JSON.parse(await readFile(join(root, 'data', 'plugin-data', 'echo.json'), 'utf8'))
    expect(saved.data).toEqual({ n: 2 })
  })

  it('delivers trigger events and tile state for subscriptions', async () => {
    const { manager, events, tileStates } = await setup()
    manager.setSubscriptions([
      { id: 'tile::node', trigger: 'echo.tick', tileId: 'tile', params: { n: 7 } },
    ])
    await until(() => events.length > 0)
    expect(events[0]).toEqual(['tile::node', { n: 7 }])
    expect(tileStates[0]).toEqual(['tile', 'ticked', true])
  })

  it('survives a crash, restarts, and gives up after repeated crashes', async () => {
    const { manager, registry, logs } = await setup()
    const { engine } = engineFor(registry)
    const first = await engine.trigger(tileWith('echo.crash'), { type: 'press' })
    expect(first?.error).toMatch(/stopped/)
    expect(manager.list()[0]?.status).toBe('crashed')
    expect(registry.get('echo.echo')).toBeUndefined()
    await until(() => manager.list()[0]?.status === 'running')
    expect(registry.get('echo.echo')).toBeDefined()

    await engine.trigger(tileWith('echo.crash'), { type: 'press' })
    await until(() => manager.list()[0]?.status === 'running')
    await engine.trigger(tileWith('echo.crash'), { type: 'press' })
    await until(() => manager.list()[0]?.status === 'failed')
    expect(logs.some((l) => l.includes('keeps crashing'))).toBe(true)

    await manager.restart('echo')
    expect(manager.list()[0]?.status).toBe('running')
  })

  it('disables and re-enables plugins', async () => {
    const { manager, registry } = await setup()
    await manager.setEnabled('echo', false)
    expect(registry.get('echo.echo')).toBeUndefined()
    expect(manager.list()[0]).toMatchObject({ enabled: false, status: 'stopped' })
    await manager.setEnabled('echo', true)
    expect(registry.get('echo.echo')).toBeDefined()
  })

  it('cleans and passes settings', async () => {
    const schema = {
      type: 'object',
      properties: {
        greeting: { type: 'string', title: 'Greeting', default: 'hi' },
        n: { type: 'number', title: 'N', minimum: 1, maximum: 5 },
      },
    }
    const { manager, root } = await setup({}, (b) =>
      writePlugin(join(b, 'echo'), { settingsSchema: schema }),
    )
    await manager.updateSettings('echo', { greeting: 'yo', n: 99, junk: true })
    expect(manager.list()[0]?.settings).toEqual({ greeting: 'yo' })
    const saved = JSON.parse(await readFile(join(root, 'data', 'plugins.json'), 'utf8'))
    expect(saved.data.plugins.echo.settings).toEqual({ greeting: 'yo' })
  })

  it('skips plugins with a broken manifest', async () => {
    const { manager, logs } = await setup({}, async (b) => {
      await writePlugin(join(b, 'echo'))
      await writePlugin(join(b, 'bad'), { id: 'Bad Id' })
    })
    expect(manager.list().map((p) => p.id)).toEqual(['echo'])
    expect(logs.some((l) => l.includes('Skipped plugin') && l.includes('lowercase'))).toBe(true)
  })

  it('reports a plugin that fails to load', async () => {
    const { manager } = await setup({}, (b) =>
      writePlugin(join(b, 'echo'), {}, 'throw new Error("boom")'),
    )
    await until(
      () => manager.list()[0]?.status === 'crashed' || manager.list()[0]?.status === 'failed',
    )
    expect(manager.list()[0]?.error).toBeTruthy()
  })
})

describe('installing', () => {
  it('asks before installing, copies the folder, and removes it again', async () => {
    const confirm = vi.fn(async () => false)
    const { manager, root, registry } = await setup({ confirmPermissions: confirm }, async () => {})
    const source = join(root, 'source')
    await writePlugin(source, { id: 'third', name: 'Third', permissions: ['network'] })
    await expect(manager.installFolder(source)).rejects.toThrow('Install cancelled.')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ permissions: ['network'] }))

    confirm.mockResolvedValue(true)
    await manager.installFolder(source)
    const installed = join(root, 'data', 'plugins', 'third')
    expect(existsSync(join(installed, 'manifest.json'))).toBe(true)
    expect(registry.get('third.echo')).toBeDefined()
    expect(manager.list()[0]).toMatchObject({ source: 'installed', permissions: ['network'] })

    await manager.remove('third')
    expect(existsSync(installed)).toBe(false)
    expect(registry.get('third.echo')).toBeUndefined()
  })

  it('refuses to replace a built-in plugin', async () => {
    const { manager, root } = await setup()
    const source = join(root, 'source')
    await writePlugin(source)
    await expect(manager.installFolder(source)).rejects.toThrow(/built-in plugin called "echo"/)
  })

  it('installs from a zip with a top folder', async () => {
    const { manager } = await setup({}, async () => {})
    const zip = zipSync({
      'third/manifest.json': strToU8(
        JSON.stringify({
          id: 'third',
          name: 'Third',
          version: '1.0.0',
          apiVersion: 1,
          main: 'index.mjs',
        }),
      ),
      'third/index.mjs': strToU8(FIXTURE),
    })
    expect(await manager.installZip(zip)).toBe('third')
    expect(manager.list()[0]?.status).toBe('running')
  })

  it('refuses zips that would write outside the plugin folder', async () => {
    const { manager } = await setup({}, async () => {})
    const zip = zipSync({ 'manifest.json': strToU8('{}'), '../../evil.txt': strToU8('x') })
    await expect(manager.installZip(zip)).rejects.toThrow(/unsafe file paths/)
  })

  it('loads dev plugins in place and reloads on change', async () => {
    let fire = () => {}
    const { manager, root, registry } = await setup(
      { watch: (_dir, cb) => ((fire = cb), () => {}) },
      async () => {},
    )
    const dev = join(root, 'dev')
    await writePlugin(dev, { id: 'devp', name: 'Dev' })
    await manager.addDev(dev)
    expect(manager.list()[0]).toMatchObject({ source: 'dev', status: 'running' })
    await writeFile(join(dev, 'index.mjs'), FIXTURE.replace("name: 'Echo'", "name: 'Echo 2'"))
    fire()
    await until(() => registry.get('devp.echo')?.name === 'Echo 2')
  })
})

describe('Hub with plugins', () => {
  it('subscribes triggers on the active profile and runs the tile when they fire', async () => {
    const { Hub } = await import('../src/main/hub.ts')
    const root = await mkdtemp(join(tmpdir(), 'tessel-hub-plugins-'))
    const builtin = join(root, 'builtin')
    await writePlugin(join(builtin, 'echo'))
    await mkdir(join(root, 'profiles'))
    const n = (id: string, type: string, params = {}) => ({
      id,
      type,
      params,
      position: { x: 0, y: 0 },
    })
    const profile = {
      id: 'default',
      name: 'P',
      pages: [
        {
          id: 'home',
          name: 'Home',
          tiles: [
            {
              id: 'ticker',
              label: 'Ticker',
              position: { col: 0, row: 0 },
              graph: {
                nodes: [
                  n('t', 'echo.tick', { n: 5 }),
                  n('v', 'data.setVariable', { name: 'got', value: '{{trigger.n}}' }),
                ],
                edges: [
                  { id: 'e', from: { nodeId: 't', port: 'out' }, to: { nodeId: 'v', port: 'in' } },
                ],
              },
            },
          ],
        },
      ],
    }
    await writeFile(
      join(root, 'profiles', 'default.json'),
      JSON.stringify({ schemaVersion: 1, data: profile }),
    )
    await writeFile(
      join(root, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, data: { allowPhones: false } }),
    )
    const hub = new Hub({
      dataDir: root,
      phoneDir: root,
      platform: { os: 'darwin' } as Platform,
      mdns: false,
      addresses: () => [],
      plugins: {
        spawn: forkSpawner(runner),
        builtinDirs: [builtin],
        confirmPermissions: async () => true,
      },
    })
    try {
      await hub.init()
      await until(() => hub.getProfile('default')?.variables['got'] === 5)
      expect(hub.getProfile('default')?.tileState['ticker']).toEqual({ ticked: true })
      expect(hub.state().plugins[0]).toMatchObject({ id: 'echo', status: 'running' })
      expect(hub.blocks().some((b) => b.id === 'echo.echo')).toBe(true)
    } finally {
      await hub.dispose()
    }
  })
})
