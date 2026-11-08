import { describe, expect, it } from 'vitest'
import { APP_COMMANDS, parseCombo, type Graph } from '../src/index.ts'
import { mockPlatform, node, press, setup, tile, wire } from './helpers.ts'

const one = (n: ReturnType<typeof node>): Graph => ({
  nodes: [node('p', 'trigger.press'), n],
  edges: [wire('p.out', `${n.id}.in`)],
})

describe('App command', () => {
  it('has valid shortcuts for every OS it lists', () => {
    for (const c of APP_COMMANDS) {
      for (const keys of Object.values(c.keys))
        expect(() => parseCombo(keys), `${c.id}: ${keys}`).not.toThrow()
    }
  })

  it('brings the app forward, then presses the right keys for this OS', async () => {
    const { engine, platform } = setup()
    await engine.trigger(
      tile(one(node('z', 'action.appCommand', { command: 'zoom.mute', focus: true }))),
      press,
    )
    expect(platform.openApp).toHaveBeenCalledWith('zoom.us')
    expect(platform.pressCombo).toHaveBeenCalledWith({ modifiers: ['meta', 'shift'], key: 'a' })

    const windows = mockPlatform('win32')
    const win = setup({ platform: windows })
    const r = await win.engine.trigger(
      tile(one(node('z', 'action.appCommand', { command: 'zoom.mute', focus: false }))),
      press,
    )
    expect(r?.error).toBeUndefined()
    expect(windows.openApp).not.toHaveBeenCalled()
    expect(windows.pressCombo).toHaveBeenCalledWith({ modifiers: ['alt'], key: 'a' })
  })

  it('says when a command has no shortcut on this OS', async () => {
    const { engine } = setup({ platform: mockPlatform('linux') })
    const result = await engine.trigger(
      tile(one(node('r', 'action.appCommand', { command: 'system.record', focus: false }))),
      press,
    )
    expect(result?.error).toBe("System: Screen recording isn't available on Linux")
  })

  it('refuses unknown commands', async () => {
    const { engine } = setup()
    const result = await engine.trigger(
      tile(one(node('x', 'action.appCommand', { command: 'nope', focus: true }))),
      press,
    )
    expect(result?.error).toContain('Choose a command')
  })
})

describe('Set tile appearance on another tile', () => {
  it('targets the named tile and can remember the look', async () => {
    const calls: unknown[][] = []
    const { engine } = setup({ onAppearance: (...args) => void calls.push(args) })
    await engine.trigger(
      tile(
        one(
          node('s', 'action.setTileAppearance', {
            tile: 'other',
            label: 'Live',
            colour: '',
            icon: 'mic-off',
            reset: false,
            remember: true,
          }),
        ),
      ),
      press,
    )
    expect(calls).toEqual([['other', { label: 'Live', icon: 'mic-off' }, true]])
  })
})
