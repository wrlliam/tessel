import { z } from 'zod'
import { defineBlock, flowIn, flowOut } from '../block.ts'
import { parseCombo, resolveCombo } from '../combo.ts'
import { osName, UserFacingError, type OS } from '../platform.ts'

/** A ready-made shortcut for a popular app. `mod` is Cmd on macOS and Ctrl elsewhere. */
export interface AppCommand {
  id: string
  app: string
  label: string
  /** App to bring to the front first, by OS. Missing means the shortcut works from anywhere. */
  focus?: Partial<Record<OS, string>>
  keys: Partial<Record<OS, string>>
}

const all = (combo: string): Record<OS, string> => ({ darwin: combo, win32: combo, linux: combo })
const zoom = { darwin: 'zoom.us', win32: 'Zoom', linux: 'Zoom' }
const teams = { darwin: 'Microsoft Teams', win32: 'Microsoft Teams', linux: 'Microsoft Teams' }
const discord = { darwin: 'Discord', win32: 'Discord', linux: 'Discord' }
const vesktop = { darwin: 'Vesktop', win32: 'Vesktop', linux: 'vesktop' }

/** Discord's shortcuts. Vesktop, the Vencord desktop app, uses the same ones. */
const discordCommands = (prefix: string, app: string, focus: Record<OS, string>): AppCommand[] =>
  (
    [
      ['mute', 'Mute or unmute', 'mod+shift+m'],
      ['deafen', 'Deafen or undeafen', 'mod+shift+d'],
      ['switcher', 'Quick switcher', 'mod+k'],
      ['answer', 'Answer a call', 'mod+enter'],
      ['decline', 'Decline a call', 'escape'],
      ['upload', 'Upload a file', 'mod+shift+u'],
      ['emoji', 'Emoji picker', 'mod+e'],
      ['inbox', 'Open the inbox', 'mod+i'],
      ['read', 'Mark server read', 'shift+escape'],
      ['unread', 'Next unread channel', 'alt+shift+down'],
    ] as const
  ).map(([id, label, keys]) => ({ id: `${prefix}.${id}`, app, label, focus, keys: all(keys) }))

const resolve = { darwin: 'DaVinci Resolve', win32: 'DaVinci Resolve', linux: 'resolve' }

/** DaVinci Resolve's default keyboard layout. */
const resolveCommands: AppCommand[] = (
  [
    ['play', 'Play or stop', 'space'],
    ['reverse', 'Play backwards (J)', 'j'],
    ['stop', 'Stop (K)', 'k'],
    ['forward', 'Play forwards (L)', 'l'],
    ['blade', 'Split clip at the playhead', 'mod+b'],
    ['ripple', 'Ripple delete', 'shift+backspace'],
    ['in', 'Mark in', 'i'],
    ['out', 'Mark out', 'o'],
    ['clearInOut', 'Clear in and out', 'alt+x'],
    ['marker', 'Add a marker', 'm'],
    ['snapping', 'Snapping on or off', 'n'],
    ['undo', 'Undo', 'mod+z'],
    ['redo', 'Redo', 'mod+shift+z'],
    ['save', 'Save the project', 'mod+s'],
    ['zoomIn', 'Zoom the timeline in', 'mod+='],
    ['zoomOut', 'Zoom the timeline out', 'mod+-'],
    ['still', 'Grab a still (Color page)', 'mod+alt+g'],
    ['pageMedia', 'Media page', 'shift+2'],
    ['pageCut', 'Cut page', 'shift+3'],
    ['pageEdit', 'Edit page', 'shift+4'],
    ['pageFusion', 'Fusion page', 'shift+5'],
    ['pageColor', 'Color page', 'shift+6'],
    ['pageFairlight', 'Fairlight page', 'shift+7'],
    ['pageDeliver', 'Deliver page', 'shift+8'],
  ] as const
).map(([id, label, keys]) => ({
  id: `resolve.${id}`,
  app: 'DaVinci Resolve',
  label,
  focus: resolve,
  keys: all(keys),
}))

