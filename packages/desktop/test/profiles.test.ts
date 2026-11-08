import { PROFILE_SCHEMA_VERSION, sampleProfile } from '@tessel/core'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProfileLibrary } from '../src/main/profiles.ts'

async function library(setup?: (dir: string) => Promise<void>) {
  const dir = join(await mkdtemp(join(tmpdir(), 'tessel-lib-')), 'profiles')
  await mkdir(dir)
  await setup?.(dir)
  const warnings: string[] = []
  const lib = new ProfileLibrary(dir, (m) => warnings.push(m))
  await lib.load()
  return { lib, dir, warnings }
}

describe('ProfileLibrary', () => {
  it('starts with the sample profile', async () => {
    const { lib, dir } = await library()
    expect(lib.list()).toEqual([{ id: 'default', name: 'Default' }])
    expect(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).data).toEqual({
      activeId: 'default',
      order: ['default'],
    })
  })

  it('adopts profile files from before the index existed', async () => {
    const { lib } = await library(async (dir) => {
      await writeFile(
        join(dir, 'default.json'),
        JSON.stringify({
          schemaVersion: PROFILE_SCHEMA_VERSION,
          data: { ...sampleProfile, name: 'Mine' },
        }),
      )
    })
    expect(lib.active().name).toBe('Mine')
  })

  it('skips unreadable profiles with a warning and keeps the rest', async () => {
    const { lib, warnings } = await library(async (dir) => {
      await writeFile(
        join(dir, 'index.json'),
        JSON.stringify({
          schemaVersion: 1,
          data: { activeId: 'future', order: ['future', 'default'] },
        }),
      )
      await writeFile(join(dir, 'future.json'), JSON.stringify({ schemaVersion: 99, data: {} }))
      await writeFile(
        join(dir, 'default.json'),
        JSON.stringify({ schemaVersion: 1, data: sampleProfile }),
      )
    })
    expect(lib.list().map((p) => p.id)).toEqual(['default'])
    expect(lib.activeId).toBe('default')
    expect(warnings[0]).toMatch(/future/)
  })

  it('ignores ids that are not safe file names', async () => {
    const { lib } = await library(async (dir) => {
      await writeFile(
        join(dir, 'index.json'),
        JSON.stringify({ schemaVersion: 1, data: { activeId: '../x', order: ['../x'] } }),
      )
    })
    expect(lib.list().map((p) => p.id)).toEqual(['default'])
    await expect(lib.save({ ...sampleProfile, id: '../evil' })).rejects.toThrow()
  })

  it('makes names unique', async () => {
    const { lib } = await library()
    expect(lib.uniqueName('Default')).toBe('Default (2)')
    expect(lib.uniqueName('Work')).toBe('Work')
  })
})
