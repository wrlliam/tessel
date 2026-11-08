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
  /** Also serve https:// on the same port, with a local certificate phones install once. */
  https: z.boolean().default(false),
  /** Check GitHub for new versions every few hours. */
  autoUpdate: z.boolean().default(true),
  /** Last location a phone shared, for weather tiles. Kept so tiles work before a phone connects. */
  location: z.object({ lat: z.number(), lon: z.number(), at: z.number() }).optional(),
  /** Links that run a tile, for the Shortcuts app and the like. Only a hash of each key is kept. */
  shortcuts: z
    .array(
      z.object({
        id: z.string(),
        profileId: z.string(),
        tileId: z.string(),
        keyHash: z.string(),
        createdAt: z.number(),
      }),
    )
    .default([]),
  /** First-run tour finished or skipped. */
  toured: z.boolean().default(false),
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
