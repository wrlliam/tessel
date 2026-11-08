import { describe, expect, it, vi } from 'vitest'
import { cronError } from '../src/engine/blocks/triggers.ts'
import { parseHeaders } from '../src/engine/blocks/actions.ts'
import type { Graph, GraphNode } from '../src/index.ts'
import { node, press, setup, tile, wire } from './helpers.ts'

const one = (n: GraphNode): Graph => ({
  nodes: [node('p', 'trigger.press'), n],
  edges: [wire('p.out', `${n.id}.in`)],
})

describe('Set setting', () => {
  it.each([
    [{ setting: 'darkMode', value: 'toggle' }, 'setDarkMode', 'toggle'],
    [{ setting: 'mute', value: 'false' }, 'setMuted', false],
    [{ setting: 'volume', level: '35' }, 'setVolume', 35],
    [{ setting: 'brightness', level: 80 }, 'setBrightness', 80],
  ] as const)('%j', async (params, method, arg) => {
    const { engine, platform } = setup()
    await engine.trigger(tile(one(node('s', 'action.setSetting', params))), press)
    expect(platform[method]).toHaveBeenCalledWith(arg)
  })

  it('asks for a level for volume', async () => {
    const { engine } = setup()
    const result = await engine.trigger(
      tile(one(node('s', 'action.setSetting', { setting: 'volume' }))),
      press,
    )
    expect(result?.error).toContain('Set a level')
  })
})

describe('actions', () => {
  it('refuses a URL without a scheme', async () => {
    const { engine, platform } = setup()
    const result = await engine.trigger(
      tile(one(node('u', 'action.openUrl', { url: 'example.com' }))),
      press,
    )
    expect(result?.error).toMatch(/full link/)
    expect(platform.openUrl).not.toHaveBeenCalled()
  })

  it('runs shell commands and exposes output', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('sh', 'action.runShell', { command: 'echo hello', failOnError: true }),
        node('t', 'action.typeText', {}),
      ],
      edges: [wire('p.out', 'sh.in'), wire('sh.out', 't.in'), wire('sh.stdout', 't.text')],
    }
    await engine.trigger(tile(graph), press)
    expect(platform.typeText).toHaveBeenCalledWith('hello')
  })

  it('stops on a failing command when asked', async () => {
    const { engine, platform } = setup()
    platform.runShell.mockResolvedValueOnce({ code: 2, stdout: '', stderr: 'nope' })
    const result = await engine.trigger(
      tile(one(node('sh', 'action.runShell', { command: 'x', failOnError: true }))),
      press,
    )
    expect(result?.error).toBe('Command failed (exit 2): nope')
  })

  it('makes HTTP requests and parses JSON', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('h', 'action.http', {
          method: 'POST',
          url: 'https://x.test/hook',
          headers: 'A: 1\nB: two',
          body: '{}',
          failOnError: true,
        }),
        node('t', 'action.typeText', { text: '{{input.text}}' }),
        node('txt', 'data.text', { template: 'ok={{input.a.ok}}' }),
      ],
      edges: [
        wire('p.out', 'h.in'),
        wire('h.out', 't.in'),
        wire('h.json', 'txt.a'),
        wire('txt.text', 't.text'),
      ],
    }
    const result = await engine.trigger(tile(graph), press)
    expect(result?.status).toBe('ok')
    expect(platform.http).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', headers: { A: '1', B: 'two' }, body: '{}' }),
    )
    expect(platform.typeText).toHaveBeenCalledWith('ok=true')
  })

  it('treats 4xx replies as failures when asked', async () => {
    const { engine, platform } = setup()
    platform.http.mockResolvedValueOnce({ status: 404, body: '' })
    const result = await engine.trigger(
      tile(
        one(
          node('h', 'action.http', {
            method: 'GET',
            url: 'https://x.test',
            headers: '',
            body: '',
            failOnError: true,
          }),
        ),
      ),
      press,
    )
    expect(result?.error).toBe('The server replied 404')
  })

  it('parses header lines', () => {
    expect(parseHeaders('Authorization: Bearer a:b\n\nbad line\nX-Y:1')).toEqual({
      Authorization: 'Bearer a:b',
      'X-Y': '1',
    })
  })

  it('switches pages through the host', async () => {
    const onSwitchPage = vi.fn()
    const { engine } = setup({ onSwitchPage })
    await engine.trigger(tile(one(node('s', 'action.switchPage', { page: 'p2' }))), press)
    expect(onSwitchPage).toHaveBeenCalledWith('p2')
  })
})

