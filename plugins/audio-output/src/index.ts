import { execFile } from 'node:child_process'
import { createAudioOutputPlugin } from './plugin.ts'

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) =>
      err
        ? reject(
            new Error(
              `${(err as NodeJS.ErrnoException).code ?? ''} ${stderr.trim() || err.message}`,
            ),
          )
        : resolve(stdout),
    ),
  )

export default createAudioOutputPlugin(run, () => process.platform as 'darwin' | 'win32' | 'linux')
