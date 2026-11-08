import { createRegistry, Engine, MemoryVariables, type Platform } from '@tessel/core'
import { build } from 'esbuild'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pluginId, scaffold } from '../index.js'
import { PluginManager } from '../../desktop/src/main/plugins/manager.ts'
import { forkSpawner } from '../../desktop/src/main/plugins/process.ts'

const repo = join(import.meta.dirname, '../../..')

describe('create-tessel-plugin', () => {
  it('makes ids from folder names', () => {
    expect(pluginId('/x/My Cool_Plugin!')).toBe('my-cool-plugin')
    expect(() => pluginId('/x/!')).toThrow(/at least two/)
  })

  it('refuses a non-empty folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tessel-scaffold-'))
    await scaffold(join(dir, 'one'))
    await expect(scaffold(join(dir, 'one'))).rejects.toThrow(/isn't empty/)
  })

  it('scaffolds a plugin that builds, loads in Tessel and runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tessel-scaffold-'))
    const dir = join(root, 'hello-plugin')
    const files = await scaffold(dir, { name: 'Hello plugin' })
    expect(files).toEqual(
      expect.arrayContaining(['manifest.json', 'src/index.ts', 'test/plugin.test.ts', 'README.md']),
    )
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'hello-plugin', name: 'Hello plugin', apiVersion: 1 })

    // Build the generated source the way its package.json does, using this repo's SDK and zod.
    await build({
      entryPoints: [join(dir, 'src/index.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: join(dir, 'dist/index.js'),
      alias: { '@tessel/plugin-sdk': join(repo, 'packages/plugin-sdk/src/index.ts') },
      nodePaths: [join(repo, 'packages/plugin-sdk/node_modules')],
      logLevel: 'silent',
    })

    const registry = createRegistry()
    const manager = new PluginManager({
      dataDir: join(root, 'data'),
      builtinDirs: [root],
      spawn: forkSpawner(join(repo, 'packages/plugin-sdk/src/runner.ts')),
      os: 'darwin',
      registry,
      logger: { info() {}, warn() {}, error() {} },
      confirmPermissions: async () => true,
      onChange() {},
      onEvent() {},
      onTileState() {},
    })
    try {
      await manager.load()
      expect(manager.list()[0]).toMatchObject({
        id: 'hello-plugin',
        status: 'running',
        blockCount: 2,
      })
      expect(registry.get('hello-plugin.every')?.trigger).toBe('plugin')
      const state = new Map<string, unknown>()
      const engine = new Engine({
        registry,
        platform: { os: 'darwin' } as Platform,
        globals: new MemoryVariables(),
        tileState: { get: () => undefined, set: (t, k, v) => void state.set(`${t}:${k}`, v) },
      })
      const result = await engine.trigger(
        {
          id: 'tile',
          graph: {
            nodes: [
              { id: 'p', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
              {
                id: 'h',
                type: 'hello-plugin.hello',
                params: { name: 'Tessel' },
                position: { x: 0, y: 0 },
              },
            ],
            edges: [
              { id: 'e', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 'h', port: 'in' } },
            ],
          },
        },
        { type: 'press' },
      )
      expect(result?.status).toBe('ok')
      expect(state.get('tile:greeting')).toBe('Hello, Tessel!')
    } finally {
      await manager.dispose()
    }
  })
})
