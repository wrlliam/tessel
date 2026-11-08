import { describe, expect, it, vi } from 'vitest'
import {
  createCommon,
  expandHome,
  readCapped,
  type CommonDeps,
} from '../src/main/platform/common.ts'

function make(overrides: Partial<CommonDeps> = {}) {
  const deps = {
    shellPolicy: () => 'off' as const,
    confirmShell: vi.fn(async () => true),
    runCommand: vi.fn(async () => ({ code: 0, stdout: 'hi', stderr: '' })),
    fetch: vi.fn(async () => new Response('{"a":1}', { status: 201 })) as unknown as typeof fetch,
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    writeClipboard: vi.fn(async () => {}),
    notify: vi.fn(),
    ...overrides,
  }
  return { deps, common: createCommon(deps) }
}
const signal = new AbortController().signal

describe('shell policy', () => {
  it('refuses when shell commands are off', async () => {
    const { common, deps } = make()
    await expect(common.runShell('ls', signal)).rejects.toThrow(/turned off/)
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('asks first when set to confirm, and respects no', async () => {
    const { common, deps } = make({
      shellPolicy: () => 'confirm',
      confirmShell: vi.fn(async () => false),
    })
    await expect(common.runShell('rm -rf ~', signal)).rejects.toThrow(/chose not to run/)
    expect(deps.confirmShell).toHaveBeenCalledWith('rm -rf ~')
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('runs when allowed', async () => {
    const { common } = make({ shellPolicy: () => 'on' })
    expect(await common.runShell('echo hi', signal)).toEqual({ code: 0, stdout: 'hi', stderr: '' })
  })

  it('runs real commands and reports exit codes', async () => {
    const real = createCommon({
      ...make().deps,
      shellPolicy: () => 'on',
      runCommand: undefined as never,
    })
    const ok = await real.runShell('echo tessel', signal)
    expect(ok.code).toBe(0)
    expect(ok.stdout.trim()).toBe('tessel')
    const failed = await real.runShell('exit 3', signal)
    expect(failed.code).toBe(3)
  })
})

describe('http', () => {
  it('returns status and body', async () => {
    const { common } = make()
    expect(
      await common.http({ method: 'GET', url: 'https://x.test', headers: {}, signal }),
    ).toEqual({ status: 201, body: '{"a":1}' })
  })

  it('explains unreachable hosts', async () => {
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const { common } = make({
      fetch: vi.fn(async () => Promise.reject(err)) as unknown as typeof fetch,
    })
    await expect(
      common.http({ method: 'GET', url: 'https://nope.test/x', headers: {}, signal }),
    ).rejects.toThrow("Couldn't reach nope.test (ENOTFOUND)")
  })

  it('caps response bodies', async () => {
    const body = await readCapped(new Response('x'.repeat(5000)), 1000)
    expect(body).toHaveLength(1000)
  })
})

describe('files and links', () => {
  it('expands ~ and reports open errors', async () => {
    const { common, deps } = make({ openPath: vi.fn(async () => 'No such file') })
    await expect(common.openFile('~/missing.txt')).rejects.toThrow(
      `Couldn't open "~/missing.txt": No such file`,
    )
    expect(deps.openPath).toHaveBeenCalledWith(expandHome('~/missing.txt'))
    expect(expandHome('~/a')).not.toContain('~')
  })
})
