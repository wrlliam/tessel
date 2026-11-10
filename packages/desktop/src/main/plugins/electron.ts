import { PERMISSION_TEXT, type PluginManifest } from '@tessel/plugin-sdk'
import { dialog } from 'electron'
import { watch } from 'node:fs'
import { osName, type OS } from '@tessel/core'
import { forkSpawner, type Spawn } from './process.ts'

/**
 * Each plugin gets its own process, so a crash can't take the app down. It's Tessel's own binary
 * running as plain Node: Electron's utility processes ignore Node's permission flags, which
 * keep a plugin to what its manifest declares.
 */
export const pluginSpawner = (runnerPath: string): Spawn =>
  forkSpawner(runnerPath, {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })

/** Asks before a plugin gets to run, listing what it says it will do. */
export async function confirmPermissions(manifest: PluginManifest): Promise<boolean> {
  const native = manifest.permissions.includes('native')
  const lines = manifest.permissions.length
    ? manifest.permissions.map((p) => `• ${PERMISSION_TEXT[p]}`).join('\n')
    : '• Nothing beyond adding blocks'
  const platforms = manifest.platforms
    ? `\nMade for: ${manifest.platforms.map((p) => osName[p as OS]).join(', ')}.`
    : ''
  const answer = await dialog.showMessageBox({
    type: 'warning',
    message: `Allow the plugin “${manifest.name}” ${manifest.version}?`,
    detail: `${manifest.description}${manifest.author ? `\nBy ${manifest.author}.` : ''}${platforms}\n\nIt says it will:\n${lines}\n\n${native ? "It loads native code, which Tessel can't limit, so it runs with your account's rights. Only allow it if you trust where it came from." : 'Tessel holds it to these: it can read only its own folder unless it asks for files, and can’t start programs unless it asks to. Network access isn’t limited yet.'}`,
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
    // generated.ts is rewritten by Tessel itself, which then reloads My blocks once.
    if (!/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(path) && !/generated\.ts$/.test(path))
      onChange()
  })
  return () => watcher.close()
}