describe('Run another tile', () => {
  const tiles: Record<string, { id: string; graph: Graph }> = {}
  const findTile = (id: string) => tiles[id]
  tiles['a'] = { id: 'a', graph: one(node('r', 'action.runTile', { tile: 'b' })) }
  tiles['b'] = { id: 'b', graph: one(node('o', 'action.openApp', { app: 'B' })) }
  tiles['loop1'] = { id: 'loop1', graph: one(node('r', 'action.runTile', { tile: 'loop2' })) }
  tiles['loop2'] = { id: 'loop2', graph: one(node('r', 'action.runTile', { tile: 'loop1' })) }

  it('presses the other tile and waits for it', async () => {
    const { engine, platform } = setup({ findTile })
    const result = await engine.trigger(tiles['a']!, press)
    expect(result?.status).toBe('ok')
    expect(platform.openApp).toHaveBeenCalledWith('B')
  })

  it('refuses tiles that run each other in a circle', async () => {
    const { engine } = setup({ findTile })
    const result = await engine.trigger(tiles['loop1']!, press)
    expect(result?.error).toMatch(/circle/)
  })
})

describe('logic', () => {
  it('Switch picks the first matching case, else falls through', async () => {
    const graph = (value: string): Graph => ({
      nodes: [
        node('p', 'trigger.press'),
        node('s', 'logic.switch', { value, case1: 'a', case2: '2', case3: '', case4: '' }),
        node('one', 'action.openApp', { app: 'one' }),
        node('two', 'action.openApp', { app: 'two' }),
        node('other', 'action.openApp', { app: 'other' }),
      ],
      edges: [
        wire('p.out', 's.in'),
        wire('s.case1', 'one.in'),
        wire('s.case2', 'two.in'),
        wire('s.else', 'other.in'),
      ],
    })
    const { engine, platform } = setup()
    for (const v of ['a', '2', '', 'zzz']) await engine.trigger(tile(graph(v)), press)
    expect(platform.openApp.mock.calls.flat()).toEqual(['one', 'two', 'other', 'other'])
  })

  it('Toggle flips each run and remembers it per tile', async () => {
    const store = new Map<string, unknown>()
    const tileState = {
      get: (t: string, k: string) => store.get(`${t}:${k}`),
      set: (t: string, k: string, v: unknown) => void store.set(`${t}:${k}`, v),
    }
    const { engine, platform } = setup({ tileState })
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('t', 'logic.toggle', { key: 'on' }),
        node('on', 'action.setSetting', { setting: 'mute', value: true }),
        node('off', 'action.setSetting', { setting: 'mute', value: false }),
      ],
      edges: [wire('p.out', 't.in'), wire('t.on', 'on.in'), wire('t.off', 'off.in')],
    }
    for (let i = 0; i < 3; i++) await engine.trigger(tile(graph), press)
    expect(platform.setMuted.mock.calls.flat()).toEqual([true, false, true])
    expect(store.get('tile:on')).toBe(true)
  })

  it('Repeat runs the body N times with an index, then carries on', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('r', 'logic.repeat', { times: 3 }),
        node('t', 'action.typeText', {}),
        node('end', 'action.openApp', { app: 'Done' }),
      ],
      edges: [
        wire('p.out', 'r.in'),
        wire('r.body', 't.in'),
        wire('r.index', 't.text'),
        wire('r.done', 'end.in'),
      ],
    }
    const result = await engine.trigger(tile(graph), press)
    expect(result?.status).toBe('ok')
    expect(platform.typeText.mock.calls.flat()).toEqual(['0', '1', '2'])
    expect(platform.openApp).toHaveBeenCalledWith('Done')
  })

  it('Repeat still respects the step cap', async () => {
    const { engine } = setup({ maxSteps: 20 })
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('r', 'logic.repeat', { times: 100 }),
        node('d', 'logic.delay', { ms: 0 }),
      ],
      edges: [wire('p.out', 'r.in'), wire('r.body', 'd.in')],
    }
    expect((await engine.trigger(tile(graph), press))?.error).toMatch(/Stopped after 20 steps/)
  })

  it('Wait until re-checks fresh values', async () => {
    const { engine, globals } = setup()
    setTimeout(() => globals.set('ready', true), 60)
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('w', 'logic.waitUntil', {
          condition: { kind: 'compare', left: '{{var.ready}}', op: '==', right: true },
          everyMs: 50,
          timeoutMs: 2000,
        }),
        node('ok', 'action.openApp', { app: 'ok' }),
      ],
      edges: [wire('p.out', 'w.in'), wire('w.out', 'ok.in')],
    }
    const result = await engine.trigger(tile(graph), press)
    expect(result?.nodes['ok']).toBe('ok')
  })

  it('Wait until gives up after its timeout', async () => {
    const { engine } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('w', 'logic.waitUntil', {
          condition: { kind: 'compare', left: 1, op: '==', right: 2 },
          everyMs: 50,
          timeoutMs: 120,
        }),
        node('late', 'action.openApp', { app: 'late' }),
      ],
      edges: [wire('p.out', 'w.in'), wire('w.timeout', 'late.in')],
    }
    expect((await engine.trigger(tile(graph), press))?.nodes['late']).toBe('ok')
  })

  it('Compare feeds If', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [
        node('p', 'trigger.press'),
        node('c', 'logic.compare', { a: 5, op: '>', b: 3 }),
        node('i', 'logic.if', {
          condition: { kind: 'compare', left: '{{input.a}}', op: '==', right: true },
        }),
        node('y', 'action.openApp', { app: 'yes' }),
      ],
      edges: [wire('p.out', 'i.in'), wire('c.result', 'i.a'), wire('i.yes', 'y.in')],
    }
    await engine.trigger(tile(graph), press)
    expect(platform.openApp).toHaveBeenCalledWith('yes')
  })
})

