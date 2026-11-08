import { z } from 'zod'

export const PLUGIN_API_VERSION = 1

export const Permission = z.enum(['shell', 'network', 'filesystem', 'input', 'native'])
export type Permission = z.infer<typeof Permission>

export const PERMISSION_TEXT: Record<Permission, string> = {
  shell: 'Run programs and shell commands',
  network: 'Connect to the network and the internet',
  filesystem: 'Read and write files',
  input: 'Press keys and move the mouse',
  native: 'Load native code, such as a DLL from another app',
}

const SettingField = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  title: z.string().max(60),
  description: z.string().max(300).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  enum: z.array(z.string()).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** Shown as a password field. */
  secret: z.boolean().optional(),
})
export type SettingField = z.infer<typeof SettingField>

/** A small subset of JSON Schema: a flat object of strings, numbers and booleans. */
export const SettingsSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/), SettingField),
})
export type SettingsSchema = z.infer<typeof SettingsSchema>

export const PluginManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'Use lowercase letters, numbers and dashes'),
  name: z.string().min(1).max(40),
  version: z.string().regex(/^\d+\.\d+\.\d+([-+].*)?$/, 'Use a version like 1.0.0'),
  apiVersion: z.literal(PLUGIN_API_VERSION),
  description: z.string().max(300).default(''),
  author: z.string().max(80).optional(),
  /** Entry file, relative to the plugin folder. */
  main: z
    .string()
    // .ts runs as is (Node strips the types), which suits blocks written in place.
    .regex(/^[^/\\].*\.(js|mjs|ts|mts)$/, 'main must be a .js or .ts file inside the plugin folder')
    .refine((p) => !p.split(/[\\/]/).includes('..'), 'main must stay inside the plugin folder'),
  /** Operating systems the plugin is useful on. Leave out for all. */
  platforms: z.array(z.enum(['darwin', 'win32', 'linux'])).optional(),
  permissions: z.array(Permission).default([]),
  /** A tile icon name or one emoji. */
  icon: z.string().max(32).optional(),
  settingsSchema: SettingsSchema.optional(),
})
export type PluginManifest = z.infer<typeof PluginManifest>

/** Fills defaults and drops unknown or mistyped values. */
export function cleanSettings(
  schema: SettingsSchema | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema?.properties ?? {})) {
    const v = values[key]
    const ok =
      typeof v === field.type &&
      (field.enum === undefined || field.enum.includes(v as string)) &&
      (typeof v !== 'number' ||
        ((field.minimum === undefined || v >= field.minimum) &&
          (field.maximum === undefined || v <= field.maximum)))
    if (ok) out[key] = v
    else if (field.default !== undefined) out[key] = field.default
  }
  return out
}
