import { z } from 'zod'
import { defineBlock, flowIn, flowOut } from '../block.ts'
import { parseCombo, resolveCombo } from '../combo.ts'
import { toBool } from '../expression.ts'
import { appCommand } from './apps.ts'

const text = (message: string) => z.string().trim().min(1, message)
const bool = z.preprocess(
  (v) => (typeof v === 'string' || typeof v === 'number' ? toBool(v) : v),
  z.boolean(),
)

export const openApp = defineBlock({
  id: 'action.openApp',
  category: 'action',
  name: 'Open app',
  description: 'Opens an app by name, e.g. Discord, or by path.',
  inputs: [flowIn, { id: 'app', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({ app: text('Choose an app to open') }),
  fields: [
    { key: 'app', label: 'App', widget: 'text', placeholder: 'Discord', help: 'Name or full path' },
  ],
  defaults: { app: '' },
  run: (ctx, { app }) => ctx.platform.openApp(app),
})

export const typeText = defineBlock({
  id: 'action.typeText',
  category: 'action',
  name: 'Type text',
  description: 'Types text into whatever has focus.',
  inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    text: z.preprocess(
      (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v),
      z.string().max(10_000),
    ),
  }),
  fields: [{ key: 'text', label: 'Text', widget: 'textarea', placeholder: 'Hello {{var.name}}' }],
  defaults: { text: '' },
  run: (ctx, { text }) => ctx.platform.typeText(text),
})

export const keyCombo = defineBlock({
  id: 'action.keyCombo',
  category: 'action',
  name: 'Key combo',
  description: 'Presses a shortcut. Use "mod" for Cmd on macOS and Ctrl elsewhere.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({
    combo: z.string().transform((s, ctx) => {
      try {
        return parseCombo(s)
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message })
        return z.NEVER
      }
    }),
  }),
  fields: [{ key: 'combo', label: 'Shortcut', widget: 'combo', placeholder: 'mod+shift+s' }],
  defaults: { combo: '' },
  run: (ctx, { combo }) => ctx.platform.pressCombo(resolveCombo(combo, ctx.platform.os)),
})

const onOffToggle = z.preprocess(
  (v) => (v === 'toggle' ? v : typeof v === 'string' || typeof v === 'number' ? toBool(v) : v),
  z.union([z.boolean(), z.literal('toggle')]),
)
const level = z.coerce.number().min(0, 'Use 0 to 100').max(100, 'Use 0 to 100')

export const setSetting = defineBlock({
  id: 'action.setSetting',
  category: 'action',
  name: 'Set setting',
  description: 'Changes a system setting: dark mode, mute, volume or brightness.',
  inputs: [
    flowIn,
    { id: 'value', kind: 'value', type: 'boolean' },
    { id: 'level', kind: 'value', type: 'number' },
  ],
  outputs: [flowOut],
  paramsSchema: z
    .object({
      setting: z.enum(['darkMode', 'mute', 'volume', 'brightness']),
      value: onOffToggle.optional(),
      level: level.optional(),
    })
    .superRefine((p, ctx) => {
      const needsLevel = p.setting === 'volume' || p.setting === 'brightness'
      if (needsLevel && p.level === undefined)
        ctx.addIssue({ code: 'custom', path: ['level'], message: 'Set a level from 0 to 100' })
      if (!needsLevel && p.value === undefined)
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'Choose on, off or toggle' })
    }),
  fields: [
    {
      key: 'setting',
      label: 'Setting',
      widget: 'select',
      options: [
        { value: 'darkMode', label: 'Dark mode' },
        { value: 'mute', label: 'Mute sound' },
        { value: 'volume', label: 'Volume' },
        { value: 'brightness', label: 'Screen brightness' },
      ],
    },
    {
      key: 'value',
      label: 'Turn',
      widget: 'select',
      options: [
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
        { value: 'toggle', label: 'Toggle' },
      ],
      when: { key: 'setting', is: ['darkMode', 'mute'] },
    },
    {
      key: 'level',
      label: 'Level (0 to 100)',
      widget: 'number',
      placeholder: '50',
      when: { key: 'setting', is: ['volume', 'brightness'] },
    },
  ],
  defaults: { setting: 'darkMode', value: true, level: 50 },
  run: (ctx, { setting, value, level: amount }) => {
    switch (setting) {
      case 'darkMode':
        return ctx.platform.setDarkMode(value ?? 'toggle')
      case 'mute':
        return ctx.platform.setMuted(value ?? 'toggle')
      case 'volume':
        return ctx.platform.setVolume(Math.round(amount ?? 50))
      case 'brightness':
        return ctx.platform.setBrightness(Math.round(amount ?? 50))
    }
  },
})

