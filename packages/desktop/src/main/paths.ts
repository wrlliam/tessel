import { app } from 'electron'
import { join } from 'node:path'

/** Bundled read-only files (icons). */
export const resource = (name: string) =>
  app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)

/** The built phone client the server hands to phones. */
export const phoneDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'phone') : join(app.getAppPath(), '../phone/dist')

/** Built JS entry that plugin processes start from (an electron-vite main entry). */
export const pluginRunner = () => join(import.meta.dirname, 'plugin-runner.js')
export const zxRunner = () => join(import.meta.dirname, 'zx-runner.js')

/** First-party plugins: the repo's plugins folder in development, bundled resources when packaged. */
export const builtinPluginsDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'plugins') : join(app.getAppPath(), '../../plugins')
