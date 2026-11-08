import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCommon } from '../src/main/platform/common.ts'
import { runZx } from '../src/main/zx.ts'

const runner = join(import.meta.dirname, '../src/main/zx-runner.ts')
const signal = () => new AbortController().signal

describe('zx scripts', () => {
  it('runs commands with $ and returns the result and printed output', async () => {
    const r = await runZx(
      runner,
      'echo("hello"); const { stdout } = await $`node -e "process.stdout.write(String(6*7))"`; return Number(stdout) + input',
      { input: 1, signal: signal() },
    )
    expect(r).toEqual({ result: 43, output: 'hello' })
  })

  it('has fs, path and os ready', async () => {
    const r = await runZx(
      runner,
      'return path.basename(os.homedir()).length > 0 && typeof fs.readdir',
      {
        signal: signal(),
      },
    )
    expect(r.result).toBe('function')
  })

  it('reports a failing command plainly', async () => {
    await expect(
      runZx(runner, 'await $`node -e "process.exit(3)"`', { signal: signal() }),
    ).rejects.toThrow(/Exit 3/)
  })

  it('stops when the tile stops', async () => {
    const c = new AbortController()
    const p = runZx(runner, 'await sleep(5000)', { signal: c.signal })
    setTimeout(() => c.abort(new Error('Stopped')), 100)
    await expect(p).rejects.toThrow(/Stopped/)
  })

  it('follows the shell commands setting', async () => {
    const zx = vi.fn(async () => ({ result: 1, output: '' }))
    const base = {
      confirmShell: vi.fn(async () => false),
      openExternal: async () => {},
      openPath: async () => '',
      writeClipboard: async () => {},
      notify: () => {},
      zx,
    }
    const off = createCommon({ ...base, shellPolicy: () => 'off' })
    await expect(off.runZx!('return 1', { signal: signal() })).rejects.toThrow(/turned off/)
    const ask = createCommon({ ...base, shellPolicy: () => 'confirm' })
    await expect(ask.runZx!('return 1', { signal: signal() })).rejects.toThrow(/chose not/)
    const on = createCommon({ ...base, shellPolicy: () => 'on' })
    expect(await on.runZx!('return 1', { signal: signal() })).toEqual({ result: 1, output: '' })
    expect(zx).toHaveBeenCalledTimes(1)
  })
})