const spotify = { darwin: 'Spotify', win32: 'Spotify', linux: 'Spotify' }
const code = {
  darwin: 'Visual Studio Code',
  win32: 'Visual Studio Code',
  linux: 'Visual Studio Code',
}
const slack = { darwin: 'Slack', win32: 'Slack', linux: 'Slack' }

export const APP_COMMANDS: AppCommand[] = [
  {
    id: 'zoom.mute',
    app: 'Zoom',
    label: 'Mute or unmute',
    focus: zoom,
    keys: { darwin: 'cmd+shift+a', win32: 'alt+a', linux: 'alt+a' },
  },
  {
    id: 'zoom.video',
    app: 'Zoom',
    label: 'Camera on or off',
    focus: zoom,
    keys: { darwin: 'cmd+shift+v', win32: 'alt+v', linux: 'alt+v' },
  },
  {
    id: 'zoom.share',
    app: 'Zoom',
    label: 'Share screen',
    focus: zoom,
    keys: { darwin: 'cmd+shift+s', win32: 'alt+s', linux: 'alt+s' },
  },
  { id: 'zoom.hand', app: 'Zoom', label: 'Raise or lower hand', focus: zoom, keys: all('alt+y') },
  {
    id: 'zoom.leave',
    app: 'Zoom',
    label: 'Leave meeting',
    focus: zoom,
    keys: { darwin: 'cmd+w', win32: 'alt+q', linux: 'alt+q' },
  },
  {
    id: 'teams.mute',
    app: 'Teams',
    label: 'Mute or unmute',
    focus: teams,
    keys: all('mod+shift+m'),
  },
  {
    id: 'teams.video',
    app: 'Teams',
    label: 'Camera on or off',
    focus: teams,
    keys: all('mod+shift+o'),
  },
  {
    id: 'teams.hand',
    app: 'Teams',
    label: 'Raise or lower hand',
    focus: teams,
    keys: all('mod+shift+k'),
  },
  { id: 'teams.leave', app: 'Teams', label: 'Leave call', focus: teams, keys: all('mod+shift+h') },
  { id: 'meet.mute', app: 'Google Meet', label: 'Mute or unmute', keys: all('mod+d') },
  { id: 'meet.video', app: 'Google Meet', label: 'Camera on or off', keys: all('mod+e') },
  ...discordCommands('discord', 'Discord', discord),
  ...discordCommands('vesktop', 'Vesktop', vesktop),
  ...resolveCommands,
  {
    id: 'slack.jump',
    app: 'Slack',
    label: 'Jump to a conversation',
    focus: slack,
    keys: all('mod+k'),
  },
  {
    id: 'slack.unreads',
    app: 'Slack',
    label: 'All unreads',
    focus: slack,
    keys: all('mod+shift+a'),
  },
  {
    id: 'spotify.play',
    app: 'Spotify',
    label: 'Play or pause',
    focus: spotify,
    keys: all('space'),
  },
  {
    id: 'spotify.next',
    app: 'Spotify',
    label: 'Next track',
    focus: spotify,
    keys: all('mod+right'),
  },
  {
    id: 'spotify.previous',
    app: 'Spotify',
    label: 'Previous track',
    focus: spotify,
    keys: all('mod+left'),
  },
  {
    id: 'spotify.like',
    app: 'Spotify',
    label: 'Like the song',
    focus: spotify,
    keys: { darwin: 'alt+shift+b', win32: 'alt+shift+b', linux: 'alt+shift+b' },
  },
  {
    id: 'code.palette',
    app: 'VS Code',
    label: 'Command palette',
    focus: code,
    keys: all('mod+shift+p'),
  },
  { id: 'code.open', app: 'VS Code', label: 'Open a file', focus: code, keys: all('mod+p') },
  {
    id: 'code.terminal',
    app: 'VS Code',
    label: 'Show terminal',
    focus: code,
    keys: all('ctrl+grave'),
  },
  {
    id: 'code.sidebar',
    app: 'VS Code',
    label: 'Show or hide sidebar',
    focus: code,
    keys: all('mod+b'),
  },
  { id: 'browser.newTab', app: 'Browser', label: 'New tab', keys: all('mod+t') },
  { id: 'browser.reopen', app: 'Browser', label: 'Reopen closed tab', keys: all('mod+shift+t') },
  { id: 'browser.close', app: 'Browser', label: 'Close tab', keys: all('mod+w') },
  { id: 'browser.reload', app: 'Browser', label: 'Reload', keys: all('mod+r') },
  { id: 'browser.nextTab', app: 'Browser', label: 'Next tab', keys: all('ctrl+tab') },
  {
    id: 'system.screenshot',
    app: 'System',
    label: 'Screenshot of an area',
    keys: { darwin: 'cmd+shift+4', win32: 'meta+shift+s', linux: 'printscreen' },
  },
  {
    id: 'system.record',
    app: 'System',
    label: 'Screen recording',
    keys: { darwin: 'cmd+shift+5', win32: 'meta+alt+r' },
  },
  {
    id: 'system.emoji',
    app: 'System',
    label: 'Emoji picker',
    keys: { darwin: 'ctrl+cmd+space', win32: 'meta+period', linux: 'meta+period' },
  },
  {
    id: 'system.desktop',
    app: 'System',
    label: 'Show desktop',
    keys: { darwin: 'cmd+f3', win32: 'meta+d', linux: 'meta+d' },
  },
  {
    id: 'system.switcher',
    app: 'System',
    label: 'Switch windows',
    keys: { darwin: 'ctrl+up', win32: 'meta+tab', linux: 'alt+tab' },
  },
  {
    id: 'system.search',
    app: 'System',
    label: 'Search the computer',
    keys: { darwin: 'cmd+space', win32: 'meta+s', linux: 'meta+a' },
  },
]

