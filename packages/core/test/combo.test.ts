import { describe, expect, it } from 'vitest'
import { parseCombo, resolveCombo } from '../src/index.ts'

describe('parseCombo', () => {
  it('parses modifiers and a key', () => {
    expect(parseCombo('Cmd+Shift+4')).toEqual({ modifiers: ['meta', 'shift'], key: '4' })
  })

  it('accepts aliases', () => {
    expect(parseCombo('option + return')).toEqual({ modifiers: ['alt'], key: 'enter' })
    expect(parseCombo('Ctrl+/')).toEqual({ modifiers: ['ctrl'], key: 'slash' })
    expect(parseCombo('F5')).toEqual({ modifiers: [], key: 'f5' })
  })

  it.each([
    ['', /Enter a shortcut/],
    ['ctrl+shift', /Add a key/],
    ['ctrl+a+b', /one non-modifier/],
    ['ctrl+banana', /isn't a key/],
  ])('rejects %j', (input, message) => {
    expect(() => parseCombo(input)).toThrow(message)
  })
})

describe('resolveCombo', () => {
  it('maps mod to Cmd on macOS and Ctrl elsewhere', () => {
    const combo = parseCombo('mod+s')
    expect(resolveCombo(combo, 'darwin').modifiers).toEqual(['meta'])
    expect(resolveCombo(combo, 'win32').modifiers).toEqual(['ctrl'])
  })

  it('drops duplicates after resolving', () => {
    expect(resolveCombo(parseCombo('mod+ctrl+c'), 'linux').modifiers).toEqual(['ctrl'])
  })
})
