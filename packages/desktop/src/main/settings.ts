import { createJsonStore } from '@tessel/server'
import { z } from 'zod'

export const Settings = z.object({
  allowPhones: z.boolean().default(true),
  port: z.int().min(1024).max(65535).default(4747),
})
export type Settings = z.infer<typeof Settings>

export const SETTINGS_SCHEMA_VERSION = 1

export const settingsStore = (file: string) =>
  createJsonStore({
    file,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    schema: Settings,
    defaults: () => Settings.parse({}),
  })
