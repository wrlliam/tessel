import { createRegistry, Engine, MemoryVariables, type Graph, type Platform } from '@tessel/core'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  ensureMyBlocks,
  ensurePackage,
  newBlockFile,
  type BlockFiles,
} from '../src/main/custom-blocks.ts'
import { PluginManager } from '../src/main/plugins/manager.ts'
import { forkSpawner } from '../src/main/plugins/process.ts'

const sdk = join(import.meta.dirname, '../../plugin-sdk')
const runner = join(sdk, 'src/runner.ts')

/** The same files the app bundles, read from the repo. */
async function files(): Promise<BlockFiles> {
  const scaffold = join(sdk, 'custom/scaffold')
  const out: BlockFiles = {
    'tessel/index.ts': await readFile(join(sdk, 'custom/index.ts'), 'utf8'),
    'tessel/std.ts': await readFile(join(sdk, 'custom/std.ts'), 'utf8'),
  }
  for (const f of ['index.ts', 'manifest.json', 'package.json', 'tsconfig.json', 'README.md'])
    out[f] = await readFile(join(scaffold, f), 'utf8')
  for (const f of await readdir(join(scaffold, 'blocks')))
    out[`blocks/${f}`] = await readFile(join(scaffold, 'blocks', f), 'utf8')
  return out
}

const managers: PluginManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.dispose()))
})

async function start() {
  const root = await mkdtemp(join(tmpdir(), 'tessel-myblocks-'))
  const dir = await ensureMyBlocks(join(root, 'my-blocks'), await files())
  await ensurePackage(dir, 'zx', dirname(createRequire(import.meta.url).resolve('zx/package.json')))
  const registry = createRegistry()
  const logs: string[] = []
  const manager = new PluginManager({
    dataDir: join(root, 'data'),
    builtinDirs: [],
    spawn: forkSpawner(runner),
    os: 'darwin',
    registry,
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    confirmPermissions: vi.fn(async () => true),
    onChange: () => {},
    onEvent: () => {},
    onTileState: () => {},
  })
  managers.push(manager)
  await manager.load()
  await manager.addDev(dir)
  const globals = new MemoryVariables()
  const engine = new Engine({ registry, platform: { os: 'darwin' } as Platform, globals })
  return { dir, registry, engine, globals, logs }
}

const run = (block: string, params: Record<string, unknown>, extra: Graph['nodes'] = []) => ({
  id: 't',
  concurrency: 'queue' as const,
  graph: {
    nodes: [
      { id: 'p', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
      { id: 'b', type: `my-blocks.${block}`, params, position: { x: 0, y: 0 } },
      ...extra,
    ],
    edges: [{ id: 'e1', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 'b', port: 'in' } }],
  },
})

