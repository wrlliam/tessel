import type { Graph, JsonValue, Tile } from './model.ts'

export type TemplateCategory =
  | 'Meetings'
  | 'Media and sound'
  | 'Sliders'
  | 'Live tiles'
  | 'Voicemeeter'
  | 'Soundpad'
  | 'AI and search'
  | 'Apps'
  | 'System'
  | 'Productivity'
  | 'Examples'

export interface TileTemplate {
  id: string
  category: TemplateCategory
  name: string
  description: string
  tile: Pick<Tile, 'label' | 'colour'> &
    Partial<Pick<Tile, 'icon' | 'appearanceBindings' | 'concurrency' | 'kind'>> & { graph: Graph }
  /** Plugin whose blocks the template uses; the gallery says when it isn't on. */
  plugin?: string
  /** Global variables the template reads; added to the profile if missing. */
  variables?: Record<string, JsonValue>
}

const at = (x: number, y = 0) => ({ x, y })
const node = (id: string, type: string, params: Record<string, unknown>, x: number, y = 0) => ({
  id,
  type,
  params,
  position: at(x, y),
})
const wire = (from: string, fromPort: string, to: string, toPort = 'in') => ({
  id: `${from}-${fromPort}-${to}-${toPort}`,
  from: { nodeId: from, port: fromPort },
  to: { nodeId: to, port: toPort },
})
const press = node('press', 'trigger.press', {}, 0)

/** On press -> one action. */
const simple = (type: string, params: Record<string, unknown>) => ({
  nodes: [press, node('action', type, params, 288)],
  edges: [wire('press', 'out', 'action')],
})

/** On long press -> one action, for things that shouldn't happen by accident. */
const held = (type: string, params: Record<string, unknown>) => ({
  nodes: [node('hold', 'trigger.longPress', {}, 0), node('action', type, params, 288)],
  edges: [wire('hold', 'out', 'action')],
})

const app = (command: string, focus = true) => simple('action.appCommand', { command, focus })
const media = (key: string) => simple('action.mediaKey', { key })

/** A mute key that flips a Toggle, runs the command and turns red while muted. */
function muteKey(command: string, label: string) {
  return {
    label,
    icon: 'mic',
    colour: '#212833',
    appearanceBindings: [
      { field: 'colour' as const, expression: '{{state.muted ? "#F25C6E" : "#212833"}}' },
      { field: 'icon' as const, expression: '{{state.muted ? "mic-off" : "mic"}}' },
      { field: 'label' as const, expression: `{{state.muted ? "Muted" : "${label}"}}` },
    ],
    graph: {
      nodes: [
        press,
        node('toggle', 'logic.toggle', { key: 'muted' }, 288),
        node('cmd', 'action.appCommand', { command, focus: true }, 576),
      ],
      edges: [
        wire('press', 'out', 'toggle'),
        wire('toggle', 'on', 'cmd'),
        wire('toggle', 'off', 'cmd'),
      ],
    },
  }
}

const bind = (field: 'label' | 'colour' | 'icon', expression: string) => ({ field, expression })

/** Counts down on the key; a short press starts or restarts it, holding cancels it. */
function timer(id: string, minutes: number, label = `${minutes} min`): TileTemplate {
  return {
    id,
    category: 'Productivity',
    name: `${minutes}-minute timer`,
    description:
      'Shows the time left on the key and notifies you when it ends. Press again to restart; hold to cancel.',
    tile: {
      label,
      icon: 'timer',
      colour: '#212833',
      concurrency: 'restart',
      appearanceBindings: [
        bind('label', `{{state.left || "${label}"}}`),
        bind('colour', '{{state.left ? "#FF7A59" : "#212833"}}'),
      ],
      graph: {
        nodes: [
          press,
          node('count', 'logic.countdown', { seconds: minutes * 60, key: 'left' }, 288),
          node('notify', 'action.notify', { title: 'Tessel', body: `${label} is up` }, 576),
          node('hold', 'trigger.longPress', {}, 0, 160),
          node(
            'cancelled',
            'action.notify',
            { title: 'Tessel', body: 'Timer cancelled' },
            288,
            160,
          ),
        ],
        edges: [
          wire('press', 'out', 'count'),
          wire('count', 'out', 'notify'),
          wire('hold', 'out', 'cancelled'),
        ],
      },
    },
  }
}

/** Every `seconds`, and when the page opens: run `nodes` after the triggers. */
function live(
  seconds: number,
  nodes: ReturnType<typeof node>[],
  edges: ReturnType<typeof wire>[],
  first: string,
) {
  const cron = seconds >= 60 ? `0 */${Math.round(seconds / 60)} * * * *` : `*/${seconds} * * * * *`
  return {
    nodes: [
      node('tick', 'trigger.schedule', { cron }, 0),
      node('open', 'trigger.pageOpen', {}, 0, 128),
      press,
      ...nodes,
    ].map((n) => (n.id === 'press' ? { ...n, position: at(0, 256) } : n)),
    edges: [
      wire('tick', 'out', first),
      wire('open', 'out', first),
      wire('press', 'out', first),
      ...edges,
    ],
  }
}

/** On slide -> one block, with the value wired into `port`. */
function slider(
  type: string,
  params: Record<string, unknown>,
  port: string,
  range: { min: number; max: number; step: number },
) {
  return {
    nodes: [node('slide', 'trigger.slide', range, 0), node('action', type, params, 288)],
    edges: [wire('slide', 'out', 'action'), wire('slide', 'value', 'action', port)],
  }
}

