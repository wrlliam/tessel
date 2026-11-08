import type { Graph, JsonValue, Tile } from './model.ts'

export interface TileTemplate {
  id: string
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

export const templates: TileTemplate[] = [
  {
    id: 'open-app',
    name: 'Open an app',
    description: 'Opens an app by name. Change the name in the Open app block.',
    tile: {
      label: 'Calculator',
      icon: 'app-window',
      colour: '#22D3C5',
      graph: {
        nodes: [press, node('open', 'action.openApp', { app: 'Calculator' }, 288)],
        edges: [wire('press', 'out', 'open')],
      },
    },
  },
  {
    id: 'mute-discord',
    name: 'Mute mic in Discord',
    description:
      "Presses Discord's mute shortcut. Discord needs a matching keybind in its settings.",
    tile: {
      label: 'Mute',
      icon: 'mic-off',
      colour: '#F25C6E',
      graph: {
        nodes: [press, node('combo', 'action.keyCombo', { combo: 'mod+shift+m' }, 288)],
        edges: [wire('press', 'out', 'combo')],
      },
    },
  },
  {
    id: 'dark-by-time',
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
    id: 'type-email',
    name: 'Type my email',
    description: 'Types the address saved in the "email" variable.',
    tile: {
      label: 'Email',
      icon: 'mail',
      colour: '#F5B63D',
      graph: {
        nodes: [press, node('type', 'action.typeText', { text: '{{var.email}}' }, 288)],
        edges: [wire('press', 'out', 'type')],
      },
    },
    variables: { email: 'you@example.com' },
  },
  {
    id: 'counter',
    name: 'Counter',
    description:
      'Counts presses and shows the count on the tile. A small example of live tile state.',
    tile: {
      label: 'Count',
      icon: 'plus',
      colour: '#8B7CF6',
      appearanceBindings: [{ field: 'label', expression: 'Count: {{var.count ?? 0}}' }],
      graph: {
        nodes: [
          press,
          node(
            'add',
            'data.setVariable',
            { name: 'count', scope: 'global', value: '{{(var.count ?? 0) + 1}}' },
            288,
          ),
        ],
        edges: [wire('press', 'out', 'add')],
      },
    },
  },
  {
    id: 'play-pause',
    name: 'Play / pause',
    description: 'Presses the media play/pause key for whatever is playing.',
    tile: {
      label: 'Play',
      icon: 'play',
      colour: '#22D3C5',
      graph: {
        nodes: [press, node('key', 'action.mediaKey', { key: 'playPause' }, 288)],
        edges: [wire('press', 'out', 'key')],
      },
    },
  },
  {
    id: 'mute-status',
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
    id: 'open-website',
    name: 'Open a website',
    description: 'Opens a link in your browser.',
    tile: {
      label: 'Website',
      icon: 'globe',
      colour: '#4FA3F7',
      graph: {
        nodes: [press, node('url', 'action.openUrl', { url: 'https://example.com' }, 288)],
        edges: [wire('press', 'out', 'url')],
      },
    },
  },
  {
    id: 'lock-screen',
    name: 'Lock screen',
    description: 'Locks the computer. Hold the tile to avoid locking by accident.',
    tile: {
      label: 'Lock',
      icon: 'lock',
      colour: '#161B22',
      graph: {
        nodes: [
          node('hold', 'trigger.longPress', {}, 0),
          node('lock', 'action.lockScreen', {}, 288),
        ],
        edges: [wire('hold', 'out', 'lock')],
      },
    },
  },
]
