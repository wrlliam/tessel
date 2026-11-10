import type { Graph, JsonValue, Tile } from './model.ts'

export type TemplateCategory =
  | 'Meetings'
  | 'Media and sound'
  | 'Sliders'
  | 'Live tiles'
  | 'Voicemeeter'
  | 'Soundpad'
  | 'Streaming'
  | 'Gaming'
  | 'Windows'
  | 'Video editing'
  | 'Lights'
  | 'Home'
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
    Partial<Pick<Tile, 'icon' | 'appearanceBindings' | 'concurrency' | 'kind' | 'display'>> & {
      graph: Graph
    }
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

const STAT_NAMES: Record<string, string> = {
  cpu: 'CPU use',
  memory: 'memory in use',
  disk: 'how full the main disk is',
  down: 'download speed',
}

/**
 * A System stats tile: reads one stat every second while its page is open and draws it as a
 * ring, bar or chart. Charts keep a history you can scroll back through on the phone.
 */
function statTile(
  id: string,
  label: string,
  stat: 'cpu' | 'memory' | 'disk' | 'down',
  kind: 'ring' | 'bar' | 'line' | 'columns',
  icon: string,
): TileTemplate[] {
  const network = stat === 'down'
  const chart = kind === 'line' || kind === 'columns'
  return [
    {
      id,
      category: 'System',
      name: `${label} ${chart ? 'chart' : kind === 'ring' ? 'gauge' : 'bar'}`,
      description: `Shows ${STAT_NAMES[stat]} live${chart ? ' as a chart; tap it on the phone to scroll back' : ''}. Amber and red when it gets high.`,
      tile: {
        label,
        icon,
        colour: '#212833',
        display: {
          kind,
          // Network arrives in KB/s; megabits a second read better.
          value: network ? '{{round(state.reading * 8 / 1024, 1)}}' : '{{state.reading}}',
          min: 0,
          max: 100,
          unit: network ? ' Mb/s' : '%',
          decimals: network ? 1 : 0,
          zones: network
            ? []
            : [
                { from: 0, colour: '#1DB954' },
                { from: 70, colour: '#F5B63D' },
                { from: 90, colour: '#F25C6E' },
              ],
        },
        graph: {
          nodes: [
            node('tick', 'trigger.schedule', { cron: '*/1 * * * * *' }, 0),
            node('stats', 'data.systemStats', {}, 0, 128),
            node('show', 'action.showValue', { value: 0, key: 'reading' }, 288),
          ],
          edges: [
            wire('tick', 'out', 'stats'),
            wire('stats', 'out', 'show'),
            wire('stats', stat, 'show', 'value'),
          ],
        },
      },
    },
  ]
}