/** A Voicemeeter mute that shows Voicemeeter's real state, so it never drifts. */
function vmMute(id: string, target: 'strip' | 'bus', index: number, label: string): TileTemplate {
  const param = `${target === 'strip' ? 'Strip' : 'Bus'}[${index - 1}].Mute`
  return {
    id,
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: `Mute ${label}`,
    description: `Mutes or unmutes ${target} ${index} and turns red while muted, following Voicemeeter itself.`,
    tile: {
      label,
      icon: target === 'strip' ? 'mic' : 'volume-2',
      colour: '#212833',
      appearanceBindings: [
        bind('colour', '{{state.muted ? "#F25C6E" : "#212833"}}'),
        bind(
          'icon',
          `{{state.muted ? "${target === 'strip' ? 'mic-off' : 'volume-x'}" : "${target === 'strip' ? 'mic' : 'volume-2'}"}}`,
        ),
      ],
      graph: {
        nodes: [
          press,
          node('mute', 'voicemeeter.mute', { target, index, action: 'toggle' }, 288),
          node('watch', 'voicemeeter.parameterChange', { param, stateKey: 'muted' }, 0, 160),
        ],
        edges: [wire('press', 'out', 'mute')],
      },
    },
  }
}

function vmGain(id: string, target: 'strip' | 'bus', index: number, label: string): TileTemplate {
  return {
    id,
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: `${label} gain slider`,
    description: `Drag to set the gain of ${target} ${index}, from -60 to +12 dB.`,
    tile: {
      label,
      icon: 'sliders-horizontal',
      colour: '#22D3C5',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', `${label} {{state.value ?? 0}} dB`)],
      graph: slider('voicemeeter.setGain', { target, index, gain: 0 }, 'gain', {
        min: -60,
        max: 12,
        step: 0.5,
      }),
    },
  }
}

function vmRoute(id: string, index: number, output: string): TileTemplate {
  return {
    id,
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: `Strip ${index} to ${output}`,
    description: `Sends strip ${index} to ${output} or stops it, and lights up while it is on.`,
    tile: {
      label: `${index} → ${output}`,
      icon: 'audio-lines',
      colour: '#212833',
      appearanceBindings: [bind('colour', '{{state.on ? "#22D3C5" : "#212833"}}')],
      graph: {
        nodes: [
          press,
          node('route', 'voicemeeter.routing', { index, output, action: 'toggle' }, 288),
          node(
            'watch',
            'voicemeeter.parameterChange',
            { param: `Strip[${index - 1}].${output}`, stateKey: 'on' },
            0,
            160,
          ),
        ],
        edges: [wire('press', 'out', 'route')],
      },
    },
  }
}

/** Copies what is selected, then reads it: the start of "do something with the selection". */
const selection = [
  node('copy', 'action.keyCombo', { combo: 'mod+c' }, 288),
  node('wait', 'logic.delay', { ms: 200 }, 576),
  node('clip', 'data.getClipboard', {}, 864),
]
const selectionWires = [
  wire('press', 'out', 'copy'),
  wire('copy', 'out', 'wait'),
  wire('wait', 'out', 'clip'),
]

/** Selection -> a plugin AI block -> `then` with the answer wired into `thenPort`. */
function aiTile(
  ai: { type: string; params: Record<string, unknown> },
  then: { type: string; params: Record<string, unknown>; port: string },
  after: ReturnType<typeof node>[] = [],
) {
  return {
    nodes: [
      press,
      ...selection,
      node('ai', ai.type, ai.params, 1152),
      node('then', then.type, then.params, 1440),
      ...after,
    ],
    edges: [
      ...selectionWires,
      wire('clip', 'out', 'ai'),
      wire('clip', 'text', 'ai', 'text'),
      wire('ai', 'out', 'then'),
      wire('ai', 'answer', 'then', then.port),
      ...(after[0] ? [wire('then', 'out', after[0].id)] : []),
    ],
  }
}

const ollama = (prompt: string) => ({
  type: 'ollama.ask',
  params: { prompt, model: '', system: '' },
})
const gemini = (prompt: string) => ({ type: 'google.gemini', params: { prompt, model: '' } })
const showAnswer = { type: 'action.notify', params: { title: 'Tessel', body: '' }, port: 'body' }

