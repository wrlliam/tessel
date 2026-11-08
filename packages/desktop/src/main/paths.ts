import { app } from 'electron'
import { join } from 'node:path'

/** Bundled read-only files (icons). */
export const resource = (name: string) =>
  app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)

/** The built phone client the server hands to phones. */
export const phoneDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'phone') : join(app.getAppPath(), '../phone/dist')
