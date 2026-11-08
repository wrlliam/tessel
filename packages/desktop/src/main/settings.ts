import { PhoneSettings } from '@tessel/core'
import { createJsonStore } from '@tessel/server'
import { z } from 'zod'

export const Settings = z.object({
  allowPhones: z.boolean().default(true),
  port: z.int().min(1024).max(65535).default(4747),
  /** Run shell command blocks: off (default), ask every time, or allowed. */
  shell: z.enum(['off', 'confirm', 'on']).default('off'),
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  /** Lowest level kept in the activity log. */
  logLevel: z.enum(['info', 'warn', 'error']).default('info'),
  /** Sent to every connected phone. */
  phone: PhoneSettings.default(PhoneSettings.parse({})),
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
