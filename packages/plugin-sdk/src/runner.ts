// Entry point of a plugin process: loads the plugin folder given as the first argument and talks to Tessel.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Message } from './protocol.ts'
import { runPlugin, type Transport } from './runtime.ts'
import type { PluginDefinition } from './types.ts'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

function transport(): Transport {
  // Electron utility processes get a parentPort; Node child processes use process.send.
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (parentPort) {
    return {
      send: (m) => parentPort.postMessage(m),
      onMessage: (listener) => parentPort.on('message', (e) => listener(e.data as Message)),
    }
  }
  if (process.send) {
    return {
      send: (m) => process.send?.(m),
      onMessage: (listener) => process.on('message', (m) => listener(m as Message)),
    }
  }
  throw new Error('Plugin runner must be started by Tessel')
}

const dir = process.argv[2]
if (!dir) throw new Error('Missing plugin folder')
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { main: string }
const mod = (await import(pathToFileURL(join(dir, manifest.main)).href)) as {
  default?: PluginDefinition
}
if (!mod.default)
  throw new Error(`${manifest.main} has no default export. Export definePlugin({...}).`)
runPlugin(mod.default, transport(), () => process.exit(0))