function vmGain(id: string, target: 'strip' | 'bus', index: number, label: string): TileTemplate {
  return {
    id,
    category: 'Voicemeeter',
    plugin: 'voicemeeter',
    name: `${label} gain slider`,
    description: `Drag to set the gain of ${target} ${index}, from -60 to +12 dB. Hold it to reset to 0 dB.`,
    tile: {
      label,
      icon: 'sliders-horizontal',
      colour: '#22D3C5',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', `${label} {{state.value ?? 0}} dB`)],
      graph: {
        ...slider('voicemeeter.setGain', { target, index, gain: 0 }, 'gain', {
          min: -60,
          max: 12,
          step: 0.5,
        }),
        nodes: [
          ...slider('voicemeeter.setGain', { target, index, gain: 0 }, 'gain', {
            min: -60,
            max: 12,
            step: 0.5,
          }).nodes,
          node('hold', 'trigger.longPress', {}, 0, 160),
          node('reset', 'voicemeeter.setGain', { target, index, gain: 0 }, 288, 160),
          node('bar', 'action.setSlider', { value: 0, tile: '' }, 576, 160),
        ],
        edges: [
          ...slider('voicemeeter.setGain', { target, index, gain: 0 }, 'gain', {
            min: -60,
            max: 12,
            step: 0.5,
          }).edges,
          wire('hold', 'out', 'reset'),
          wire('reset', 'out', 'bar'),
        ],
      },
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

/** An OBS scene key that lights up while its scene is on air. */
function obsScene(id: string, scene: string, icon: string): TileTemplate {
  return {
    id,
    category: 'Streaming',
    plugin: 'obs',
    name: `OBS scene: ${scene}`,
    description: `Switches OBS to the "${scene}" scene and lights up while it's live. Rename the scene in the block to match yours.`,
    tile: {
      label: scene,
      icon,
      colour: '#212833',
      appearanceBindings: [bind('colour', `{{state.scene == "${scene}" ? "#22D3C5" : "#212833"}}`)],
      graph: {
        nodes: [
          press,
          node('action', 'obs.scene', { scene }, 288),
          node('watch', 'obs.watch', { input: '' }, 0, 160),
        ],
        edges: [wire('press', 'out', 'action')],
      },
    },
  }
}

/** Sets a Slack status from a key. */
function slackStatus(
  id: string,
  text: string,
  emoji: string,
  minutes: number,
  icon: string,
): TileTemplate {
  return {
    id,
    category: 'Meetings',
    plugin: 'slack',
    name: `Slack status: ${text}`,
    description: `Sets your Slack status to "${text}"${minutes ? ` for ${minutes} minutes` : ''}.`,
    tile: {
      label: text,
      icon,
      colour: '#4A154B',
      graph: simple('slack.status', { text, emoji, minutes }),
    },
  }
}

/** A DaVinci Resolve key using its keyboard shortcut (works in the free version, no plugin). */
function resolveKey(
  command: string,
  label: string,
  icon: string,
  colour = '#212833',
): TileTemplate {
  return {
    id: `resolve-${command}`,
    category: 'Video editing',
    name: `Resolve: ${label}`,
    description: `${label} in DaVinci Resolve, with its keyboard shortcut. Brings Resolve to the front first.`,
    tile: { label, icon, colour, graph: app(`resolve.${command}`) },
  }
}

type Pop = { title: string; body: string; icon: string; colour?: string }
const popup = (id: string, p: Pop, x: number, y = 0) =>
  node(
    id,
    'action.toast',
    {
      title: p.title,
      body: p.body,
      icon: p.icon,
      colour: p.colour ?? '',
      seconds: 3,
      position: 'top-center',
    },
    x,
    y,
  )

/**
 * Presses a shortcut without bringing any app forward (the game keeps focus), then pops up a
 * confirmation when the result isn't visible on its own.
 */
function keyTile(
  id: string,
  category: TemplateCategory,
  name: string,
  description: string,
  look: { label: string; icon: string; colour?: string },
  combo: string,
  pop?: Pop,
): TileTemplate {
  return {
    id,
    category,
    name,
    description,
    tile: {
      label: look.label,
      icon: look.icon,
      colour: look.colour ?? '#212833',
      graph: pop
        ? {
            nodes: [press, node('keys', 'action.keyCombo', { combo }, 288), popup('pop', pop, 576)],
            edges: [wire('press', 'out', 'keys'), wire('keys', 'out', 'pop')],
          }
        : simple('action.keyCombo', { combo }),
    },
  }
}

/** A start/stop recording key that remembers which it did, turns red while recording and says so. */
function recordKey(
  id: string,
  name: string,
  description: string,
  combo: string,
  what: string,
): TileTemplate {
  return {
    id,
    category: 'Gaming',
    name,
    description,
    tile: {
      label: 'Record',
      icon: 'video',
      colour: '#212833',
      appearanceBindings: [
        bind('colour', '{{state.recording ? "#F25C6E" : "#212833"}}'),
        bind('label', '{{state.recording ? "Recording" : "Record"}}'),
      ],
      graph: {
        nodes: [
          press,
          node('keys', 'action.keyCombo', { combo }, 288),
          node('toggle', 'logic.toggle', { key: 'recording' }, 576),
          popup(
            'started',
            {
              title: 'Recording',
              body: `${what} started recording.`,
              icon: '🔴',
              colour: '#F25C6E',
            },
            864,
          ),
          popup(
            'stopped',
            {
              title: 'Recording stopped',
              body: `${what} saves the recording to its usual folder.`,
              icon: '💾',
              colour: '#22D3C5',
            },
            864,
            160,
          ),
        ],
        edges: [
          wire('press', 'out', 'keys'),
          wire('keys', 'out', 'toggle'),
          wire('toggle', 'on', 'started'),
          wire('toggle', 'off', 'stopped'),
        ],
      },
    },
  }
}

const steamGame = (id: string, appId: string, game: string, icon: string): TileTemplate => ({
  id,
  category: 'Gaming',
  name: `Steam: play ${game}`,
  description: `Starts ${game} through Steam. Change the number in the link to any game's Steam app ID (in its store page address).`,
  tile: {
    label: game,
    icon,
    colour: '#1B2838',
    graph: {
      nodes: [
        press,
        node('open', 'action.openUrl', { url: `steam://rungameid/${appId}` }, 288),
        popup('pop', { title: 'Starting', body: `${game} is starting in Steam.`, icon: '🎮' }, 576),
      ],
      edges: [wire('press', 'out', 'open'), wire('open', 'out', 'pop')],
    },
  },
})

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
    description:
      'Adds the playing song to your Liked Songs, bringing Spotify forward first. Pressing it on a song you already like removes it again (that is how Spotify’s shortcut works).',
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
    description:
      "Drag to set the computer's volume; the bar follows when the volume changes anywhere else. Hold it to mute or unmute.",
    tile: {
      label: 'Volume',
      icon: 'volume-2',
      colour: '#22D3C5',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [
        bind('label', '{{state.muted ? "Muted" : "Volume " + (state.value ?? 50) + "%"}}'),
        bind('icon', '{{state.muted ? "volume-x" : "volume-2"}}'),
      ],
      graph: {
        nodes: [
          node('slide', 'trigger.slide', { min: 0, max: 100, step: 1 }, 0),
          node('set', 'action.setSetting', { setting: 'volume', level: 50 }, 288),
          node('hold', 'trigger.longPress', {}, 0, 160),
          node('mute', 'action.setSetting', { setting: 'mute', value: 'toggle' }, 288, 160),
          node('tick', 'trigger.schedule', { cron: '*/2 * * * * *' }, 0, 320),
          node('read', 'data.getVolume', {}, 288, 320),
          node('changed', 'logic.changed', { key: 'lastVolume' }, 576, 320),
          node('follow', 'action.setSlider', { value: 0, tile: '' }, 864, 320),
        ],
        edges: [
          wire('slide', 'out', 'set'),
          wire('slide', 'value', 'set', 'level'),
          wire('hold', 'out', 'mute'),
          wire('tick', 'out', 'read'),
          wire('read', 'out', 'changed'),
          wire('read', 'level', 'changed', 'value'),
          wire('changed', 'changed', 'follow'),
          wire('read', 'level', 'follow', 'value'),
        ],
      },
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
      'Shows the song playing in Spotify (or your music app) with its album cover and the time left, every 2 seconds. Tap to play or pause.',
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
              image: 'none',
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
          wire('np', 'artwork', 'show', 'image'),
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

  // Pop-ups
  {
    id: 'popup-date',
    category: 'Live tiles',
    name: "Pop up today's date",
    description: "Shows today's day and date on the computer's screen for a few seconds.",
    tile: {
      label: 'Date',
      icon: 'calendar',
      colour: '#212833',
      graph: {
        nodes: [
          press,
          node('time', 'data.getTime', {}, 0, 128),
          node('text', 'data.text', { template: '{{input.a}}, {{input.b}}' }, 288, 128),
          node(
            'toast',
            'action.toast',
            { title: 'Today', body: '', icon: '📅', colour: '', seconds: 5, position: 'top-right' },
            576,
          ),
        ],
        edges: [
          wire('press', 'out', 'toast'),
          wire('time', 'weekday', 'text', 'a'),
          wire('time', 'date', 'text', 'b'),
          wire('text', 'text', 'toast', 'body'),
        ],
      },
    },
  },
  {
    id: 'popup-song',
    category: 'Live tiles',
    name: 'Pop up new songs',
    description:
      "Watches what's playing and pops the song up on screen for 6 seconds whenever it changes. Tap to play or pause.",
    tile: {
      label: 'Song pop-ups',
      icon: 'music',
      colour: '#1DB954',
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '*/3 * * * * *' }, 0),
          node('np', 'data.nowPlaying', {}, 288),
          node('changed', 'logic.changed', { key: 'lastSong' }, 576),
          node(
            'toast',
            'action.toast',
            {
              title: 'Now playing',
              body: '',
              icon: '🎵',
              colour: '#1DB954',
              seconds: 6,
              position: 'bottom-right',
            },
            864,
          ),
          node('press', 'trigger.press', {}, 0, 256),
          node('pp', 'action.mediaKey', { key: 'playPause' }, 288, 256),
        ],
        edges: [
          wire('tick', 'out', 'np'),
          wire('np', 'out', 'changed'),
          wire('np', 'song', 'changed', 'value'),
          wire('changed', 'changed', 'toast'),
          wire('np', 'song', 'toast', 'body'),
          wire('press', 'out', 'pp'),
        ],
      },
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
    description:
      'A ring that fills with how loud strip 1 is, every second while the page is open: green, amber from -18 dB, red from -6 dB.',
    tile: {
      label: 'Mic',
      icon: 'gauge',
      colour: '#212833',
      display: {
        kind: 'ring',
        // -60 dB (silence) to 0 dB (as loud as it goes), as 0 to 100%.
        value: '{{round(max(0, min(100, (state.reading + 60) / 60 * 100)))}}',
        min: 0,
        max: 100,
        unit: '%',
        decimals: 0,
        zones: [
          { from: 0, colour: '#1DB954' },
          { from: 70, colour: '#F5B63D' },
          { from: 90, colour: '#F25C6E' },
        ],
      },
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '*/1 * * * * *' }, 0),
          node('level', 'voicemeeter.getLevel', { kind: '1', channel: 0 }, 0, 128),
          node('show', 'action.showValue', { value: 0, key: 'reading' }, 288),
        ],
        edges: [wire('tick', 'out', 'show'), wire('level', 'db', 'show', 'value')],
      },
    },
  },

  // System stats
  ...statTile('stat-cpu', 'CPU', 'cpu', 'ring', 'cpu'),
  ...statTile('stat-memory', 'Memory', 'memory', 'ring', 'memory-stick'),
  ...statTile('stat-disk', 'Disk', 'disk', 'bar', 'hard-drive'),
  ...statTile('stat-cpu-chart', 'CPU', 'cpu', 'line', 'activity'),
  ...statTile('stat-memory-chart', 'Memory', 'memory', 'line', 'activity'),
  ...statTile('stat-network-chart', 'Download', 'down', 'columns', 'download'),

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

  // Home (Home Assistant)
  {
    id: 'ha-light',
    category: 'Home',
    plugin: 'home-assistant',
    name: 'Light switch',
    description:
      'Toggles a Home Assistant light and lights up while it is on, even when someone switches it elsewhere.',
    tile: {
      label: 'Desk light',
      icon: 'lightbulb',
      colour: '#212833',
      appearanceBindings: [bind('colour', '{{state.on ? "#F5B63D" : "#212833"}}')],
      graph: {
        nodes: [
          press,
          node('toggle', 'home-assistant.toggle', { entity: 'light.desk', action: 'toggle' }, 288),
          node('watch', 'home-assistant.watch', { entity: 'light.desk' }, 0, 192),
        ],
        edges: [wire('press', 'out', 'toggle')],
      },
    },
  },
  {
    id: 'ha-scene',
    category: 'Home',
    plugin: 'home-assistant',
    name: 'Scene',
    description: 'Turns on a Home Assistant scene, e.g. movie night.',
    tile: {
      label: 'Movie night',
      icon: 'moon',
      colour: '#8B7CF6',
      graph: simple('home-assistant.service', {
        service: 'scene.turn_on',
        entity: 'scene.movie_night',
        data: '',
      }),
    },
  },
  {
    id: 'ha-brightness',
    category: 'Home',
    plugin: 'home-assistant',
    name: 'Brightness slider',
    description: 'Drag to set a Home Assistant light’s brightness.',
    tile: {
      label: 'Desk light',
      icon: 'sun-dim',
      colour: '#F5B63D',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', 'Desk {{state.value ?? 50}}%')],
      graph: slider(
        'home-assistant.service',
        {
          service: 'light.turn_on',
          entity: 'light.desk',
          data: '{"brightness_pct": {{input.value}}}',
        },
        'value',
        { min: 0, max: 100, step: 5 },
      ),
    },
  },
  {
    id: 'ha-sensor',
    category: 'Home',
    plugin: 'home-assistant',
    name: 'Sensor reading',
    description: 'Shows a Home Assistant sensor, like a room temperature, updated every minute.',
    tile: {
      label: 'Living room',
      icon: 'thermometer',
      colour: '#212833',
      graph: live(
        60,
        [
          node(
            'read',
            'home-assistant.state',
            { entity: 'sensor.living_room_temperature', attribute: 'unit_of_measurement' },
            288,
          ),
          node('text', 'data.text', { template: '{{input.a}}{{input.b}}' }, 288, 256),
          node(
            'show',
            'action.setTileAppearance',
            { tile: '', label: '', colour: '', icon: '', reset: false, remember: false },
            576,
          ),
        ],
        [
          wire('read', 'on', 'show'),
          wire('read', 'off', 'show'),
          wire('read', 'other', 'show'),
          wire('read', 'state', 'text', 'a'),
          wire('read', 'attribute', 'text', 'b'),
          wire('text', 'text', 'show', 'label'),
        ],
        'read',
      ),
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

  // Streaming (OBS)
  obsScene('obs-scene-camera', 'Camera', 'camera'),
  obsScene('obs-scene-screen', 'Screen', 'monitor'),
  obsScene('obs-scene-brb', 'Be right back', 'coffee'),
  {
    id: 'obs-record',
    category: 'Streaming',
    plugin: 'obs',
    name: 'OBS: record',
    description: 'Starts or stops recording, and turns red while OBS records.',
    tile: {
      label: 'Record',
      icon: 'video',
      colour: '#212833',
      appearanceBindings: [
        bind('colour', '{{state.recording ? "#F25C6E" : "#212833"}}'),
        bind('label', '{{state.recording ? "Recording" : "Record"}}'),
      ],
      graph: {
        nodes: [
          press,
          node('action', 'obs.output', { what: 'record', action: 'toggle' }, 288),
          node('watch', 'obs.watch', { input: '' }, 0, 160),
        ],
        edges: [wire('press', 'out', 'action')],
      },
    },
  },
  {
    id: 'obs-stream',
    category: 'Streaming',
    plugin: 'obs',
    name: 'OBS: go live',
    description:
      'Starts or stops streaming. Hold it, so you never go live by accident; it turns red while live.',
    tile: {
      label: 'Go live',
      icon: 'radio',
      colour: '#212833',
      appearanceBindings: [
        bind('colour', '{{state.live ? "#F25C6E" : "#212833"}}'),
        bind('label', '{{state.live ? "Live" : "Go live"}}'),
      ],
      graph: {
        nodes: [
          node('hold', 'trigger.longPress', {}, 0),
          node('action', 'obs.output', { what: 'stream', action: 'toggle' }, 288),
          node('watch', 'obs.watch', { input: '' }, 0, 160),
        ],
        edges: [wire('hold', 'out', 'action')],
      },
    },
  },
  {
    id: 'obs-mic',
    category: 'Streaming',
    plugin: 'obs',
    name: 'OBS: mute mic',
    description:
      'Mutes the Mic/Aux source in OBS and turns red while muted, even when you mute in OBS.',
    tile: {
      label: 'Mic',
      icon: 'mic',
      colour: '#212833',
      appearanceBindings: [
        bind('colour', '{{state.muted ? "#F25C6E" : "#212833"}}'),
        bind('icon', '{{state.muted ? "mic-off" : "mic"}}'),
      ],
      graph: {
        nodes: [
          press,
          node('action', 'obs.mute', { input: 'Mic/Aux', action: 'toggle' }, 288),
          node('watch', 'obs.watch', { input: 'Mic/Aux' }, 0, 160),
        ],
        edges: [wire('press', 'out', 'action')],
      },
    },
  },
  {
    id: 'obs-replay',
    category: 'Streaming',
    plugin: 'obs',
    name: 'OBS: save replay',
    description: 'Saves the last moments from the replay buffer (turn it on in OBS first).',
    tile: {
      label: 'Clip it',
      icon: 'save',
      colour: '#8B7CF6',
      graph: simple('obs.output', { what: 'replay', action: 'toggle' }),
    },
  },

  // Lights
  {
    id: 'keylight-toggle',
    category: 'Lights',
    plugin: 'keylight',
    name: 'Key Light on and off',
    description:
      'Turns your Elgato Key Lights on or off together, and lights up while they are on.',
    tile: {
      label: 'Key Light',
      icon: 'sun',
      colour: '#212833',
      appearanceBindings: [bind('colour', '{{state.on ? "#F5B63D" : "#212833"}}')],
      graph: simple('keylight.power', { light: 'all', action: 'toggle' }),
    },
  },
  {
    id: 'keylight-brightness',
    category: 'Lights',
    plugin: 'keylight',
    name: 'Key Light brightness',
    description: 'Drag to set Key Light brightness.',
    tile: {
      label: 'Key Light',
      icon: 'sun-dim',
      colour: '#F5B63D',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', 'Key Light {{state.value ?? 50}}%')],
      graph: slider('keylight.set', { light: 'all', level: 50, kelvin: 0 }, 'level', {
        min: 0,
        max: 100,
        step: 5,
      }),
    },
  },
  {
    id: 'keylight-warm',
    category: 'Lights',
    plugin: 'keylight',
    name: 'Key Light warm',
    description: 'Sets Key Lights to a warm 3200 K at 40%, for evenings.',
    tile: {
      label: 'Warm',
      icon: 'moon',
      colour: '#FF7A59',
      graph: simple('keylight.set', { light: 'all', level: 40, kelvin: 3200 }),
    },
  },
  {
    id: 'hue-toggle',
    category: 'Lights',
    plugin: 'hue',
    name: 'Hue room on and off',
    description: 'Turns a Hue room on or off. Type your room’s name in the block.',
    tile: {
      label: 'Living room',
      icon: 'lightbulb',
      colour: '#212833',
      appearanceBindings: [bind('colour', '{{state.on ? "#F5B63D" : "#212833"}}')],
      graph: simple('hue.light', { target: 'room', name: 'Living room', action: 'toggle' }),
    },
  },
  {
    id: 'hue-brightness',
    category: 'Lights',
    plugin: 'hue',
    name: 'Hue brightness',
    description: 'Drag to dim or brighten a Hue room.',
    tile: {
      label: 'Living room',
      icon: 'sun-dim',
      colour: '#F5B63D',
      kind: 'slider',
      concurrency: 'restart',
      appearanceBindings: [bind('label', 'Lights {{state.value ?? 70}}%')],
      graph: slider('hue.brightness', { target: 'room', name: 'Living room', level: 70 }, 'level', {
        min: 0,
        max: 100,
        step: 5,
      }),
    },
  },
  {
    id: 'hue-scene',
    category: 'Lights',
    plugin: 'hue',
    name: 'Hue scene',
    description: 'Recalls a Hue scene, e.g. Relax in the living room.',
    tile: {
      label: 'Relax',
      icon: 'palette',
      colour: '#8B7CF6',
      graph: simple('hue.scene', { room: 'Living room', scene: 'Relax' }),
    },
  },
  {
    id: 'hue-connect',
    category: 'Lights',
    plugin: 'hue',
    name: 'Connect to the Hue bridge',
    description: 'Press the button on your Hue bridge, then this tile, once, to connect Tessel.',
    tile: {
      label: 'Connect Hue',
      icon: 'link',
      colour: '#212833',
      graph: simple('hue.connect', {}),
    },
  },

  // Status, sound and apps (optional plugins)
  slackStatus('slack-meeting', 'In a meeting', ':calendar:', 60, 'calendar'),
  slackStatus('slack-lunch', 'Lunch', ':sandwich:', 45, 'coffee'),
  slackStatus('slack-focus', 'Focusing', ':headphones:', 120, 'headphones'),
  {
    id: 'slack-clear',
    category: 'Meetings',
    plugin: 'slack',
    name: 'Slack status: clear',
    description: 'Clears your Slack status.',
    tile: {
      label: 'Clear status',
      icon: 'x',
      colour: '#4A154B',
      graph: simple('slack.status', { text: '', emoji: '', minutes: 0 }),
    },
  },
  {
    id: 'slack-dnd',
    category: 'Meetings',
    plugin: 'slack',
    name: 'Slack: pause notifications for an hour',
    description: 'Pauses Slack notifications for 60 minutes.',
    tile: {
      label: 'Do not disturb',
      icon: 'bell',
      colour: '#4A154B',
      graph: simple('slack.dnd', { action: 'pause', minutes: 60 }),
    },
  },
  {
    id: 'audio-switch',
    category: 'Media and sound',
    plugin: 'audio-output',
    name: 'Switch speakers and headphones',
    description:
      'Sends sound to your headphones, or back to the speakers when it already goes there. Change the names to match yours.',
    tile: {
      label: 'Output',
      icon: 'headphones',
      colour: '#212833',
      appearanceBindings: [bind('label', '{{state.output || "Output"}}')],
      graph: simple('audio-output.use', { output: 'Headphones', other: 'Speakers' }),
    },
  },
  {
    id: 'spotify-playlist',
    category: 'Media and sound',
    plugin: 'spotify',
    name: 'Play a Spotify playlist',
    description: 'Plays a playlist, album or song. Paste its Spotify share link into the block.',
    tile: {
      label: 'Playlist',
      icon: 'music',
      colour: '#1DB954',
      graph: simple('spotify.play', {
        link: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      }),
    },
  },
  {
    id: 'spotify-shuffle',
    category: 'Media and sound',
    plugin: 'spotify',
    name: 'Spotify shuffle',
    description: 'Turns shuffle on or off in Spotify (macOS), and lights up while it is on.',
    tile: {
      label: 'Shuffle',
      icon: 'shuffle',
      colour: '#212833',
      appearanceBindings: [bind('colour', '{{state.shuffle ? "#1DB954" : "#212833"}}')],
      graph: simple('spotify.shuffle', { what: 'shuffling', action: 'toggle' }),
    },
  },
  {
    id: 'mac-shortcut',
    category: 'Apps',
    plugin: 'mac-shortcuts',
    name: 'Run a Shortcut (macOS)',
    description: 'Runs one of your shortcuts from the Shortcuts app. Type its name in the block.',
    tile: {
      label: 'Shortcut',
      icon: 'zap',
      colour: '#4FA3F7',
      graph: simple('mac-shortcuts.run', { name: 'My shortcut' }),
    },
  },

  // More everyday tiles (no plugins needed)
  {
    id: 'reminder-water',
    category: 'Productivity',
    name: 'Drink water reminder',
    description:
      'Pops up a reminder every hour from 9 to 5 on weekdays. Press it to snooze one round.',
    tile: {
      label: 'Water',
      icon: 'coffee',
      colour: '#4FA3F7',
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '0 9-17 * * 1-5' }, 0),
          node(
            'toast',
            'action.toast',
            {
              title: 'Time for some water',
              body: 'A glass now keeps the afternoon slump away.',
              icon: '💧',
              colour: '#4FA3F7',
              seconds: 8,
              position: 'top-right',
            },
            288,
          ),
        ],
        edges: [wire('tick', 'out', 'toast')],
      },
    },
  },
  {
    id: 'reminder-stand',
    category: 'Productivity',
    name: 'Stand up reminder',
    description: 'Every 50 minutes in working hours, pops up a reminder to stand and stretch.',
    tile: {
      label: 'Stand up',
      icon: 'zap',
      colour: '#22D3C5',
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '50 9-17 * * 1-5' }, 0),
          node(
            'toast',
            'action.toast',
            {
              title: 'Stand up',
              body: 'Stretch for a minute; your back will thank you.',
              icon: '🧍',
              colour: '#22D3C5',
              seconds: 8,
              position: 'top-right',
            },
            288,
          ),
        ],
        edges: [wire('tick', 'out', 'toast')],
      },
    },
  },
  {
    id: 'night-mode',
    category: 'System',
    name: 'Night mode',
    description:
      'Turns on dark mode and dims the screen to 30%. Press again in the morning with the Day mode tile.',
    tile: {
      label: 'Night',
      icon: 'moon',
      colour: '#8B7CF6',
      graph: {
        nodes: [
          press,
          node('dark', 'action.setSetting', { setting: 'darkMode', value: true }, 288),
          node('dim', 'action.setSetting', { setting: 'brightness', level: 30 }, 576),
        ],
        edges: [wire('press', 'out', 'dark'), wire('dark', 'out', 'dim')],
      },
    },
  },
  {
    id: 'day-mode',
    category: 'System',
    name: 'Day mode',
    description: 'Turns off dark mode and sets the screen to full brightness.',
    tile: {
      label: 'Day',
      icon: 'sun',
      colour: '#F5B63D',
      graph: {
        nodes: [
          press,
          node('light', 'action.setSetting', { setting: 'darkMode', value: false }, 288),
          node('bright', 'action.setSetting', { setting: 'brightness', level: 100 }, 576),
        ],
        edges: [wire('press', 'out', 'light'), wire('light', 'out', 'bright')],
      },
    },
  },
  {
    id: 'meeting-ready',
    category: 'Meetings',
    name: 'Ready for a meeting',
    description:
      'Turns the sound up to 60%, pauses music and pops up a reminder to check your camera.',
    tile: {
      label: 'Meeting',
      icon: 'video',
      colour: '#4FA3F7',
      graph: {
        nodes: [
          press,
          node('pause', 'action.mediaKey', { key: 'playPause' }, 288),
          node('vol', 'action.setSetting', { setting: 'volume', level: 60 }, 576),
          node(
            'toast',
            'action.toast',
            {
              title: 'Ready',
              body: 'Check your camera and lighting.',
              icon: '🎥',
              colour: '#4FA3F7',
              seconds: 5,
              position: 'top-center',
            },
            864,
          ),
        ],
        edges: [
          wire('press', 'out', 'pause'),
          wire('pause', 'out', 'vol'),
          wire('vol', 'out', 'toast'),
        ],
      },
    },
  },

  // Video editing (DaVinci Resolve)
  resolveKey('play', 'Play', 'play', '#22D3C5'),
  resolveKey('reverse', 'Back (J)', 'skip-back'),
  resolveKey('stop', 'Stop (K)', 'pause'),
  resolveKey('forward', 'Forward (L)', 'skip-forward'),
  resolveKey('blade', 'Split', 'scissors', '#FF7A59'),
  resolveKey('ripple', 'Ripple delete', 'trash-2', '#F25C6E'),
  resolveKey('in', 'Mark in', 'arrow-right'),
  resolveKey('out', 'Mark out', 'arrow-left'),
  resolveKey('marker', 'Marker', 'flag', '#4FA3F7'),
  resolveKey('snapping', 'Snapping', 'zap'),
  resolveKey('undo', 'Undo', 'undo-2'),
  resolveKey('redo', 'Redo', 'redo-2'),
  resolveKey('save', 'Save', 'save'),
  resolveKey('still', 'Grab still', 'camera'),
  resolveKey('pageEdit', 'Edit page', 'layout-grid', '#8B7CF6'),
  resolveKey('pageCut', 'Cut page', 'scissors', '#8B7CF6'),
  resolveKey('pageColor', 'Color page', 'palette', '#8B7CF6'),
  resolveKey('pageFairlight', 'Fairlight page', 'audio-lines', '#8B7CF6'),
  resolveKey('pageDeliver', 'Deliver page', 'upload', '#8B7CF6'),
  {
    id: 'resolve-render',
    category: 'Video editing',
    plugin: 'davinci-resolve',
    name: 'Resolve: render now',
    description:
      'Adds the timeline to the render queue with your Deliver settings and starts rendering. Needs Resolve Studio and the DaVinci Resolve plugin. Hold, so it never starts by accident.',
    tile: {
      label: 'Render',
      icon: 'rocket',
      colour: '#FF7A59',
      graph: held('davinci-resolve.render', { preset: '', start: true }),
    },
  },
  {
    id: 'resolve-named-marker',
    category: 'Video editing',
    plugin: 'davinci-resolve',
    name: 'Resolve: red “fix” marker',
    description:
      'Adds a red marker named Fix at the playhead, so you can find problem spots later.',
    tile: {
      label: 'Fix this',
      icon: 'flag',
      colour: '#F25C6E',
      graph: simple('davinci-resolve.marker', { color: 'Red', name: 'Fix', note: '' }),
    },
  },
  {
    id: 'resolve-timecode',
    category: 'Video editing',
    plugin: 'davinci-resolve',
    name: 'Resolve: timecode',
    description:
      'Shows the playhead timecode and timeline name, every 2 seconds. Tap to save the project.',
    tile: {
      label: 'Timecode',
      icon: 'clock',
      colour: '#212833',
      appearanceBindings: [bind('label', '{{state.timecode || "Timecode"}}')],
      graph: {
        nodes: [
          node('tick', 'trigger.schedule', { cron: '*/2 * * * * *' }, 0),
          node('info', 'davinci-resolve.info', {}, 288),
          press,
          node('save', 'davinci-resolve.save', {}, 288, 160),
        ].map((n) => (n.id === 'press' ? { ...n, position: at(0, 160) } : n)),
        edges: [wire('tick', 'out', 'info'), wire('press', 'out', 'save')],
      },
    },
  },

  // Gaming (Windows)
  keyTile(
    'gamebar-open',
    'Gaming',
    'Xbox Game Bar',
    'Opens the Xbox Game Bar over your game.',
    { label: 'Game Bar', icon: 'gamepad-2', colour: '#107C10' },
    'win+g',
  ),
  keyTile(
    'gamebar-clip',
    'Gaming',
    'Game Bar: clip the last 30 seconds',
    'Saves the last moments of your game with Xbox Game Bar (turn on background recording in Settings › Gaming › Captures), and pops up when it has.',
    { label: 'Clip that', icon: 'save', colour: '#107C10' },
    'win+alt+g',
    {
      title: 'Clip requested',
      body: 'Game Bar saves it to Videos › Captures if background recording is on.',
      icon: '🎬',
      colour: '#107C10',
    },
  ),
  recordKey(
    'gamebar-record',
    'Game Bar: record',
    'Starts or stops a Game Bar recording, turns red while recording, and pops up each time.',
    'win+alt+r',
    'Game Bar',
  ),
  keyTile(
    'gamebar-screenshot',
    'Gaming',
    'Game Bar: screenshot',
    'Takes a Game Bar screenshot of your game and pops up to say so.',
    { label: 'Screenshot', icon: 'camera', colour: '#107C10' },
    'win+alt+printscreen',
    { title: 'Screenshot requested', body: 'Game Bar saves it to Videos › Captures.', icon: '📸' },
  ),
  keyTile(
    'gamebar-mic',
    'Gaming',
    'Game Bar: mic on or off',
    'Turns the Game Bar recording mic on or off.',
    { label: 'Capture mic', icon: 'mic' },
    'win+alt+m',
    { title: 'Capture mic', body: 'Game Bar switched its microphone.', icon: '🎙️' },
  ),
  keyTile(
    'nvidia-replay',
    'Gaming',
    'NVIDIA: save instant replay',
    'Saves the NVIDIA instant replay (turn Instant Replay on in the NVIDIA app first), and pops up when it has.',
    { label: 'Save replay', icon: 'save', colour: '#76B900' },
    'alt+f10',
    {
      title: 'Replay requested',
      body: 'NVIDIA saves it to Videos if Instant Replay is on.',
      icon: '🎬',
      colour: '#76B900',
    },
  ),
  recordKey(
    'nvidia-record',
    'NVIDIA: record',
    'Starts or stops NVIDIA recording, turns red while recording, and pops up each time.',
    'alt+f9',
    'NVIDIA',
  ),
  keyTile(
    'nvidia-overlay',
    'Gaming',
    'NVIDIA overlay',
    'Opens the NVIDIA app overlay.',
    { label: 'NVIDIA', icon: 'layout-grid', colour: '#76B900' },
    'alt+z',
  ),
  keyTile(
    'nvidia-screenshot',
    'Gaming',
    'NVIDIA: screenshot',
    'Takes a screenshot with the NVIDIA app.',
    { label: 'Screenshot', icon: 'camera', colour: '#76B900' },
    'alt+f1',
    { title: 'Screenshot requested', body: 'NVIDIA saves it to Videos.', icon: '📸' },
  ),
  keyTile(
    'amd-replay',
    'Gaming',
    'AMD: save instant replay',
    'Saves the AMD Software instant replay, and pops up when it has.',
    { label: 'Save replay', icon: 'save', colour: '#ED1C24' },
    'ctrl+shift+s',
    {
      title: 'Replay requested',
      body: 'AMD Software saves it to Videos › Radeon ReLive if Instant Replay is on.',
      icon: '🎬',
    },
  ),
  recordKey(
    'amd-record',
    'AMD: record',
    'Starts or stops AMD Software recording, turns red while recording, and pops up each time.',
    'ctrl+shift+e',
    'AMD Software',
  ),
  keyTile(
    'steam-screenshot',
    'Gaming',
    'Steam: screenshot',
    'Takes a Steam screenshot (F12) in the game you are playing.',
    { label: 'Steam shot', icon: 'camera', colour: '#1B2838' },
    'f12',
    { title: 'Screenshot requested', body: 'Find it in Steam › View › Screenshots.', icon: '📸' },
  ),
  steamGame('steam-cs2', '730', 'Counter-Strike 2', 'gamepad-2'),
  steamGame('steam-dota2', '570', 'Dota 2', 'gamepad-2'),
  {
    id: 'steam-library',
    category: 'Gaming',
    name: 'Steam library',
    description: 'Opens your Steam games library.',
    tile: {
      label: 'Steam',
      icon: 'gamepad-2',
      colour: '#1B2838',
      graph: simple('action.openUrl', { url: 'steam://open/games' }),
    },
  },
  {
    id: 'steam-friends',
    category: 'Gaming',
    name: 'Steam friends',
    description: 'Opens your Steam friends list.',
    tile: {
      label: 'Friends',
      icon: 'users',
      colour: '#1B2838',
      graph: simple('action.openUrl', { url: 'steam://open/friends' }),
    },
  },
  {
    id: 'steam-bigpicture',
    category: 'Gaming',
    name: 'Steam Big Picture',
    description: 'Opens Steam in Big Picture mode, for playing on the TV.',
    tile: {
      label: 'Big Picture',
      icon: 'monitor',
      colour: '#1B2838',
      graph: simple('action.openUrl', { url: 'steam://open/bigpicture' }),
    },
  },
  {
    id: 'medal-clip',
    category: 'Gaming',
    plugin: 'medal',
    name: 'Medal: clip that',
    description:
      'Clips the last moments of your game with Medal without leaving it. Pops up with the clip’s name once it is in your Medal library, or says why if Medal saved nothing.',
    tile: {
      label: 'Clip it',
      icon: 'video',
      colour: '#F5B63D',
      graph: {
        nodes: [
          press,
          node('clip', 'medal.clip', {}, 288),
          node(
            'saved',
            'action.toast',
            {
              title: 'Clip saved',
              body: '',
              icon: '🎬',
              colour: '#F5B63D',
              seconds: 4,
              position: 'top-center',
            },
            576,
          ),
          node(
            'nothing',
            'action.toast',
            {
              title: 'No clip saved',
              body: '',
              icon: '⚠️',
              colour: '#F25C6E',
              seconds: 8,
              position: 'top-center',
            },
            576,
            160,
          ),
        ],
        edges: [
          wire('press', 'out', 'clip'),
          wire('clip', 'saved', 'saved'),
          wire('clip', 'name', 'saved', 'body'),
          wire('clip', 'nothing', 'nothing'),
          wire('clip', 'problem', 'nothing', 'body'),
        ],
      },
    },
  },
  {
    id: 'medal-screenshot',
    category: 'Gaming',
    plugin: 'medal',
    name: 'Medal: screenshot',
    description:
      "Takes a screenshot with Medal (set Medal's screenshot hotkey in the plugin settings) and pops up once it is in your library, or says why not.",
    tile: {
      label: 'Screenshot',
      icon: 'camera',
      colour: '#F5B63D',
      graph: {
        nodes: [
          press,
          node('shot', 'medal.screenshot', {}, 288),
          node(
            'saved',
            'action.toast',
            {
              title: 'Screenshot saved',
              body: '',
              icon: '📸',
              colour: '#F5B63D',
              seconds: 4,
              position: 'top-center',
            },
            576,
          ),
          node(
            'nothing',
            'action.toast',
            {
              title: 'No screenshot saved',
              body: '',
              icon: '⚠️',
              colour: '#F25C6E',
              seconds: 8,
              position: 'top-center',
            },
            576,
            160,
          ),
        ],
        edges: [
          wire('press', 'out', 'shot'),
          wire('shot', 'saved', 'saved'),
          wire('shot', 'name', 'saved', 'body'),
          wire('shot', 'nothing', 'nothing'),
          wire('shot', 'problem', 'nothing', 'body'),
        ],
      },
    },
  },
  {
    id: 'medal-record',
    category: 'Gaming',
    plugin: 'medal',
    name: 'Medal: record',
    description:
      'Starts or stops a full Medal recording, turns red while recording, and pops up each time.',
    tile: {
      label: 'Record',
      icon: 'video',
      colour: '#212833',
      appearanceBindings: [bind('colour', '{{state.recording ? "#F25C6E" : "#212833"}}')],
      graph: {
        nodes: [
          press,
          node('rec', 'medal.record', {}, 288),
          popup(
            'on',
            { title: 'Recording', body: 'Medal started recording.', icon: '🔴', colour: '#F25C6E' },
            576,
          ),
          popup(
            'off',
            { title: 'Recording stopped', body: 'Medal saves it to your library.', icon: '💾' },
            576,
            160,
          ),
        ],
        edges: [
          wire('press', 'out', 'rec'),
          wire('rec', 'started', 'on'),
          wire('rec', 'stopped', 'off'),
        ],
      },
    },
  },
  {
    id: 'gaming-break',
    category: 'Gaming',
    name: 'Gaming break reminder',
    description:
      'Press when you start playing: after an hour a pop-up reminds you to stretch and drink some water. The key shows the time left; hold it to cancel.',
    tile: {
      label: 'Break in 1h',
      icon: 'timer',
      colour: '#212833',
      concurrency: 'restart',
      appearanceBindings: [
        bind('label', '{{state.left || "Break in 1h"}}'),
        bind('colour', '{{state.left ? "#4FA3F7" : "#212833"}}'),
      ],
      graph: {
        nodes: [
          press,
          node('count', 'logic.countdown', { seconds: 3600, key: 'left' }, 288),
          popup(
            'pop',
            {
              title: 'Time for a break',
              body: 'An hour in: stand up, stretch and grab some water.',
              icon: '🧃',
              colour: '#4FA3F7',
            },
            576,
          ),
          node('hold', 'trigger.longPress', {}, 0, 160),
          popup(
            'cancelled',
            { title: 'Break reminder off', body: 'No reminder this time.', icon: '⏹️' },
            288,
            160,
          ),
        ],
        edges: [
          wire('press', 'out', 'count'),
          wire('count', 'out', 'pop'),
          wire('hold', 'out', 'cancelled'),
        ],
      },
    },
  },

  // Windows
  keyTile(
    'win-task-manager',
    'Windows',
    'Task Manager',
    'Opens Task Manager, e.g. to close a frozen game.',
    { label: 'Task Manager', icon: 'gauge' },
    'ctrl+shift+escape',
  ),
  keyTile(
    'win-snip',
    'Windows',
    'Snipping Tool',
    'Starts a screen snip; drag to choose what to capture.',
    { label: 'Snip', icon: 'scissors' },
    'win+shift+s',
  ),
  keyTile(
    'win-clipboard',
    'Windows',
    'Clipboard history',
    'Opens clipboard history.',
    { label: 'Clipboard', icon: 'clipboard' },
    'win+v',
  ),
  keyTile(
    'win-explorer',
    'Windows',
    'File Explorer',
    'Opens File Explorer.',
    { label: 'Files', icon: 'folder-open' },
    'win+e',
  ),
  keyTile(
    'win-settings',
    'Windows',
    'Windows Settings',
    'Opens Settings.',
    { label: 'Settings', icon: 'settings' },
    'win+i',
  ),
  keyTile(
    'win-run',
    'Windows',
    'Run',
    'Opens the Run box.',
    { label: 'Run', icon: 'terminal' },
    'win+r',
  ),
  keyTile(
    'win-quick',
    'Windows',
    'Quick settings',
    'Opens quick settings: Wi-Fi, Bluetooth, sound and more.',
    { label: 'Quick settings', icon: 'sliders-horizontal' },
    'win+a',
  ),
  keyTile(
    'win-notifications',
    'Windows',
    'Notifications',
    'Opens the notification centre and calendar.',
    { label: 'Notifications', icon: 'bell' },
    'win+n',
  ),
  keyTile(
    'win-project',
    'Windows',
    'Project to a screen',
    'Chooses how to use a second screen or TV.',
    { label: 'Project', icon: 'monitor' },
    'win+p',
  ),
  keyTile(
    'win-task-view',
    'Windows',
    'Task view',
    'Shows every window and desktop.',
    { label: 'Task view', icon: 'layout-grid' },
    'win+tab',
  ),
  keyTile(
    'win-snap-left',
    'Windows',
    'Snap window left',
    'Snaps the front window to the left half.',
    { label: 'Snap left', icon: 'arrow-left' },
    'win+left',
  ),
  keyTile(
    'win-snap-right',
    'Windows',
    'Snap window right',
    'Snaps the front window to the right half.',
    { label: 'Snap right', icon: 'arrow-right' },
    'win+right',
  ),
  keyTile(
    'win-maximise',
    'Windows',
    'Maximise window',
    'Makes the front window fill the screen.',
    { label: 'Maximise', icon: 'maximize' },
    'win+up',
  ),
  keyTile(
    'win-minimise-all',
    'Windows',
    'Minimise all windows',
    'Minimises every window.',
    { label: 'Minimise all', icon: 'minimize' },
    'win+m',
  ),
  keyTile(
    'win-desktop-new',
    'Windows',
    'New desktop',
    'Makes a new virtual desktop and switches to it.',
    { label: 'New desktop', icon: 'plus' },
    'win+ctrl+d',
    { title: 'New desktop', body: 'You are on a fresh desktop.', icon: '🖥️' },
  ),
  keyTile(
    'win-desktop-next',
    'Windows',
    'Next desktop',
    'Switches to the next virtual desktop.',
    { label: 'Next desktop', icon: 'arrow-right' },
    'win+ctrl+right',
  ),
  keyTile(
    'win-desktop-previous',
    'Windows',
    'Previous desktop',
    'Switches to the previous virtual desktop.',
    { label: 'Previous desktop', icon: 'arrow-left' },
    'win+ctrl+left',
  ),
  keyTile(
    'win-desktop-close',
    'Windows',
    'Close this desktop',
    'Closes the current virtual desktop; its windows move to the next one.',
    { label: 'Close desktop', icon: 'x' },
    'win+ctrl+f4',
    { title: 'Desktop closed', body: 'Its windows moved to the next desktop.', icon: '🗂️' },
  ),
]

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Meetings',
  'Media and sound',
  'Sliders',
  'Live tiles',
  'Voicemeeter',
  'Soundpad',
  'Streaming',
  'Gaming',
  'Windows',
  'Video editing',
  'Lights',
  'Home',
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
    id: 'page-home',
    name: 'Home',
    description:
      'Lights, a scene, brightness and a sensor from Home Assistant. Needs the Home Assistant plugin.',
    cols: 3,
    rows: 3,
    tiles: [
      { template: 'ha-light', col: 0, row: 0 },
      { template: 'ha-light', col: 1, row: 0, label: 'Lamp' },
      { template: 'ha-scene', col: 2, row: 0 },
      { template: 'ha-sensor', col: 0, row: 1 },
      { template: 'popup-date', col: 1, row: 1 },
      { template: 'live-weather', col: 2, row: 1 },
      { template: 'ha-brightness', col: 0, row: 2, w: 3 },
    ],
  },
  {
    id: 'page-streaming',
    name: 'Streaming',
    description:
      'OBS scenes that light up when live, record, go live (hold), mic mute, clip it and your Key Light. Needs the OBS Studio plugin.',
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'obs-scene-camera', col: 0, row: 0 },
      { template: 'obs-scene-screen', col: 1, row: 0 },
      { template: 'obs-scene-brb', col: 2, row: 0 },
      { template: 'obs-mic', col: 0, row: 1 },
      { template: 'obs-record', col: 1, row: 1 },
      { template: 'obs-stream', col: 2, row: 1 },
      { template: 'obs-replay', col: 0, row: 2 },
      { template: 'live-now-playing', col: 1, row: 2, w: 2 },
      { template: 'keylight-brightness', col: 0, row: 3, w: 3 },
    ],
  },
  {
    id: 'page-lights',
    name: 'Lights',
    description: 'Key Lights and Hue: on and off, brightness sliders, warm light and a scene.',
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'keylight-toggle', col: 0, row: 0 },
      { template: 'keylight-warm', col: 1, row: 0 },
      { template: 'hue-toggle', col: 2, row: 0 },
      { template: 'hue-scene', col: 0, row: 1 },
      { template: 'hue-connect', col: 1, row: 1 },
      { template: 'night-mode', col: 2, row: 1 },
      { template: 'keylight-brightness', col: 0, row: 2, w: 3 },
      { template: 'hue-brightness', col: 0, row: 3, w: 3 },
    ],
  },
  {
    id: 'page-work',
    name: 'Workday',
    description:
      'Slack status and pausing, meeting prep, focus timer, reminders and output switching.',
    cols: 3,
    rows: 4,
    tiles: [
      { template: 'slack-meeting', col: 0, row: 0 },
      { template: 'slack-focus', col: 1, row: 0 },
      { template: 'slack-lunch', col: 2, row: 0 },
      { template: 'slack-dnd', col: 0, row: 1 },
      { template: 'slack-clear', col: 1, row: 1 },
      { template: 'meeting-ready', col: 2, row: 1 },
      { template: 'timer-25', col: 0, row: 2 },
      { template: 'audio-switch', col: 1, row: 2 },
      { template: 'reminder-water', col: 2, row: 2 },
      { template: 'day-mode', col: 0, row: 3 },
      { template: 'night-mode', col: 1, row: 3 },
      { template: 'reminder-stand', col: 2, row: 3 },
    ],
  },
  {
    id: 'page-resolve',
    name: 'DaVinci Resolve',
    description:
      'Play, J/K/L, split, ripple delete, in and out, markers, undo, pages and save, with Resolve’s shortcuts. Render and the timecode tile need the DaVinci Resolve plugin.',
    cols: 4,
    rows: 4,
    tiles: [
      { template: 'resolve-reverse', col: 0, row: 0 },
      { template: 'resolve-stop', col: 1, row: 0 },
      { template: 'resolve-forward', col: 2, row: 0 },
      { template: 'resolve-play', col: 3, row: 0 },
      { template: 'resolve-in', col: 0, row: 1 },
      { template: 'resolve-out', col: 1, row: 1 },
      { template: 'resolve-blade', col: 2, row: 1 },
      { template: 'resolve-ripple', col: 3, row: 1 },
      { template: 'resolve-marker', col: 0, row: 2 },
      { template: 'resolve-named-marker', col: 1, row: 2 },
      { template: 'resolve-undo', col: 2, row: 2 },
      { template: 'resolve-save', col: 3, row: 2 },
      { template: 'resolve-pageEdit', col: 0, row: 3 },
      { template: 'resolve-pageColor', col: 1, row: 3 },
      { template: 'resolve-pageDeliver', col: 2, row: 3 },
      { template: 'resolve-render', col: 3, row: 3 },
    ],
  },
  {
    id: 'page-gaming',
    name: 'Gaming',
    description:
      'Clip and record with Game Bar or Medal, NVIDIA replay, voice chat mute, volume, Task Manager and a break reminder, all without leaving your game.',
    cols: 4,
    rows: 4,
    tiles: [
      { template: 'gamebar-clip', col: 0, row: 0 },
      { template: 'gamebar-record', col: 1, row: 0 },
      { template: 'gamebar-screenshot', col: 2, row: 0 },
      { template: 'nvidia-replay', col: 3, row: 0 },
      { template: 'mute-discord', col: 0, row: 1 },
      { template: 'discord-deafen', col: 1, row: 1 },
      { template: 'gamebar-open', col: 2, row: 1 },
      { template: 'win-task-manager', col: 3, row: 1 },
      { template: 'live-now-playing', col: 0, row: 2, w: 2 },
      { template: 'gaming-break', col: 2, row: 2 },
      { template: 'steam-library', col: 3, row: 2 },
      { template: 'slider-volume', col: 0, row: 3, w: 4 },
    ],
  },
  {
    id: 'page-system',
    name: 'System stats',
    description:
      'CPU, memory and disk gauges with live charts of CPU, memory and download speed. Tap a chart on the phone to scroll back.',
    cols: 3,
    rows: 5,
    tiles: [
      { template: 'stat-cpu', col: 0, row: 0 },
      { template: 'stat-memory', col: 1, row: 0 },
      { template: 'stat-disk', col: 2, row: 0 },
      { template: 'stat-cpu-chart', col: 0, row: 1, w: 3 },
      { template: 'stat-memory-chart', col: 0, row: 2, w: 3 },
      { template: 'stat-network-chart', col: 0, row: 3, w: 3, h: 2 },
    ],
  },
  {
    id: 'page-medal',
    name: 'Medal',
    description:
      'Clip, screenshot and record with Medal, with pop-ups when clips are saved. Needs the Medal plugin.',
    cols: 3,
    rows: 2,
    tiles: [
      { template: 'medal-clip', col: 0, row: 0, w: 2 },
      { template: 'medal-screenshot', col: 2, row: 0 },
      { template: 'medal-record', col: 0, row: 1 },
      { template: 'mute-discord', col: 1, row: 1 },
      { template: 'gaming-break', col: 2, row: 1 },
    ],
  },
  {
    id: 'page-windows',
    name: 'Windows',
    description:
      'Snap windows, switch virtual desktops, snip, clipboard history, Task Manager and quick settings.',
    cols: 4,
    rows: 4,
    tiles: [
      { template: 'win-snap-left', col: 0, row: 0 },
      { template: 'win-maximise', col: 1, row: 0 },
      { template: 'win-snap-right', col: 2, row: 0 },
      { template: 'win-minimise-all', col: 3, row: 0 },
      { template: 'win-desktop-previous', col: 0, row: 1 },
      { template: 'win-task-view', col: 1, row: 1 },
      { template: 'win-desktop-next', col: 2, row: 1 },
      { template: 'win-desktop-new', col: 3, row: 1 },
      { template: 'win-snip', col: 0, row: 2 },
      { template: 'win-clipboard', col: 1, row: 2 },
      { template: 'win-explorer', col: 2, row: 2 },
      { template: 'win-task-manager', col: 3, row: 2 },
      { template: 'win-quick', col: 0, row: 3 },
      { template: 'win-notifications', col: 1, row: 3 },
      { template: 'win-settings', col: 2, row: 3 },
      { template: 'win-desktop-close', col: 3, row: 3 },
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
