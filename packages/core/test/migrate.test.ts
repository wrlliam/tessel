import { describe, expect, it } from 'vitest'
import { migrateProfile, Profile } from '../src/index.ts'

describe('profile migrations', () => {
  it('makes the old Discord mute tile focus Discord first', () => {
    const v1 = {
      id: 'p',
      name: 'Old',
      pages: [
        {
          id: 'home',
          name: 'Home',
          tiles: [
            {
              id: 'mute',
              label: 'Mute',
              position: { col: 0, row: 0 },
              graph: {
                nodes: [
                  { id: 'press', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
                  {
                    id: 'combo',
                    type: 'action.keyCombo',
                    params: { combo: 'mod+shift+m' },
                    position: { x: 288, y: 0 },
                  },
                ],
                edges: [
                  {
                    id: 'e',
                    from: { nodeId: 'press', port: 'out' },
                    to: { nodeId: 'combo', port: 'in' },
                  },
                ],
              },
            },
            {
              id: 'other',
              label: 'Copy',
              position: { col: 1, row: 0 },
              graph: {
                nodes: [
                  { id: 'press', type: 'trigger.press', params: {}, position: { x: 0, y: 0 } },
                  {
                    id: 'combo',
                    type: 'action.keyCombo',
                    params: { combo: 'mod+c' },
                    position: { x: 288, y: 0 },
                  },
                ],
                edges: [],
              },
            },
          ],
        },
      ],
    }
    const p = Profile.parse(migrateProfile(1, v1))
    const [mute, other] = p.pages[0]!.tiles
    expect(mute!.graph.nodes[1]).toMatchObject({
      id: 'combo',
      type: 'action.appCommand',
      params: { command: 'discord.mute', focus: true },
    })
    expect(other!.graph.nodes[1]!.type).toBe('action.keyCombo')
  })
})
