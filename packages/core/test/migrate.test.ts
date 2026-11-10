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

  it('gives old Voicemeeter gain sliders hold to reset', () => {
    const at = { x: 0, y: 0 }
    const v2 = {
      id: 'p',
      name: 'P',
      pages: [
        {
          id: 'pg',
          name: 'Page',
          tiles: [
            {
              id: 'mic',
              kind: 'slider',
              position: { col: 0, row: 0 },
              graph: {
                nodes: [
                  { id: 'slide', type: 'trigger.slide', params: {}, position: at },
                  {
                    id: 'action',
                    type: 'voicemeeter.setGain',
                    params: { target: 'strip', index: 2, gain: 0 },
                    position: at,
                  },
                ],
                edges: [
                  {
                    id: 'e',
                    from: { nodeId: 'slide', port: 'out' },
                    to: { nodeId: 'action', port: 'in' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }
    const tile = Profile.parse(migrateProfile(2, v2)).pages[0]!.tiles[0]!
    expect(tile.graph.nodes.map((n) => n.type)).toEqual([
      'trigger.slide',
      'voicemeeter.setGain',
      'trigger.longPress',
      'voicemeeter.setGain',
      'action.setSlider',
    ])
    expect(tile.graph.nodes[3]!.params).toEqual({ target: 'strip', index: 2, gain: 0 })
    expect(tile.graph.edges).toHaveLength(3)
    // Running it again changes nothing.
    const again = Profile.parse(
      migrateProfile(2, { ...v2, pages: [{ ...v2.pages[0]!, tiles: [tile] }] }),
    )
    expect(again.pages[0]!.tiles[0]!.graph.nodes).toHaveLength(5)
  })
})