const noParams = { paramsSchema: z.object({}), fields: [], defaults: {} }

export const lockScreen = defineBlock({
  id: 'action.lockScreen',
  category: 'action',
  name: 'Lock screen',
  description: 'Locks the computer.',
  inputs: [flowIn],
  outputs: [flowOut],
  ...noParams,
  run: (ctx) => ctx.platform.lockScreen(),
})

export const sleepComputer = defineBlock({
  id: 'action.sleep',
  category: 'action',
  name: 'Sleep',
  description: 'Puts the computer to sleep. Phones disconnect until it wakes.',
  inputs: [flowIn],
  outputs: [flowOut],
  ...noParams,
  run: (ctx) => ctx.platform.sleep(),
})

export const openUrl = defineBlock({
  id: 'action.openUrl',
  category: 'action',
  name: 'Open URL',
  description: 'Opens a link in its default app, e.g. a website in your browser.',
  inputs: [flowIn, { id: 'url', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    url: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9+.-]*:\S+$/i, 'Use a full link, like https://example.com'),
  }),
  fields: [{ key: 'url', label: 'Link', widget: 'text', placeholder: 'https://example.com' }],
  defaults: { url: 'https://' },
  run: (ctx, { url }) => ctx.platform.openUrl(url),
})

export const openFile = defineBlock({
  id: 'action.openFile',
  category: 'action',
  name: 'Open file',
  description: 'Opens a file or folder in its default app.',
  inputs: [flowIn, { id: 'path', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({ path: text('Choose a file or folder') }),
  fields: [{ key: 'path', label: 'Path', widget: 'text', placeholder: '~/Documents/notes.txt' }],
  defaults: { path: '' },
  run: (ctx, { path }) => ctx.platform.openFile(path),
})

export const mediaKey = defineBlock({
  id: 'action.mediaKey',
  category: 'action',
  name: 'Media key',
  description: 'Presses a media key, like play/pause.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({
    key: z.enum(['playPause', 'next', 'previous', 'stop', 'volumeUp', 'volumeDown', 'mute']),
  }),
  fields: [
    {
      key: 'key',
      label: 'Key',
      widget: 'select',
      options: [
        { value: 'playPause', label: 'Play / pause' },
        { value: 'next', label: 'Next track' },
        { value: 'previous', label: 'Previous track' },
        { value: 'stop', label: 'Stop' },
        { value: 'volumeUp', label: 'Volume up' },
        { value: 'volumeDown', label: 'Volume down' },
        { value: 'mute', label: 'Mute' },
      ],
    },
  ],
  defaults: { key: 'playPause' },
  run: (ctx, { key }) => ctx.platform.mediaKey(key),
})

export const mouse = defineBlock({
  id: 'action.mouse',
  category: 'action',
  name: 'Mouse',
  description: 'Clicks, or moves the pointer to a point on screen.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({
    action: z.enum(['click', 'doubleClick', 'rightClick', 'middleClick', 'move']),
    x: z.coerce.number().int().min(0).default(0),
    y: z.coerce.number().int().min(0).default(0),
  }),
  fields: [
    {
      key: 'action',
      label: 'Action',
      widget: 'select',
      options: [
        { value: 'click', label: 'Click' },
        { value: 'doubleClick', label: 'Double-click' },
        { value: 'rightClick', label: 'Right-click' },
        { value: 'middleClick', label: 'Middle-click' },
        { value: 'move', label: 'Move to' },
      ],
    },
    {
      key: 'x',
      label: 'X (pixels from left)',
      widget: 'number',
      when: { key: 'action', is: ['move'] },
    },
    {
      key: 'y',
      label: 'Y (pixels from top)',
      widget: 'number',
      when: { key: 'action', is: ['move'] },
    },
  ],
  defaults: { action: 'click', x: 0, y: 0 },
  run: (ctx, { action, x, y }) =>
    ctx.platform.mouse(action === 'move' ? { kind: 'move', x, y } : { kind: action }),
})

