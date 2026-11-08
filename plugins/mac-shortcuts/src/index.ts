import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShortcutsPlugin } from './plugin.ts'

const run = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      '/usr/bin/shortcuts',
      args,
      { timeout: 115_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) =>
        err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout),
    ),
  )

export default createShortcutsPlugin(run, {
  async temp() {
    const dir = await mkdtemp(join(tmpdir(), 'tessel-shortcut-'))
    const input = join(dir, 'input.txt')
    const output = join(dir, 'output.txt')
    return {
      input,
      output,
      read: () => readFile(output, 'utf8').catch(() => ''),
      write: (text) => writeFile(input, text),
      done: () => rm(dir, { recursive: true, force: true }),
    }
  },
})