const BY_ID = new Map(APP_COMMANDS.map((c) => [c.id, c]))
const FOCUS_SETTLE_MS = 400

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), {
      once: true,
    })
  })

export const appCommand = defineBlock({
  id: 'action.appCommand',
  category: 'action',
  name: 'App command',
  description:
    'A ready-made shortcut for a popular app, like muting in Zoom. Uses the right keys for this computer.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({
    command: z.string().refine((id) => BY_ID.has(id), 'Choose a command'),
    focus: z.preprocess((v) => (typeof v === 'string' ? v !== 'false' : v), z.boolean()),
  }),
  fields: [
    {
      key: 'command',
      label: 'Command',
      widget: 'select',
      options: APP_COMMANDS.map((c) => ({ value: c.id, label: `${c.app}: ${c.label}` })),
    },
    {
      key: 'focus',
      label: 'Bring the app to the front first',
      widget: 'toggle',
      help: 'Most app shortcuts only work while the app is in front.',
    },
  ],
  defaults: { command: 'zoom.mute', focus: true },
  run: async (ctx, { command, focus }) => {
    const entry = BY_ID.get(command) as AppCommand
    const os = ctx.platform.os
    const keys = entry.keys[os]
    if (!keys)
      throw new UserFacingError(`${entry.app}: ${entry.label} isn't available on ${osName[os]}`)
    const app = entry.focus?.[os]
    if (focus && app) {
      // Shortcuts only work in the app's own window: wait until it's really in front.
      if (ctx.platform.focusApp) {
        await ctx.platform.focusApp(app, ctx.signal)
        await wait(120, ctx.signal)
      } else {
        await ctx.platform.openApp(app)
        await wait(FOCUS_SETTLE_MS, ctx.signal)
      }
    }
    await ctx.platform.pressCombo(resolveCombo(parseCombo(keys), os))
  },
})
