import type { Graph, JsonValue, Tile } from './model.ts'

export type TemplateCategory =
  'Meetings' | 'Media and sound' | 'Apps' | 'System' | 'Productivity' | 'Examples'

export interface TileTemplate {
  id: string
  category: TemplateCategory
  name: string
  description: string
  tile: Pick<Tile, 'label' | 'colour'> &
    Partial<Pick<Tile, 'icon' | 'appearanceBindings' | 'concurrency'>> & { graph: Graph }
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
  {
    id: 'timer-5',
    category: 'Productivity',
    name: '5-minute timer',
    description:
      'Shows that it is running on the key, then sends a notification when the time is up.',
    tile: {
      label: '5 min',
      icon: 'timer',
      colour: '#212833',
      concurrency: 'restart',
      graph: {
        nodes: [
          press,
          node(
            'show',
            'action.setTileAppearance',
            {
              tile: '',
              label: 'Timing…',
              colour: '#FF7A59',
              icon: '',
              reset: false,
              remember: false,
            },
            288,
          ),
          node('wait', 'logic.delay', { ms: 300000 }, 576),
          node('notify', 'action.notify', { title: 'Tessel', body: 'Five minutes are up' }, 864),
          node(
            'reset',
            'action.setTileAppearance',
            { tile: '', label: '', colour: '', icon: '', reset: true, remember: false },
            1152,
          ),
        ],
        edges: [
          wire('press', 'out', 'show'),
          wire('show', 'out', 'wait'),
          wire('wait', 'out', 'notify'),
          wire('notify', 'out', 'reset'),
        ],
      },
    },
  },
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
]

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Meetings',
  'Media and sound',
  'Apps',
  'System',
  'Productivity',
  'Examples',
]
