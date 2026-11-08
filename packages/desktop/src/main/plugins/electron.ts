import { PERMISSION_TEXT, type PluginManifest } from '@tessel/plugin-sdk'
import type { Message } from '@tessel/plugin-sdk/protocol'
import { dialog, utilityProcess } from 'electron'
import { watch } from 'node:fs'
import { osName, type OS } from '@tessel/core'
import type { Spawn } from './process.ts'

/** Each plugin gets its own Electron utility process, so a crash can't take the app down. */
export const utilitySpawner =
  (runnerPath: string): Spawn =>
  (dir, name) => {
    const child = utilityProcess.fork(runnerPath, [dir], {
      serviceName: `Tessel plugin: ${name}`,
      stdio: 'pipe',
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)))
    return {
      send: (m: Message) => child.postMessage(m),
      onMessage: (l) => child.on('message', (m) => l(m as Message)),
      onExit: (l) => child.on('exit', (code) => l(code)),
      errorOutput: () => stderr,
      kill: () => void child.kill(),
    }
  }

/** Asks before a plugin gets to run, listing what it says it will do. */
export async function confirmPermissions(manifest: PluginManifest): Promise<boolean> {
  const lines = manifest.permissions.length
    ? manifest.permissions.map((p) => `• ${PERMISSION_TEXT[p]}`).join('\n')
    : '• Nothing beyond adding blocks'
  const platforms = manifest.platforms
    ? `\nMade for: ${manifest.platforms.map((p) => osName[p as OS]).join(', ')}.`
    : ''
  const answer = await dialog.showMessageBox({
    type: 'warning',
    message: `Allow the plugin “${manifest.name}” ${manifest.version}?`,
    detail: `${manifest.description}${manifest.author ? `\nBy ${manifest.author}.` : ''}${platforms}\n\nIt says it will:\n${lines}\n\nPlugins run on this computer with your account's rights. Tessel shows what a plugin declares but can't fully sandbox it, so only allow plugins you trust.`,
    buttons: ['Allow', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  return answer.response === 0
}

/** Watches a dev plugin's folder, ignoring dependencies and git. */
export function watchFolder(dir: string, onChange: () => void): () => void {
  const watcher = watch(dir, { recursive: true }, (_event, file) => {
    const path = String(file ?? '')
    if (!/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(path)) onChange()
  })
  return () => watcher.close()
}