export const templates: TileTemplate[] = [
  // Meetings
  {
    id: 'zoom-mute',
    category: 'Meetings',
    name: 'Zoom: mute',
    description:
      'Mutes or unmutes in Zoom and turns red while muted. If you mute in Zoom itself, press once more to bring them back in step.',
    tile: muteKey('zoom.mute', 'Zoom mic'),
  },
  {
    id: 'zoom-video',
    category: 'Meetings',
    name: 'Zoom: camera',
    description: 'Turns your camera on or off in Zoom.',
    tile: { label: 'Camera', icon: 'video', colour: '#212833', graph: app('zoom.video') },
  },
  {
    id: 'zoom-share',
    category: 'Meetings',
    name: 'Zoom: share screen',
    description: 'Starts sharing your screen in Zoom.',
    tile: { label: 'Share', icon: 'monitor', colour: '#212833', graph: app('zoom.share') },
  },
  {
    id: 'zoom-leave',
    category: 'Meetings',
    name: 'Zoom: leave',
    description: 'Leaves the meeting. Hold the key, so it never happens by accident.',
    tile: {
      label: 'Leave',
      icon: 'power',
      colour: '#F25C6E',
      graph: held('action.appCommand', { command: 'zoom.leave', focus: true }),
    },
  },
  {
    id: 'teams-mute',
    category: 'Meetings',
    name: 'Teams: mute',
    description: 'Mutes or unmutes in Microsoft Teams and turns red while muted.',
    tile: muteKey('teams.mute', 'Teams mic'),
  },
  {
    id: 'teams-hand',
    category: 'Meetings',
    name: 'Teams: raise hand',
    description: 'Raises or lowers your hand in Teams.',
    tile: { label: 'Hand', icon: 'flag', colour: '#212833', graph: app('teams.hand') },
  },
  {
    id: 'meet-mute',
    category: 'Meetings',
    name: 'Google Meet: mute',
    description: 'Mutes or unmutes in Google Meet. Keep the Meet tab in front.',
    tile: muteKey('meet.mute', 'Meet mic'),
  },
  {
    id: 'mute-discord',
    category: 'Meetings',
    name: 'Discord: mute',
    description: 'Mutes or unmutes in Discord with its standard shortcut.',
    tile: muteKey('discord.mute', 'Discord'),
  },
  {
    id: 'discord-deafen',
    category: 'Meetings',
    name: 'Discord: deafen',
    description: 'Deafens or undeafens in Discord.',
    tile: { label: 'Deafen', icon: 'headphones', colour: '#212833', graph: app('discord.deafen') },
  },
  {
    id: 'vesktop-mute',
    category: 'Meetings',
    name: 'Vesktop: mute',
    description: 'Mutes or unmutes in Vesktop, the Vencord Discord app, and turns red while muted.',
    tile: muteKey('vesktop.mute', 'Vesktop mic'),
  },
  {
    id: 'vesktop-deafen',
    category: 'Meetings',
    name: 'Vesktop: deafen',
    description: 'Deafens or undeafens in Vesktop.',
    tile: { label: 'Deafen', icon: 'headphones', colour: '#212833', graph: app('vesktop.deafen') },
  },
  {
    id: 'vesktop-switcher',
    category: 'Apps',
    name: 'Vesktop: quick switcher',
    description: 'Opens Vesktop’s quick switcher to jump to a server or friend.',
    tile: { label: 'Switcher', icon: 'search', colour: '#212833', graph: app('vesktop.switcher') },
  },

  // Media and sound
  {
    id: 'play-pause',
    category: 'Media and sound',
    name: 'Play / pause',
    description: 'Presses the media play/pause key for whatever is playing.',
    tile: { label: 'Play', icon: 'play', colour: '#22D3C5', graph: media('playPause') },
  },
  {
    id: 'next-track',
    category: 'Media and sound',
    name: 'Next track',
    description: 'Skips to the next track.',
    tile: { label: 'Next', icon: 'skip-forward', colour: '#212833', graph: media('next') },
  },
  {
    id: 'previous-track',
    category: 'Media and sound',
    name: 'Previous track',
    description: 'Goes back a track.',
    tile: { label: 'Previous', icon: 'skip-back', colour: '#212833', graph: media('previous') },
  },
  {
    id: 'volume-up',
    category: 'Media and sound',
    name: 'Volume up',
    description: 'Turns the sound up a step.',
    tile: { label: 'Louder', icon: 'volume-2', colour: '#212833', graph: media('volumeUp') },
  },
  {
    id: 'volume-down',
    category: 'Media and sound',
    name: 'Volume down',
    description: 'Turns the sound down a step.',
    tile: { label: 'Quieter', icon: 'volume-1', colour: '#212833', graph: media('volumeDown') },
  },
  {
    id: 'volume-50',
    category: 'Media and sound',
    name: 'Volume to 50%',
    description: 'Sets the output volume to exactly half.',
    tile: {
      label: 'Volume 50%',
      icon: 'volume-1',
      colour: '#4FA3F7',
      graph: simple('action.setSetting', { setting: 'volume', level: 50 }),
    },
  },
  {
    id: 'mute-status',
    category: 'Media and sound',
    name: 'Mute sound, with status',
    description:
      'Toggles mute and turns red while muted. Uses a Toggle, so it remembers its state.',
    tile: {
      label: 'Sound',
      icon: 'volume-2',
      colour: '#212833',
      appearanceBindings: [
        { field: 'colour', expression: '{{state.muted ? "#F25C6E" : "#212833"}}' },
        { field: 'icon', expression: '{{state.muted ? "volume-x" : "volume-2"}}' },
        { field: 'label', expression: '{{state.muted ? "Muted" : "Sound"}}' },
      ],
      graph: {
        nodes: [
          press,
          node('toggle', 'logic.toggle', { key: 'muted' }, 288),
          node('mute', 'action.setSetting', { setting: 'mute', value: true }, 576, -48),
          node('unmute', 'action.setSetting', { setting: 'mute', value: false }, 576, 96),
        ],
        edges: [
          wire('press', 'out', 'toggle'),
          wire('toggle', 'on', 'mute'),
          wire('toggle', 'off', 'unmute'),
        ],
      },
    },
  },
  {
    id: 'spotify-like',
    category: 'Media and sound',
    name: 'Spotify: like song',
    description: 'Saves the playing song to your Liked Songs.',
    tile: { label: 'Like', icon: 'heart', colour: '#212833', graph: app('spotify.like') },
  },

  // Apps
  {
    id: 'open-app',
    category: 'Apps',
    name: 'Open an app',
    description: 'Opens an app by name. Change the name in the Open app block.',
    tile: {
      label: 'Calculator',
      icon: 'app-window',
      colour: '#22D3C5',
      graph: simple('action.openApp', { app: 'Calculator' }),
    },
  },
  {
    id: 'open-website',
    category: 'Apps',
    name: 'Open a website',
    description: 'Opens a link in your browser.',
    tile: {
      label: 'Website',
      icon: 'globe',
      colour: '#4FA3F7',
      graph: simple('action.openUrl', { url: 'https://example.com' }),
    },
  },
  {
    id: 'open-downloads',
    category: 'Apps',
    name: 'Open Downloads',
    description: 'Opens your Downloads folder.',
    tile: {
      label: 'Downloads',
      icon: 'download',
      colour: '#212833',
      graph: simple('action.openFile', { path: '~/Downloads' }),
    },
  },
  {
    id: 'browser-new-tab',
    category: 'Apps',
    name: 'Browser: new tab',
    description: 'Opens a new tab in the browser in front.',
    tile: {
      label: 'New tab',
      icon: 'plus',
      colour: '#212833',
      graph: app('browser.newTab', false),
    },
  },
  {
    id: 'browser-reopen',
    category: 'Apps',
    name: 'Browser: reopen tab',
    description: 'Brings back the tab you just closed.',
    tile: {
      label: 'Reopen tab',
      icon: 'undo-2',
      colour: '#212833',
      graph: app('browser.reopen', false),
    },
  },
  {
    id: 'code-palette',
    category: 'Apps',
    name: 'VS Code: command palette',
    description: 'Brings VS Code to the front and opens its command palette.',
    tile: { label: 'Commands', icon: 'terminal', colour: '#4FA3F7', graph: app('code.palette') },
  },
  {
    id: 'code-terminal',
    category: 'Apps',
    name: 'VS Code: terminal',
    description: 'Shows the terminal in VS Code.',
    tile: { label: 'Terminal', icon: 'code', colour: '#212833', graph: app('code.terminal') },
  },
  {
    id: 'slack-jump',
    category: 'Apps',
    name: 'Slack: jump to',
    description: 'Opens Slack’s quick switcher.',
    tile: { label: 'Slack', icon: 'message-circle', colour: '#8B7CF6', graph: app('slack.jump') },
  },

  // System
  {
    id: 'dark-by-time',
    category: 'System',
    name: 'Dark mode by time of day',
    description: 'Turns dark mode on from 6 pm and off before then.',
    tile: {
      label: 'Dark mode',
      icon: 'moon',
      colour: '#212833',
      graph: {
        nodes: [
          press,
          node('time', 'data.getTime', {}, 0, 96),
          node(
            'if',
            'logic.if',
            { condition: { kind: 'compare', left: '{{input.a}}', op: '>=', right: 18 } },
            288,
          ),
          node('dark', 'action.setSetting', { setting: 'darkMode', value: true }, 576, -48),
          node('light', 'action.setSetting', { setting: 'darkMode', value: false }, 576, 96),
        ],
        edges: [
          wire('press', 'out', 'if'),
          wire('time', 'hour', 'if', 'a'),
          wire('if', 'yes', 'dark'),
          wire('if', 'no', 'light'),
        ],
      },
    },
  },
  {
    id: 'dark-toggle',
    category: 'System',
    name: 'Dark mode on/off',
    description: 'Switches between light and dark mode.',
    tile: {
      label: 'Dark mode',
      icon: 'moon',
      colour: '#8B7CF6',
      graph: simple('action.setSetting', { setting: 'darkMode', value: 'toggle' }),
    },
  },
  {
    id: 'screenshot',
    category: 'System',
    name: 'Screenshot',
    description: 'Starts a screenshot of an area of the screen.',
    tile: {
      label: 'Screenshot',
      icon: 'camera',
      colour: '#212833',
      graph: app('system.screenshot', false),
    },
  },
  {
    id: 'emoji-picker',
    category: 'System',
    name: 'Emoji picker',
    description: 'Opens the emoji picker where you are typing.',
    tile: { label: 'Emoji', icon: '🙂', colour: '#F5B63D', graph: app('system.emoji', false) },
  },
  {
    id: 'show-desktop',
    category: 'System',
    name: 'Show desktop',
    description: 'Moves windows out of the way.',
    tile: {
      label: 'Desktop',
      icon: 'maximize',
      colour: '#212833',
      graph: app('system.desktop', false),
    },
  },
  {
    id: 'lock-screen',
    category: 'System',
    name: 'Lock screen',
    description: 'Locks the computer. Hold the key, so it never happens by accident.',
    tile: { label: 'Lock', icon: 'lock', colour: '#161B22', graph: held('action.lockScreen', {}) },
  },
  {
    id: 'sleep',
    category: 'System',
    name: 'Sleep',
    description: 'Puts the computer to sleep. Hold the key, so it never happens by accident.',
    tile: { label: 'Sleep', icon: 'power', colour: '#161B22', graph: held('action.sleep', {}) },
  },

  // Productivity
  {
    id: 'type-email',
    category: 'Productivity',
    name: 'Type my email',
    description: 'Types the address saved in the "email" variable.',
    tile: {
      label: 'Email',
      icon: 'mail',
      colour: '#F5B63D',
      graph: simple('action.typeText', { text: '{{var.email}}' }),
    },
    variables: { email: 'you@example.com' },
  },
  {
    id: 'type-date',
    category: 'Productivity',
    name: 'Type today’s date',
    description: 'Types the date as YYYY-MM-DD.',
    tile: {
      label: 'Date',
      icon: 'calendar',
      colour: '#212833',
      graph: {
        nodes: [
          press,
          node('time', 'data.getTime', {}, 0, 96),
          node('type', 'action.typeText', { text: '' }, 288),
        ],
        edges: [wire('press', 'out', 'type'), wire('time', 'date', 'type', 'text')],
      },
    },
  },
  timer('timer-5', 5),
  timer('timer-25', 25, 'Focus 25'),

  {
    id: 'copy-signature',
    category: 'Productivity',
    name: 'Copy my signature',
    description: 'Copies a sign-off ready to paste, using the "name" variable.',
    tile: {
      label: 'Signature',
      icon: 'clipboard',
      colour: '#212833',
      graph: simple('action.setClipboard', { text: 'Best,\n{{var.name}}' }),
    },
    variables: { name: 'Your name' },
  },
  {
    id: 'webhook',
    category: 'Productivity',
    name: 'Call a webhook',
    description:
      'Sends a POST request, for smart-home or automation services. Change the address in the block.',
    tile: {
      label: 'Webhook',
      icon: 'send',
      colour: '#22D3C5',
      graph: simple('action.http', {
        method: 'POST',
        url: 'https://example.com/hook',
        headers: 'Content-Type: application/json',
        body: '{"from":"tessel"}',
        failOnError: true,
      }),
    },
  },

  // Examples
  {
    id: 'counter',
    category: 'Examples',
    name: 'Counter',
    description:
      'Counts presses and shows the count on the key. A small example of live tile state.',
    tile: {
      label: 'Count',
      icon: 'plus',
      colour: '#8B7CF6',
      appearanceBindings: [{ field: 'label', expression: 'Count: {{var.count ?? 0}}' }],
      graph: simple('data.setVariable', {
        name: 'count',
        scope: 'global',
        value: '{{(var.count ?? 0) + 1}}',
      }),
    },
  },
  // Sliders
  {
    id: 'slider-volume',
    category: 'Sliders',
    name: 'Volume slider',
    description: "Drag to set the computer's volume.",
    tile: {
      label: 'Volume',
      icon: 'volume-2',
      colour: '#22D3C5',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', 'Volume {{state.value ?? 50}}%')],
      graph: slider('action.setSetting', { setting: 'volume', level: 50 }, 'level', {
        min: 0,
        max: 100,
        step: 1,
      }),
    },
  },
  {
    id: 'slider-brightness',
    category: 'Sliders',
    name: 'Brightness slider',
    description: 'Drag to set the screen brightness. Works on most built-in screens.',
    tile: {
      label: 'Brightness',
      icon: 'sun-dim',
      colour: '#F5B63D',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', 'Brightness {{state.value ?? 50}}%')],
      graph: slider('action.setSetting', { setting: 'brightness', level: 50 }, 'level', {
        min: 0,
        max: 100,
        step: 5,
      }),
    },
  },
  {
    id: 'slider-blank',
    category: 'Sliders',
    name: 'Slider',
    description:
      'A slider with On slide ready to wire up. value goes from 0 to 100 unless you change it.',
    tile: {
      label: 'Slider',
      icon: 'sliders-horizontal',
      colour: '#212833',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', '{{state.value ?? 50}}')],
      graph: {
        nodes: [node('slide', 'trigger.slide', { min: 0, max: 100, step: 1 }, 0)],
        edges: [],
      },
    },
  },

  // Live tiles
  {
    id: 'live-weather',
    category: 'Live tiles',
    name: 'Weather',
    description:
      'Shows the temperature and sky where your phone is, every 15 minutes. Turn on Share location in Phones › On the phone, or type a place in the Weather block.',
    tile: {
      label: 'Weather',
      icon: 'cloud-sun',
      colour: '#4FA3F7',
      graph: live(
        900,
        [
          node('weather', 'data.weather', { place: '', units: 'celsius' }, 288),
          node(
            'show',
            'action.setTileAppearance',
            { tile: '', label: '', colour: '', icon: '', reset: false, remember: false },
            576,
          ),
        ],
        [
          wire('weather', 'out', 'show'),
          wire('weather', 'summary', 'show', 'label'),
          wire('weather', 'icon', 'show', 'icon'),
        ],
        'weather',
      ),
    },
  },
  {
    id: 'live-now-playing',
    category: 'Live tiles',
    name: "What's playing",
    description:
      'Shows the song playing in Spotify (or your music app) and the time left, every 2 seconds. Tap to play or pause.',
    tile: {
      label: 'Nothing playing',
      icon: 'music',
      colour: '#1DB954',
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '*/2 * * * * *' }, 0),
          node('open', 'trigger.pageOpen', {}, 0, 128),
          node('np', 'data.nowPlaying', {}, 288),
          node('text', 'data.text', { template: '{{input.a}}  {{input.b}}' }, 288, 256),
          node(
            'show',
            'action.setTileAppearance',
            { tile: '', label: '', colour: '', icon: 'music', reset: false, remember: false },
            576,
          ),
          node(
            'idle',
            'action.setTileAppearance',
            {
              tile: '',
              label: 'Nothing playing',
              colour: '',
              icon: 'music',
              reset: false,
              remember: false,
            },
            576,
            160,
          ),
          node('press', 'trigger.press', {}, 0, 384),
          node('pp', 'action.mediaKey', { key: 'playPause' }, 288, 384),
        ],
        edges: [
          wire('tick', 'out', 'np'),
          wire('open', 'out', 'np'),
          wire('np', 'out', 'show'),
          wire('np', 'nothing', 'idle'),
          wire('np', 'song', 'text', 'a'),
          wire('np', 'left', 'text', 'b'),
          wire('text', 'text', 'show', 'label'),
          wire('press', 'out', 'pp'),
        ],
      },
    },
  },
  {
    id: 'live-clock',
    category: 'Live tiles',
    name: 'Clock',
    description: 'Shows the time, updated every minute.',
    tile: {
      label: 'Clock',
      icon: 'clock',
      colour: '#212833',
      graph: live(
        60,
        [
          node('time', 'data.getTime', {}, 288),
          node(
            'show',
            'action.setTileAppearance',
            { tile: '', label: '', colour: '', icon: '', reset: false, remember: false },
            576,
          ),
        ],
        [wire('time', 'time', 'show', 'label')],
        'show',
      ),
    },
  },

  // Voicemeeter
  vmMute('vm-mute-strip1', 'strip', 1, 'Mic'),
  vmMute('vm-mute-strip2', 'strip', 2, 'Input 2'),
  vmMute('vm-mute-strip3', 'strip', 3, 'Input 3'),
  vmMute('vm-mute-a1', 'bus', 1, 'A1'),
  vmMute('vm-mute-b1', 'bus', 6, 'B1'),
  vmGain('vm-gain-strip1', 'strip', 1, 'Mic'),
  vmGain('vm-gain-strip2', 'strip', 2, 'Input 2'),
  vmGain('vm-gain-a1', 'bus', 1, 'A1'),
  vmRoute('vm-route-1-a1', 1, 'A1'),
  vmRoute('vm-route-1-b1', 1, 'B1'),
  vmRoute('vm-route-3-a2', 3, 'A2'),
  {
    id: 'vm-solo-1',
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: 'Solo strip 1',
    description: 'Solos strip 1, so you hear only it, or turns solo off.',
    tile: {
      label: 'Solo 1',
      icon: 'headphones',
      colour: '#212833',
      graph: simple('voicemeeter.solo', { index: 1, action: 'toggle' }),
    },
  },
  {
    id: 'vm-macro-1',
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: 'Macro button 1',
    description: 'Presses Voicemeeter macro button 1, as if you clicked it.',
    tile: {
      label: 'Macro 1',
      icon: 'zap',
      colour: '#8B7CF6',
      graph: simple('voicemeeter.macroButton', { button: 1, action: 'press' }),
    },
  },
  {
    id: 'vm-level',
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: 'Mic level',
    description: "Shows strip 1's input level in dB, twice a second.",
    tile: {
      label: 'Level',
      icon: 'gauge',
      colour: '#212833',
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '*/1 * * * * *' }, 0),
          node('level', 'voicemeeter.getLevel', { kind: '1', channel: 0 }, 0, 128),
          node('round', 'data.math', { op: 'round', a: 0, b: 0 }, 288, 128),
          node(
            'show',
            'action.setTileAppearance',
            { tile: '', label: '', colour: '', icon: '', reset: false, remember: false },
            576,
          ),
        ],
        edges: [
          wire('tick', 'out', 'show'),
          wire('level', 'db', 'round', 'a'),
          wire('round', 'result', 'show', 'label'),
        ],
      },
    },
  },

  // Soundpad
  {
    id: 'soundpad-play',
    category: 'Soundpad',
    plugin: 'soundpad',
    name: 'Play a sound',
    description:
      'Plays sound 1 from Soundpad on your speakers and mic. Change the number or type part of a name.',
    tile: {
      label: 'Sound 1',
      icon: 'audio-waveform',
      colour: '#FF7A59',
      graph: simple('soundpad.play', { sound: '1', where: 'both' }),
    },
  },
  {
    id: 'soundpad-random',
    category: 'Soundpad',
    plugin: 'soundpad',
    name: 'Random sound',
    description: 'Plays a random sound from Soundpad.',
    tile: {
      label: 'Random',
      icon: 'shuffle',
      colour: '#8B7CF6',
      graph: simple('soundpad.random', { category: '' }),
    },
  },
  {
    id: 'soundpad-stop',
    category: 'Soundpad',
    plugin: 'soundpad',
    name: 'Stop sound',
    description: 'Stops whatever Soundpad is playing.',
    tile: {
      label: 'Stop',
      icon: 'square',
      colour: '#212833',
      graph: simple('soundpad.control', { action: 'stop' }),
    },
  },
  {
    id: 'soundpad-again',
    category: 'Soundpad',
    plugin: 'soundpad',
    name: 'Play again',
    description: 'Replays the last sound.',
    tile: {
      label: 'Again',
      icon: 'repeat',
      colour: '#212833',
      graph: simple('soundpad.control', { action: 'again' }),
    },
  },
  {
    id: 'soundpad-volume',
    category: 'Soundpad',
    plugin: 'soundpad',
    name: 'Soundpad volume slider',
    description: "Drag to set Soundpad's volume.",
    tile: {
      label: 'Soundpad',
      icon: 'volume-2',
      colour: '#FF7A59',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', 'Soundpad {{state.value ?? 80}}%')],
      graph: slider('soundpad.volume', { level: 80 }, 'level', { min: 0, max: 100, step: 1 }),
    },
  },

  // AI and search
  {
    id: 'ai-explain-ollama',
    category: 'AI and search',
    plugin: 'ollama',
    name: 'Explain the selection (Ollama)',
    description:
      'Copies the selected text, asks your local Ollama model to explain it, and shows the answer as a notification.',
    tile: {
      label: 'Explain',
      icon: 'bot',
      colour: '#8B7CF6',
      graph: aiTile(ollama('Explain this simply, in a few sentences:'), showAnswer),
    },
  },
  {
    id: 'ai-rewrite-ollama',
    category: 'AI and search',
    plugin: 'ollama',
    name: 'Rewrite the selection (Ollama)',
    description:
      'Rewrites the selected text to read more clearly and pastes it over the selection.',
    tile: {
      label: 'Rewrite',
      icon: 'file-text',
      colour: '#8B7CF6',
      graph: aiTile(
        ollama('Rewrite this to be clear and friendly. Reply with only the rewritten text:'),
        { type: 'action.setClipboard', params: { text: '' }, port: 'text' },
        [node('paste', 'action.keyCombo', { combo: 'mod+v' }, 1728)],
      ),
    },
  },
  {
    id: 'ai-translate-ollama',
    category: 'AI and search',
    plugin: 'ollama',
    name: 'Translate the selection (Ollama)',
    description: 'Translates the selected text into English and copies the result.',
    tile: {
      label: 'Translate',
      icon: 'languages',
      colour: '#8B7CF6',
      graph: aiTile(ollama('Translate this into English. Reply with only the translation:'), {
        type: 'action.setClipboard',
        params: { text: '' },
        port: 'text',
      }),
    },
  },
  {
    id: 'ai-summary-gemini',
    category: 'AI and search',
    plugin: 'google',
    name: 'Summarise the selection (Gemini)',
    description:
      'Copies the selected text, asks Gemini for a short summary and shows it. Needs a Gemini API key in the Google plugin.',
    tile: {
      label: 'Summarise',
      icon: 'message-square-text',
      colour: '#4FA3F7',
      graph: aiTile(gemini('Summarise this in two sentences:'), showAnswer),
    },
  },
  {
    id: 'google-selection',
    category: 'AI and search',
    plugin: 'google',
    name: 'Google the selection',
    description: 'Searches Google for the selected text in your browser.',
    tile: {
      label: 'Google it',
      icon: 'search',
      colour: '#4FA3F7',
      graph: {
        nodes: [
          press,
          ...selection,
          node('search', 'google.search', { where: 'web', query: '' }, 1152),
          node('open', 'action.openUrl', { url: 'https://' }, 1440),
        ],
        edges: [
          ...selectionWires,
          wire('clip', 'out', 'search'),
          wire('clip', 'text', 'search', 'text'),
          wire('search', 'out', 'open'),
          wire('search', 'url', 'open', 'url'),
        ],
      },
    },
  },
  {
    id: 'google-maps-selection',
    category: 'AI and search',
    plugin: 'google',
    name: 'Show the selection on a map',
    description: 'Opens the selected address or place in Google Maps.',
    tile: {
      label: 'Map it',
      icon: 'map-pin',
      colour: '#22D3C5',
      graph: {
        nodes: [
          press,
          ...selection,
          node('search', 'google.search', { where: 'maps', query: '' }, 1152),
          node('open', 'action.openUrl', { url: 'https://' }, 1440),
        ],
        edges: [
          ...selectionWires,
          wire('clip', 'out', 'search'),
          wire('clip', 'text', 'search', 'text'),
          wire('search', 'out', 'open'),
          wire('search', 'url', 'open', 'url'),
        ],
      },
    },
  },
]

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Meetings',
  'Media and sound',
  'Sliders',
  'Live tiles',
  'Voicemeeter',
  'Soundpad',
  'AI and search',
  'Apps',
  'System',
  'Productivity',
  'Examples',
]

