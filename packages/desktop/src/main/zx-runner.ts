// Runs one zx script in its own process: `$` for commands, plus fs, path, os and friends.
// Started by Tessel with the script over IPC; replies once with the result, then exits.
import { $, cd, echo, fs, glob, os, path, retry, sleep, which, within, YAML } from 'zx'

interface Job {
  script: string
  input: unknown
  cwd?: string
}

const send = (m: unknown) => process.send?.(m, () => process.exit(0))
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>

$.verbose = false
if (process.platform === 'win32') {
  // zx needs bash on Windows; fall back to PowerShell when Git Bash isn't installed.
  try {
    await which('bash')
  } catch {
    const { usePowerShell } = await import('zx')
    usePowerShell()
  }
}

process.once('message', async (job: Job) => {
  const lines: string[] = []
  const keep = (...parts: unknown[]) => lines.push(parts.map(String).join(' '))
  console.log = keep
  const say = (...parts: unknown[]) => keep(...parts)
  try {
    if (job.cwd) cd(job.cwd)
    const run = new AsyncFunction(
      '$',
      'cd',
      'within',
      'fs',
      'path',
      'os',
      'echo',
      'sleep',
      'glob',
      'YAML',
      'which',
      'retry',
      'input',
      job.script,
    )
    const result = await run(
      $,
      cd,
      within,
      fs,
      path,
      os,
      say,
      sleep,
      glob,
      YAML,
      which,
      retry,
      job.input,
    )
    const value =
      result && typeof result === 'object' && 'stdout' in result
        ? String((result as { stdout: string }).stdout).trim()
        : result
    send({ ok: true, result: JSON.parse(JSON.stringify(value ?? null)), output: lines.join('\n') })
  } catch (err) {
    const e = err as { stderr?: string; message?: string; exitCode?: number }
    const message = (e.stderr?.trim() || e.message || String(err))
      .split('\n')
      .slice(0, 5)
      .join('\n')
    send({
      ok: false,
      error: e.exitCode !== undefined ? `Exit ${e.exitCode}: ${message}` : message,
    })
  }
})
void echo
