import { sampleProfile } from '@tessel/core'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { blocksUsed, packProfile, unpackProfile } from '../src/main/transfer.ts'

describe('.tessel files', () => {
  it('round-trips a profile', () => {
    expect(unpackProfile(packProfile(sampleProfile))).toEqual(sampleProfile)
  })

  it('rejects files that are not zips or not Tessel profiles', () => {
    expect(() => unpackProfile(strToU8('hello'))).toThrow("That file isn't a Tessel profile.")
    const other = zipSync({
      'manifest.json': strToU8('{"format":"other","version":1}'),
      'profile.json': strToU8('{}'),
    })
    expect(() => unpackProfile(other)).toThrow("isn't a Tessel profile")
  })

  it('rejects profiles from a newer Tessel', () => {
    const newer = zipSync({
      'manifest.json': strToU8('{"format":"tessel-profile","version":1}'),
      'profile.json': strToU8(JSON.stringify({ schemaVersion: 99, data: sampleProfile })),
    })
    expect(() => unpackProfile(newer)).toThrow(/newer Tessel/)
  })

  it('rejects invalid profiles with the reason', () => {
    const bad = zipSync({
      'manifest.json': strToU8('{"format":"tessel-profile","version":1}'),
      'profile.json': strToU8(
        JSON.stringify({ schemaVersion: 1, data: { id: 'x', name: 'X', pages: [] } }),
      ),
    })
    expect(() => unpackProfile(bad)).toThrow(/isn't valid/)
  })

  it('ignores oversized entries (zip bomb guard)', () => {
    const huge = zipSync({
      'manifest.json': strToU8('{"format":"tessel-profile","version":1}'),
      'profile.json': new Uint8Array(6 * 1024 * 1024),
    })
    expect(() => unpackProfile(huge)).toThrow("isn't a Tessel profile")
  })

  it('lists the blocks a profile uses, flagging unknown ones', () => {
    const names: Record<string, string> = {
      'trigger.press': 'On press',
      'action.openApp': 'Open app',
    }
    const used = blocksUsed(sampleProfile, (t) => names[t])
    expect(used).toContain('Open app')
    expect(used).toContain('action.keyCombo (not installed)')
  })
})