/** A whole page of ready-made tiles. */
export interface PageTemplate {
  id: string
  name: string
  description: string
  cols: number
  rows: number
  tiles: Array<{
    template: string
    col: number
    row: number
    w?: number
    h?: number
    label?: string
    /** Merged into the params of the template's main block (node id "action"). */
    params?: Record<string, unknown>
  }>
}

export const pageTemplates: PageTemplate[] = [
  {
    id: 'page-meetings',
    name: 'Meetings',
    description: 'Mute, camera, share and leave for Zoom, plus Teams and Google Meet.',
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'zoom-mute', col: 0, row: 0 },
      { template: 'zoom-video', col: 1, row: 0 },
      { template: 'zoom-share', col: 2, row: 0 },
      { template: 'teams-mute', col: 0, row: 1 },
      { template: 'teams-hand', col: 1, row: 1 },
      { template: 'meet-mute', col: 2, row: 1 },
      { template: 'mute-status', col: 0, row: 2 },
      { template: 'lock-screen', col: 1, row: 2 },
      { template: 'zoom-leave', col: 2, row: 2 },
      { template: 'timer-25', col: 0, row: 3, w: 3 },
    ],
  },
  {
    id: 'page-music',
    name: 'Music',
    description: "What's playing with time left, playback keys and a volume slider.",
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'live-now-playing', col: 0, row: 0, w: 3 },
      { template: 'previous-track', col: 0, row: 1 },
      { template: 'play-pause', col: 1, row: 1 },
      { template: 'next-track', col: 2, row: 1 },
      { template: 'volume-down', col: 0, row: 2 },
      { template: 'mute-status', col: 1, row: 2 },
      { template: 'volume-up', col: 2, row: 2 },
      { template: 'slider-volume', col: 0, row: 3, w: 3 },
    ],
  },
  {
    id: 'page-voicemeeter',
    name: 'Voicemeeter mixer',
    description:
      'Mutes that follow Voicemeeter, gain faders for two inputs and A1, routing and the mic level. Needs the Voicemeeter plugin (Windows).',
    cols: 4,
    rows: 4,
    tiles: [
      { template: 'vm-mute-strip1', col: 0, row: 0 },
      { template: 'vm-mute-strip2', col: 1, row: 0 },
      { template: 'vm-mute-a1', col: 2, row: 0 },
      { template: 'vm-mute-b1', col: 3, row: 0 },
      { template: 'vm-gain-strip1', col: 0, row: 1, h: 2 },
      { template: 'vm-gain-strip2', col: 1, row: 1, h: 2 },
      { template: 'vm-gain-a1', col: 2, row: 1, h: 2 },
      { template: 'vm-route-1-a1', col: 3, row: 1 },
      { template: 'vm-route-1-b1', col: 3, row: 2 },
      { template: 'vm-level', col: 0, row: 3 },
      { template: 'vm-solo-1', col: 1, row: 3 },
      { template: 'vm-macro-1', col: 2, row: 3 },
      { template: 'vm-mute-strip3', col: 3, row: 3 },
    ],
  },
  {
    id: 'page-voice-chat',
    name: 'Voice chat',
    description: 'Mute and deafen for Discord and Vesktop, plus the quick switcher.',
    cols: 3,
    rows: 3,
    tiles: [
      { template: 'mute-discord', col: 0, row: 0 },
      { template: 'discord-deafen', col: 1, row: 0 },
      { template: 'vesktop-switcher', col: 2, row: 0 },
      { template: 'vesktop-mute', col: 0, row: 1 },
      { template: 'vesktop-deafen', col: 1, row: 1 },
      { template: 'mute-status', col: 2, row: 1 },
      { template: 'slider-volume', col: 0, row: 2, w: 3 },
    ],
  },
  {
    id: 'page-soundboard',
    name: 'Soundboard',
    description:
      'Three Soundpad sounds, random, replay, stop and a volume slider. Needs the Soundpad plugin (Windows).',
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'soundpad-play', col: 0, row: 0 },
      { template: 'soundpad-play', col: 1, row: 0, label: 'Sound 2', params: { sound: '2' } },
      { template: 'soundpad-play', col: 2, row: 0, label: 'Sound 3', params: { sound: '3' } },
      { template: 'soundpad-random', col: 0, row: 1 },
      { template: 'soundpad-again', col: 1, row: 1 },
      { template: 'soundpad-stop', col: 2, row: 1 },
      { template: 'soundpad-volume', col: 0, row: 2, w: 3 },
    ],
  },
  {
    id: 'page-desk',
    name: 'Desk',
    description: 'Clock, weather, focus timers and everyday system keys.',
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'live-clock', col: 0, row: 0 },
      { template: 'live-weather', col: 1, row: 0, w: 2 },
      { template: 'timer-25', col: 0, row: 1 },
      { template: 'timer-5', col: 1, row: 1 },
      { template: 'dark-toggle', col: 2, row: 1 },
      { template: 'screenshot', col: 0, row: 2 },
      { template: 'show-desktop', col: 1, row: 2 },
      { template: 'lock-screen', col: 2, row: 2 },
      { template: 'slider-brightness', col: 0, row: 3, w: 3 },
    ],
  },
]

