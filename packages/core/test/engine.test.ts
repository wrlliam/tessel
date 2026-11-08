import { describe, expect, it } from 'vitest'
import {
  UnsupportedError,
  defineBlock,
  flowIn,
  flowOut,
  createRegistry,
  type Graph,
} from '../src/index.ts'
import { z } from 'zod'
import { mockPlatform, node, press, setup, tile, wire } from './helpers.ts'

const chain = (...nodes: ReturnType<typeof node>[]): Graph => ({
  nodes,
  edges: nodes
    .slice(1)
    .map((n, i) => wire(`${nodes[i]?.id}.${i === 0 ? 'out' : 'out'}`, `${n.id}.in`)),
})

describe('engine', () => {
  it('returns null when no trigger matches', async () => {
    const { engine } = setup()
    const graph = chain(node('p', 'trigger.press'))
    expect(await engine.trigger(tile(graph), { type: 'release' })).toBeNull()
    expect(await engine.trigger(tile({ nodes: [], edges: [] }), press)).toBeNull()
  })

  it('renders templates from variables', async () => {
    const { engine, platform, globals } = setup()
    globals.set('email', 'me@example.com')
    const graph = chain(
      node('p', 'trigger.press'),
      node('t', 'action.typeText', { text: 'Hi {{var.email}}' }),
    )
    await engine.trigger(tile(graph), press)
    expect(platform.typeText).toHaveBeenCalledWith('Hi me@example.com')
  })

  it('sets and reads global and local variables', async () => {
    const { engine, platform, globals } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('g', 'data.setVariable', { name: 'mood', value: 'calm' }),
        node('l', 'data.setVariable', { name: 'n', scope: 'local', value: '{{2 * 21}}' }),
        node('get', 'data.getVariable', { name: 'mood' }),
        node('t', 'action.typeText', { text: '{{local.n}}' }),
        node('t2', 'action.typeText', {}),
      ],
      edges: [
        wire('p.out', 'g.in'),
        wire('g.out', 'l.in'),
        wire('l.out', 't.in'),
        wire('t.out', 't2.in'),
        wire('get.value', 't2.text'),
      ],
    }
    const result = await engine.trigger(tile(graph), press)
    expect(result?.error).toBeUndefined()
    expect(globals.get('mood')).toBe('calm')
    expect(platform.typeText.mock.calls).toEqual([['42'], ['calm']])
  })

  it('re-reads data blocks so values are fresh', async () => {
    const { engine, platform, globals } = setup()
    globals.set('n', 1)
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('get', 'data.getVariable', { name: 'n' }),
        node('t1', 'action.typeText', {}),
        node('set', 'data.setVariable', { name: 'n', value: 2 }),
        node('t2', 'action.typeText', {}),
      ],
      edges: [
        wire('p.out', 't1.in'),
        wire('t1.out', 'set.in'),
        wire('set.out', 't2.in'),
        wire('get.value', 't1.text'),
        wire('get.value', 't2.text'),
      ],
    }
    await engine.trigger(tile(graph), press)
    expect(platform.typeText.mock.calls).toEqual([['1'], ['2']])
  })

  it('runs fan-out branches in wire order', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('a', 'action.openApp', { app: 'A' }),
        node('b', 'action.openApp', { app: 'B' }),
      ],
      edges: [wire('p.out', 'a.in'), wire('p.out', 'b.in')],
    }
    await engine.trigger(tile(graph), press)
    expect(platform.openApp.mock.calls).toEqual([['A'], ['B']])
  })

  it('stops at the failing block with its message', async () => {
    const { engine, platform } = setup()
    platform.openApp.mockRejectedValueOnce(new Error('Couldn\'t find an app called "Nope"'))
    const graph = chain(
      node('p', 'trigger.press'),
      node('o', 'action.openApp', { app: 'Nope' }),
      node('t', 'action.typeText', { text: 'x' }),
    )
    const result = await engine.trigger(tile(graph), press)
    expect(result).toMatchObject({
      status: 'error',
      error: 'Couldn\'t find an app called "Nope"',
      failedNodeId: 'o',
      nodes: { p: 'ok', o: 'error', t: 'skipped' },
    })
    expect(platform.typeText).not.toHaveBeenCalled()
  })

  it('reports invalid params after templating', async () => {
    const { engine } = setup()
    const graph = chain(
      node('p', 'trigger.press'),
      node('d', 'logic.delay', { ms: '{{var.nope}}x' }),
    )
    const result = await engine.trigger(tile(graph), press)
    expect(result).toMatchObject({ status: 'error', failedNodeId: 'd' })
  })

  it('refuses to run an invalid graph', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [node('p', 'trigger.press'), node('o', 'action.openApp', { app: 'A' })],
      edges: [wire('p.out', 'o.in'), wire('o.out', 'o.in')],
    }
    const result = await engine.trigger(tile(graph), press)
    expect(result?.error).toMatch(/needs fixing.*loop/)
    expect(platform.openApp).not.toHaveBeenCalled()
  })

  it('passes UnsupportedError messages through', async () => {
    const { engine, platform } = setup()
    platform.setDarkMode.mockRejectedValueOnce(new UnsupportedError('Dark mode', 'linux'))
    const graph = chain(
      node('p', 'trigger.press'),
      node('s', 'action.setSetting', { setting: 'darkMode', value: 'true' }),
    )
    expect((await engine.trigger(tile(graph), press))?.error).toBe(
      "Dark mode isn't supported on Linux.",
    )
  })

  it('blocks platform-specific blocks on other OSes', async () => {
    const registry = createRegistry()
    registry.register(
      defineBlock({
        id: 'test.winOnly',
        category: 'plugin',
        name: 'Windows thing',
        description: '',
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({}),
        run: () => {},
      }),
    )
    const { engine } = setup({ registry, platform: mockPlatform('darwin') })
    const result = await engine.trigger(
      tile(chain(node('p', 'trigger.press'), node('w', 'test.winOnly'))),
      press,
    )
    expect(result?.error).toBe("Windows thing isn't available on macOS")
  })

  it('times out long runs', async () => {
    const { engine } = setup({ timeoutMs: 30 })
    const graph = chain(node('p', 'trigger.press'), node('d', 'logic.delay', { ms: 5000 }))
    const result = await engine.trigger(tile(graph), press)
    expect(result).toMatchObject({ status: 'timeout', nodes: { d: 'error' } })
  })

  it('caps steps per run', async () => {
    const { engine } = setup({ maxSteps: 3 })
    const graph = chain(
      node('p', 'trigger.press'),
      node('a', 'logic.delay', { ms: 0 }),
      node('b', 'logic.delay', { ms: 0 }),
      node('c', 'logic.delay', { ms: 0 }),
    )
    const result = await engine.trigger(tile(graph), press)
    expect(result?.error).toMatch(/Stopped after 3 steps/)
  })

  describe('concurrency', () => {
    const slow = chain(
      node('p', 'trigger.press'),
      node('d', 'logic.delay', { ms: 40 }),
      node('o', 'action.openApp', { app: 'X' }),
    )

    it('ignore: drops presses while running', async () => {
      const { engine, platform } = setup()
      const results = await Promise.all([
        engine.trigger(tile(slow, 'ignore'), press),
        engine.trigger(tile(slow, 'ignore'), press),
      ])
      expect(results[1]).toBeNull()
      expect(platform.openApp).toHaveBeenCalledTimes(1)
    })

    it('queue: runs presses one after another', async () => {
      const { engine, platform } = setup()
      const results = await Promise.all([
        engine.trigger(tile(slow), press),
        engine.trigger(tile(slow), press),
      ])
      expect(results.map((r) => r?.status)).toEqual(['ok', 'ok'])
      expect(platform.openApp).toHaveBeenCalledTimes(2)
    })

    it('queue: drops presses beyond the queue limit', async () => {
      const { engine } = setup({ maxQueue: 1 })
      const results = await Promise.all([1, 2, 3].map(() => engine.trigger(tile(slow), press)))
      expect(results.map((r) => r?.status ?? null)).toEqual(['ok', 'ok', null])
    })

    it('restart: cancels the running press', async () => {
      const { engine, platform } = setup()
      const first = engine.trigger(tile(slow, 'restart'), press)
      await new Promise((r) => setTimeout(r, 5))
      const second = engine.trigger(tile(slow, 'restart'), press)
      expect((await first)?.status).toBe('cancelled')
      expect((await second)?.status).toBe('ok')
      expect(platform.openApp).toHaveBeenCalledTimes(1)
    })

    it('cancel stops a running tile', async () => {
      const { engine } = setup()
      const run = engine.trigger(tile(slow), press)
      await new Promise((r) => setTimeout(r, 5))
      expect(engine.isRunning('tile')).toBe(true)
      engine.cancel('tile')
      expect((await run)?.status).toBe('cancelled')
    })
  })
})

describe('condition', () => {
  it('supports and / or / not', async () => {
    const { checkCondition } = await import('../src/index.ts')
    expect(
      checkCondition({
        kind: 'and',
        items: [
          { kind: 'compare', left: 5, op: '>', right: '3' },
          { kind: 'not', item: { kind: 'compare', left: 'Hello', op: 'contains', right: 'xyz' } },
          {
            kind: 'or',
            items: [
              { kind: 'compare', left: '', op: 'empty' },
              { kind: 'compare', left: 1, op: '==', right: 2 },
            ],
          },
        ],
      }),
    ).toBe(true)
    expect(checkCondition({ kind: 'compare', left: 'abc', op: '>', right: 5 })).toBe(false)
  })
})
