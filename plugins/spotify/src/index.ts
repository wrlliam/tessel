import { execFile } from 'node:child_process'
import { createSpotifyPlugin } from './plugin.ts'

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout),
    ),
  )

export default createSpotifyPlugin(run, () => process.platform as 'darwin' | 'win32' | 'linux')