/**
 * Tiles for a page template, with fresh ids from `newId`, and the variables they need.
 * Unknown template ids are skipped.
 */
export function buildPage(
  page: PageTemplate,
  newId: (prefix: string) => string,
): { tiles: Tile[]; variables: Record<string, JsonValue>; plugins: string[] } {
  const byId = new Map(templates.map((t) => [t.id, t]))
  const variables: Record<string, JsonValue> = {}
  const plugins = new Set<string>()
  const tiles: Tile[] = []
  for (const slot of page.tiles) {
    const t = byId.get(slot.template)
    if (!t) continue
    Object.assign(variables, t.variables)
    if (t.plugin) plugins.add(t.plugin)
    const tile = structuredClone(t.tile)
    if (slot.label) tile.label = slot.label
    if (slot.params)
      tile.graph.nodes = tile.graph.nodes.map((n) =>
        n.id === 'action' ? { ...n, params: { ...n.params, ...slot.params } } : n,
      )
    tiles.push({
      kind: 'action',
      concurrency: 'queue',
      appearanceBindings: [],
      ...tile,
      id: newId('t'),
      position: { col: slot.col, row: slot.row },
      span: { w: slot.w ?? 1, h: slot.h ?? 1 },
    })
  }
  return { tiles, variables, plugins: [...plugins] }
}