export const setClipboard = defineBlock({
  id: 'action.setClipboard',
  category: 'action',
  name: 'Set clipboard',
  description: 'Copies text, ready to paste.',
  inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    text: z.preprocess(
      (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v),
      z.string().max(100_000),
    ),
  }),
  fields: [{ key: 'text', label: 'Text', widget: 'textarea' }],
  defaults: { text: '' },
  run: (ctx, { text }) => ctx.platform.setClipboard(text),
})

export const notify = defineBlock({
  id: 'action.notify',
  category: 'action',
  name: 'Notification',
  description: 'Shows a desktop notification.',
  inputs: [flowIn, { id: 'body', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    title: z.string().max(100),
    body: z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(1000)),
  }),
  fields: [
    { key: 'title', label: 'Title', widget: 'text', placeholder: 'Tessel' },
    { key: 'body', label: 'Message', widget: 'textarea', placeholder: 'Done.' },
  ],
  defaults: { title: 'Tessel', body: '' },
  run: (ctx, { title, body }) => ctx.platform.notify(title || 'Tessel', body),
})

export const runShell = defineBlock({
  id: 'action.runShell',
  category: 'action',
  name: 'Run shell command',
  description: 'Runs a command in your shell. Off until you allow shell commands in Settings.',
  inputs: [flowIn],
  outputs: [
    flowOut,
    { id: 'stdout', kind: 'value', type: 'string', label: 'output' },
    { id: 'code', kind: 'value', type: 'number', label: 'exit code' },
  ],
  paramsSchema: z.object({ command: text('Enter a command'), failOnError: bool }),
  fields: [
    { key: 'command', label: 'Command', widget: 'textarea', placeholder: 'echo hello' },
    { key: 'failOnError', label: 'Stop the tile if the command fails', widget: 'toggle' },
  ],
  defaults: { command: '', failOnError: true },
  run: async (ctx, { command, failOnError }) => {
    const result = await ctx.platform.runShell(command, ctx.signal)
    if (failOnError && result.code !== 0) {
      throw new Error(
        `Command failed (exit ${result.code})${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 300)}` : ''}`,
      )
    }
    return { values: { stdout: result.stdout.replace(/\n$/, ''), code: result.code } }
  },
})

/** "Key: value" lines, one per header. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export const httpRequest = defineBlock({
  id: 'action.http',
  category: 'action',
  name: 'HTTP request',
  description: 'Calls a web address, e.g. a smart-home webhook. Responses over 1 MB are cut short.',
  inputs: [flowIn, { id: 'body', kind: 'value', type: 'string' }],
  outputs: [
    flowOut,
    { id: 'status', kind: 'value', type: 'number' },
    { id: 'body', kind: 'value', type: 'string' },
    { id: 'json', kind: 'value', type: 'any' },
  ],
  paramsSchema: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/i, 'Use a full web address starting with http:// or https://'),
    headers: z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(4000)),
    body: z.preprocess(
      (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)),
      z.string().max(100_000),
    ),
    failOnError: bool,
  }),
  fields: [
    {
      key: 'method',
      label: 'Method',
      widget: 'select',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m })),
    },
    { key: 'url', label: 'Address', widget: 'text', placeholder: 'https://example.com/hook' },
    {
      key: 'headers',
      label: 'Headers',
      widget: 'textarea',
      placeholder: 'Content-Type: application/json',
      help: 'One per line, as Name: value.',
    },
    {
      key: 'body',
      label: 'Body',
      widget: 'textarea',
      when: { key: 'method', is: ['POST', 'PUT', 'PATCH', 'DELETE'] },
    },
    { key: 'failOnError', label: 'Stop the tile on a 4xx or 5xx reply', widget: 'toggle' },
  ],
  defaults: { method: 'GET', url: 'https://', headers: '', body: '', failOnError: true },
  run: async (ctx, { method, url, headers, body, failOnError }) => {
    const response = await ctx.platform.http({
      method,
      url,
      headers: parseHeaders(headers),
      ...(method !== 'GET' && body !== '' && { body }),
      signal: ctx.signal,
    })
    if (failOnError && response.status >= 400)
      throw new Error(`The server replied ${response.status}`)
    let json: unknown
    try {
      json = JSON.parse(response.body)
    } catch {
      json = undefined
    }
    return { values: { status: response.status, body: response.body, json } }
  },
})

export const switchPage = defineBlock({
  id: 'action.switchPage',
  category: 'action',
  name: 'Switch page',
  description: 'Shows a page or opens a folder on connected phones.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({ page: text('Choose a page') }),
  fields: [{ key: 'page', label: 'Page or folder', widget: 'page' }],
  defaults: { page: '' },
  run: (ctx, { page }) => ctx.switchPage(page),
})

export const runTile = defineBlock({
  id: 'action.runTile',
  category: 'action',
  name: 'Run another tile',
  description: 'Presses another tile and waits for it to finish.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({ tile: text('Choose a tile') }),
  fields: [{ key: 'tile', label: 'Tile', widget: 'tile' }],
  defaults: { tile: '' },
  run: (ctx, { tile }) => ctx.runTile(tile),
})

const optionalText = z.preprocess(
  (v) => (v === null || v === undefined ? '' : String(v)),
  z.string().max(64),
)

export const setTileAppearance = defineBlock({
  id: 'action.setTileAppearance',
  category: 'action',
  name: 'Set tile appearance',
  description:
    'Changes the name, icon or colour of this tile or another one on the phone, e.g. to show a status. Leave a field empty to keep it.',
  inputs: [flowIn, { id: 'label', kind: 'value', type: 'string' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    label: optionalText,
    colour: z.union([
      z.literal(''),
      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #22D3C5'),
    ]),
    icon: optionalText,
    reset: bool,
    tile: optionalText,
    remember: bool.optional(),
  }),
  fields: [
    { key: 'tile', label: 'Which tile', widget: 'tile', placeholder: 'This tile' },
    { key: 'label', label: 'Label', widget: 'text', placeholder: '{{var.count}}' },
    { key: 'colour', label: 'Colour', widget: 'text', placeholder: '#F25C6E' },
    {
      key: 'icon',
      label: 'Icon',
      widget: 'text',
      placeholder: 'mic-off',
      help: 'An icon name from the tile icon picker, or one emoji.',
    },
    { key: 'reset', label: 'Reset to the tile’s own look', widget: 'toggle' },
    { key: 'remember', label: 'Keep it after Tessel restarts', widget: 'toggle' },
  ],
  defaults: { tile: '', label: '', colour: '', icon: '', reset: false, remember: false },
  run: (ctx, { label, colour, icon, reset, tile, remember }) => {
    const opts = { remember: remember ?? false, ...(tile !== '' && { tileId: tile }) }
    if (reset) return ctx.setAppearance('reset', opts)
    ctx.setAppearance(
      {
        ...(label !== '' && { label }),
        ...(colour !== '' && { colour }),
        ...(icon !== '' && { icon }),
      },
      opts,
    )
  },
})

export const actionBlocks = [
  openApp,
  appCommand,
  openUrl,
  openFile,
  typeText,
  keyCombo,
  mediaKey,
  mouse,
  setClipboard,
  notify,
  httpRequest,
  runShell,
  switchPage,
  runTile,
  setTileAppearance,
  setSetting,
  lockScreen,
  sleepComputer,
]
