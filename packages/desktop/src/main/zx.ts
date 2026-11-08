// Runs zx scripts for the Run a zx script block, each in its own short-lived process.
import { fork } from 'node:child_process'

export interface ZxResult {
  result: unknown
  output: string
}

export interface ZxOptions {
  input?: unknown
  cwd?: string
  signal: AbortSignal
  /** Inside Electron: Tessel's own binary running as Node. */
  execPath?: string
  env?: NodeJS.ProcessEnv
}

export function runZx(runnerPath: string, script: string, opts: ZxOptions): Promise<ZxResult> {
  return new Promise((resolve, reject) => {
    const child = fork(runnerPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      ...(opts.execPath && { execPath: opts.execPath }),
      ...(opts.env && { env: opts.env }),
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
    const abort = () => {
      child.kill()
      reject(opts.signal.reason as Error)
    }
    opts.signal.addEventListener('abort', abort, { once: true })
    child.on('message', (m: { ok: boolean; result?: unknown; output?: string; error?: string }) => {
      opts.signal.removeEventListener('abort', abort)
      if (m.ok) resolve({ result: m.result, output: m.output ?? '' })
      else reject(new Error(m.error ?? 'The script failed'))
    })
    child.on('exit', (code) => {
      opts.signal.removeEventListener('abort', abort)
      reject(new Error(stderr.trim().split('\n').at(-1) || `The script stopped (exit ${code})`))
    })
    child.send({ script, input: opts.input ?? null, ...(opts.cwd && { cwd: opts.cwd }) })
  })
}
