import { execFile, spawn } from 'node:child_process'

export interface ExecResult {
  stdout: string
  stderr: string
}

export class ExecError extends Error {
  constructor(
    message: string,
    readonly code: string | number | undefined,
    readonly stderr: string,
  ) {
    super(message)
  }
}

/** Runs a program without a shell, so arguments are never interpreted. */
export type Run = (cmd: string, args: string[]) => Promise<ExecResult>
/** Starts a program and doesn't wait for it. */
export type Launch = (cmd: string, args: string[]) => void

export const run: Run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          reject(new ExecError(stderr.trim() || err.message, code, stderr))
        } else resolve({ stdout, stderr })
      },
    )
  })

export const launch: Launch = (cmd, args) => {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

export const isMissingProgram = (err: unknown) => err instanceof ExecError && err.code === 'ENOENT'