describe('My blocks', () => {
  it('loads the example blocks from TypeScript files, without a build step', async () => {
    const { registry } = await start()
    const ids = registry
      .list()
      .map((b) => b.id)
      .filter((id) => id.startsWith('my-blocks.'))
    expect(ids).toEqual(
      expect.arrayContaining([
        'my-blocks.after-december',
        'my-blocks.countdown-to',
        'my-blocks.pick-one',
        'my-blocks.web-json',
        'my-blocks.home-assistant-toggle',
        'my-blocks.git-branch',
      ]),
    )
    expect(ids).not.toContain('my-blocks._starter')
    const block = registry.get('my-blocks.after-december')
    expect(block?.outputs.map((o) => o.id)).toEqual(['yes', 'no', 'monthName'])
  })

  it('branches on its own logic and hands values on', async () => {
    const { engine, globals } = await start()
    const graph = (month: number) => {
      const t = run('after-december', { month }, [
        { id: 's', type: 'data.setVariable', params: { name: 'way' }, position: { x: 0, y: 0 } },
        { id: 'n', type: 'data.setVariable', params: { name: 'way' }, position: { x: 0, y: 0 } },
      ])
      t.graph.edges.push(
        { id: 'y', from: { nodeId: 'b', port: 'yes' }, to: { nodeId: 's', port: 'in' } },
        { id: 'n', from: { nodeId: 'b', port: 'no' }, to: { nodeId: 'n', port: 'in' } },
        { id: 'v1', from: { nodeId: 'b', port: 'monthName' }, to: { nodeId: 's', port: 'value' } },
      )
      t.graph.nodes[3]!.params = { name: 'way', value: 'no' }
      return t
    }
    const month = new Date().getMonth() + 1
    await engine.trigger(graph(1), { type: 'press' })
    expect(globals.get('way')).toBe(new Date().toLocaleString('en', { month: 'long' }))
    if (month < 12) {
      await engine.trigger(graph(12), { type: 'press' })
      expect(globals.get('way')).toBe('no')
    }
  })

  it('runs commands with zx from a block', async () => {
    const { engine, globals } = await start()
    const t = run('git-branch', { folder: join(import.meta.dirname, '..') }, [
      { id: 's', type: 'data.setVariable', params: { name: 'branch' }, position: { x: 0, y: 0 } },
    ])
    t.graph.edges.push(
      { id: 'e2', from: { nodeId: 'b', port: 'out' }, to: { nodeId: 's', port: 'in' } },
      { id: 'e3', from: { nodeId: 'b', port: 'branch' }, to: { nodeId: 's', port: 'value' } },
    )
    const r = await engine.trigger(t, { type: 'press' })
    expect(r?.error).toBeUndefined()
    expect(typeof globals.get('branch')).toBe('string')
    expect(String(globals.get('branch')).length).toBeGreaterThan(0)
  })

  it('checks params like the inspector shows them', async () => {
    const { engine } = await start()
    const r = await engine.trigger(run('after-december', { month: 13 }), { type: 'press' })
    expect(r?.error).toMatch(/at most 12/)
  })

  it('skips a broken file and says why, keeping the others', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tessel-myblocks-'))
    const dir = await ensureMyBlocks(join(root, 'my-blocks'), await files())
    await writeFile(join(dir, 'blocks', 'broken.ts'), 'export default 42\n')
    await writeFile(join(dir, 'blocks', 'git-branch.ts'), '// no zx here\nexport default 1\n')
    const registry = createRegistry()
    const logs: string[] = []
    const manager = new PluginManager({
      dataDir: join(root, 'data'),
      builtinDirs: [],
      spawn: forkSpawner(runner),
      os: 'darwin',
      registry,
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
      confirmPermissions: vi.fn(async () => true),
      onChange: () => {},
      onEvent: () => {},
      onTileState: () => {},
    })
    managers.push(manager)
    await manager.load()
    await manager.addDev(dir)
    expect(registry.get('my-blocks.pick-one')).toBeDefined()
    expect(registry.get('my-blocks.broken')).toBeUndefined()
    expect(logs.some((l) => l.includes('Skipped blocks/broken.ts'))).toBe(true)
  })

  it('adds a new block from the starter', async () => {
    const { dir, registry } = await start()
    const file = await newBlockFile(dir, 'Shout it', (await files())['blocks/_starter.ts']!)
    expect(file.endsWith(join('blocks', 'shout-it.ts'))).toBe(true)
    expect(await readFile(file, 'utf8')).toContain('name: "Shout it"')
    expect(registry.get('my-blocks.after-december')).toBeDefined()
  })

  it('keeps the person’s files but refreshes Tessel’s own', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tessel-myblocks-'))
    const f = await files()
    const dir = await ensureMyBlocks(join(root, 'mb'), f)
    await writeFile(join(dir, 'blocks', 'pick-one.ts'), '// mine')
    await writeFile(join(dir, 'tessel', 'std.ts'), '// stale')
    await ensureMyBlocks(dir, f)
    expect(await readFile(join(dir, 'blocks', 'pick-one.ts'), 'utf8')).toBe('// mine')
    expect(await readFile(join(dir, 'tessel', 'std.ts'), 'utf8')).toBe(f['tessel/std.ts'])
  })
})