describe('data', () => {
  const typed = async (source: GraphNode, port: string) => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [node('p', 'trigger.press'), source, node('t', 'action.typeText', {})],
      edges: [wire('p.out', 't.in'), wire(`${source.id}.${port}`, 't.text')],
    }
    const result = await engine.trigger(tile(graph), press)
    return { result, text: platform.typeText.mock.calls[0]?.[0] }
  }

  it('Math', async () => {
    expect(
      (await typed(node('m', 'data.math', { op: 'multiply', a: 6, b: '7' }), 'result')).text,
    ).toBe('42')
    expect((await typed(node('m', 'data.math', { op: 'round', a: 2.6 }), 'result')).text).toBe('3')
    expect(
      (await typed(node('m', 'data.math', { op: 'divide', a: 1, b: 0 }), 'result')).result?.error,
    ).toMatch(/dividing by zero/)
  })

  it('Text', async () => {
    expect((await typed(node('x', 'data.text', { template: 'a{{1+1}}b' }), 'text')).text).toBe(
      'a2b',
    )
  })

  it('Random stays in range', async () => {
    const { text } = await typed(node('r', 'data.random', { min: 3, max: 3 }), 'value')
    expect(text).toBe('3')
  })
})

describe('triggers', () => {
  it('validates cron patterns', () => {
    expect(cronError('0 9 * * 1-5')).toBeUndefined()
    expect(cronError('every day')).toMatch(/five, six, or seven/)
  })

  it('starts only the schedule that fired', async () => {
    const { engine, platform } = setup()
    const graph: Graph = {
      nodes: [
        node('s1', 'trigger.schedule', { cron: '0 9 * * *' }),
        node('s2', 'trigger.schedule', { cron: '0 17 * * *' }),
        node('a', 'action.openApp', { app: 'morning' }),
        node('b', 'action.openApp', { app: 'evening' }),
      ],
      edges: [wire('s1.out', 'a.in'), wire('s2.out', 'b.in')],
    }
    await engine.trigger(tile(graph), { type: 'schedule', nodeId: 's2' })
    expect(platform.openApp.mock.calls.flat()).toEqual(['evening'])
  })
})
