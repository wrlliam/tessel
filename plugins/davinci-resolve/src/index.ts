import { execFile } from 'node:child_process'
import { createResolvePlugin } from './plugin.ts'

const run = (python: string, script: string, env: Record<string, string>) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      python,
      ['-c', script],
      { timeout: 55_000, windowsHide: true, env: { ...process.env, ...env } },
      (err, stdout, stderr) =>
        err && !stdout.trim()
          ? reject(
              new Error(
                `${(err as NodeJS.ErrnoException).code ?? ''} ${stderr.trim() || err.message}`,
              ),
            )
          : resolve(stdout),
    ),
  )

export default createResolvePlugin(run, () => process.platform as 'darwin' | 'win32' | 'linux')
