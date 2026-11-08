import { execFileSync } from 'node:child_process'
import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { ACTIONS, createResolvePlugin, scriptingEnv, wrap } from '../src/plugin.ts'

const PY = process.platform === 'win32' ? 'python' : 'python3'

describe('DaVinci Resolve plugin', () => {
  it('points Python at Resolve’s scripting module for each OS', () => {
    expect(scriptingEnv('darwin').PYTHONPATH).toContain(
      '/Library/Application Support/Blackmagic Design',
    )
    expect(scriptingEnv('win32').RESOLVE_SCRIPT_LIB).toContain('fusionscript.dll')
    expect(scriptingEnv('linux').RESOLVE_SCRIPT_API).toBe('/opt/resolve/Developer/Scripting')
  })

  it('passes arguments as data, never as code', () => {
    const tricky = 'a"); import os; ("\\n\u2028'
    const script = wrap('', { name: tricky })
    // Run just the argument-reading part with the real Python.
    const head = script.split('def done')[0] + 'print(json.dumps(args["name"]))'
    const out = execFileSync(PY, ['-c', head], { encoding: 'utf8' })
    expect(JSON.parse(out)).toBe(tricky)
  })

  it('generates valid Python for every action', () => {
    for (const action of Object.values(ACTIONS)) {
      const check = 'import ast, sys; ast.parse(sys.stdin.read())'
      expect(() => execFileSync(PY, ['-c', check], { input: wrap(action, {}) })).not.toThrow()
    }
  })

  it('adds a marker and returns the timecode', async () => {
    const run = vi.fn(async (_py: string, script: string) => {
      expect(script).toContain('AddMarker')
      return 'log line\n{"timecode": "01:00:05:12"}\n'
    })
    const h = createHarness(createResolvePlugin(run, () => 'darwin'))
    await h.load()
    expect(
      await h.run('marker', { color: 'Red', name: '', note: '' }, { name: 'Fix audio' }),
    ).toEqual({
      values: { timecode: '01:00:05:12' },
    })
    expect(run.mock.calls[0]?.[0]).toBe('python3')
    expect(run.mock.calls[0]?.[1]).toContain('Fix audio')
  })

  it('explains when Resolve isn’t answering or Python is missing', async () => {
    const off = createHarness(
      createResolvePlugin(
        async () => '{"error": "noresolve"}',
        () => 'win32',
      ),
    )
    await off.load()
    await expect(off.run('save', {})).rejects.toThrow(/External scripting/)
    const noPy = createHarness(
      createResolvePlugin(
        async () => {
          throw new Error('ENOENT spawn python')
        },
        () => 'win32',
      ),
    )
    await noPy.load()
    await expect(noPy.run('page', { page: 'color' })).rejects.toThrow(/Can't find python/)
  })

  it('keeps project info on the tile', async () => {
    const h = createHarness(
      createResolvePlugin(
        async () =>
          '{"page":"edit","project":"Trip","timeline":"Cut 2","timecode":"01:02:03:04","rendering":false}',
        () => 'darwin',
      ),
    )
    await h.load()
    await h.run('info', {})
    expect(h.tileState.get('timecode')).toBe('01:02:03:04')
    expect(h.tileState.get('project')).toBe('Trip')
  })
})
