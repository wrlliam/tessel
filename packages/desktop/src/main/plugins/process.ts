import type { Message } from '@tessel/plugin-sdk/protocol'
import { fork } from 'node:child_process'

/** A running plugin process, whichever way it was started. */
export interface PluginProcess {
  send(message: Message): void
  onMessage(listener: (message: Message) => void): void
  onExit(listener: (code: number | null) => void): void
  /** Last lines the plugin wrote to stderr, for crash reports. */
  errorOutput(): string
  kill(): void
}

export type Spawn = (pluginDir: string, name: string) => PluginProcess

const keepTail = (text: string, add: string) => (text + add).slice(-2000)

/** Node child process; used in tests and wherever Electron isn't available. */
export const forkSpawner =
  (runnerPath: string): Spawn =>
  (dir) => {
    const child = fork(runnerPath, [dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
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
