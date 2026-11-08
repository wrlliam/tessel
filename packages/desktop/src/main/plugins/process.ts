import type { Permission } from '@tessel/plugin-sdk'
import type { Message } from '@tessel/plugin-sdk/protocol'
import { fork } from 'node:child_process'
import { dirname } from 'node:path'

/** A running plugin process, whichever way it was started. */
export interface PluginProcess {
  send(message: Message): void
  onMessage(listener: (message: Message) => void): void
  onExit(listener: (code: number | null) => void): void
  /** Last lines the plugin wrote to stderr, for crash reports. */
  errorOutput(): string
  kill(): void
}

export interface SpawnTarget {
  dir: string
  name: string
  permissions: Permission[]
}

export type Spawn = (plugin: SpawnTarget) => PluginProcess

const keepTail = (text: string, add: string) => (text + add).slice(-2000)
/**
 * Node permission-model flags for a plugin. Without extra permissions a plugin can read only its
 * own folder and Tessel's runner, and can't write files, start programs, load native code or
 * start workers. Plugins that load native code can step around these checks, so they run
 * without them, and Tessel says so when asking.
 */
export function sandboxFlags(runnerPath: string, plugin: SpawnTarget): string[] {
  const has = (p: Permission) => plugin.permissions.includes(p)
  if (has('native')) return []
  const flags = [
    '--permission',
    // Module loading resolves real paths by checking every parent folder, which the sandbox
    // would refuse; keep the paths as given instead.
    '--preserve-symlinks',
    '--preserve-symlinks-main',
    `--allow-fs-read=${dirname(runnerPath)}`,
  ]
  if (has('filesystem')) flags.push('--allow-fs-read=*', '--allow-fs-write=*')
  // Dependencies linked from outside (pnpm) still load: access is checked on the linked path.
  else flags.push(`--allow-fs-read=${plugin.dir}`)
  if (has('shell')) flags.push('--allow-child-process')
  // Node versions that can limit the network take this flag; older ones don't limit it at all.
  if (has('network') && process.allowedNodeEnvironmentFlags.has('--allow-net'))
    flags.push('--allow-net')
  return flags
}

export interface ForkOptions {
  /** Defaults to this Node. Inside Electron, Tessel's own binary running as Node. */
  execPath?: string
  env?: NodeJS.ProcessEnv
}

/** Starts each plugin in its own Node process, limited to what its manifest declares. */
export const forkSpawner =
  (runnerPath: string, opts: ForkOptions = {}): Spawn =>
  (plugin) => {
    const child = fork(runnerPath, [plugin.dir], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: sandboxFlags(runnerPath, plugin),
      windowsHide: true,
      ...(opts.execPath && { execPath: opts.execPath }),
      ...(opts.env && { env: opts.env }),
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => (stderr = keepTail(stderr, d.toString())))
    return {
      send: (m) => {
        if (child.connected) child.send(m)
      },
      onMessage: (l) => child.on('message', (m) => l(m as Message)),
      onExit: (l) => child.on('exit', (code) => l(code)),
      errorOutput: () => stderr,
      kill: () => void child.kill(),
    }
  }
