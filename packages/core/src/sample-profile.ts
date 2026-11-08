import { Profile } from './model.ts'

const press = { id: 'press', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } }
const step = (id: string, type: string, params: Record<string, unknown>, x = 280) => ({
  id,
  type,
  params,
  position: { x, y: 0 },
})
const wire = (from: string, fromPort: string, to: string, toPort = 'in') => ({
  id: `${from}-${fromPort}-${to}-${toPort}`,
  from: { nodeId: from, port: fromPort },
  to: { nodeId: to, port: toPort },
})
/** On press -> one action. */
const simple = (type: string, params: Record<string, unknown>) => ({
  nodes: [press, step('action', type, params)],
  edges: [wire('press', 'out', 'action')],
})

/** Starter profile until the editor lands; also the seed for new installs. */
export const sampleProfile: Profile = Profile.parse({
  id: 'default',
  name: 'Default',
  pages: [
    {
      id: 'home',
      name: 'Home',
      cols: 3,
      rows: 5,
      tiles: [
        {
          id: 'discord',
          label: 'Discord',
          colour: '#4FA3F7',
          position: { col: 0, row: 0 },
          graph: simple('action.openApp', { app: 'Discord' }),
        },
        {
          id: 'calculator',
          label: 'Calculator',
          colour: '#22D3C5',
          position: { col: 1, row: 0 },
          graph: simple('action.openApp', { app: 'Calculator' }),
        },
        { id: 'mute', label: 'Mute mic', colour: '#F25C6E', position: { col: 2, row: 0 } },
        {
          id: 'save',
          label: 'Save',
          colour: '#8B7CF6',
          position: { col: 0, row: 1 },
          graph: simple('action.keyCombo', { combo: 'mod+s' }),
        },
        {
          id: 'dark',
          label: 'Dark mode by time',
          colour: '#212833',
          position: { col: 1, row: 1 },
          graph: {
            nodes: [
              press,
              step('time', 'data.getTime', {}, 0),
              step('if', 'logic.if', {
                condition: { kind: 'compare', left: '{{input.a}}', op: '>=', right: 18 },
              }),
              step('dark', 'action.setSetting', { setting: 'darkMode', value: true }, 560),
              step('light', 'action.setSetting', { setting: 'darkMode', value: false }, 560),
            ],
            edges: [
              wire('press', 'out', 'if'),
              wire('time', 'hour', 'if', 'a'),
              wire('if', 'yes', 'dark'),
              wire('if', 'no', 'light'),
            ],
          },
        },
        {
          id: 'email',
          label: 'Type email',
          colour: '#F5B63D',
          position: { col: 2, row: 1 },
          graph: simple('action.typeText', { text: '{{var.email}}' }),
        },
        {
          id: 'big',
          label: 'Focus',
          colour: '#FF7A59',
          position: { col: 0, row: 2 },
          span: { w: 2, h: 2 },
        },
        { id: 'lock', label: 'Lock', colour: '#161B22', position: { col: 2, row: 2 } },
      ],
    },
  ],
  variables: { email: 'you@example.com' },
})
