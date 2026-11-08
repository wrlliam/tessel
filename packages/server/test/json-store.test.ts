import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createJsonStore, NewerSchemaError } from '../src/json-store.ts'

const Schema = z.object({ name: z.string(), count: z.number() })
let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tessel-store-'))
  file = join(dir, 'data.json')
})

const store = (migrations = {}) =>
  createJsonStore({
    file,
    schemaVersion: 2,
    schema: Schema,
    migrations,
    defaults: () => ({ name: 'default', count: 0 }),
  })

describe('json store', () => {
  it('returns defaults when the file is missing', async () => {
    expect(await store().load()).toEqual({ name: 'default', count: 0 })
  })

  it('round-trips data with a schemaVersion envelope and leaves no temp files', async () => {
    const s = store()
    await s.save({ name: 'a', count: 1 })
    expect(await s.load()).toEqual({ name: 'a', count: 1 })
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(2)
    expect(await readdir(dir)).toEqual(['data.json'])
  })

  it('serialises concurrent saves so the last one wins', async () => {
    const s = store()
    await Promise.all([1, 2, 3, 4, 5].map((count) => s.save({ name: 'x', count })))
    expect((await s.load()).count).toBe(5)
  })

  it('migrates older files', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, data: { title: 'old' } }))
    const s = store({ 1: (d: unknown) => ({ name: (d as { title: string }).title, count: 0 }) })
    expect(await s.load()).toEqual({ name: 'old', count: 0 })
  })

  it('refuses files from a newer version instead of overwriting them', async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 9, data: {} }))
    await expect(store().load()).rejects.toBeInstanceOf(NewerSchemaError)
  })

  it('moves corrupt files aside and starts fresh', async () => {
    await writeFile(file, '{ not json')
    expect(await store().load()).toEqual({ name: 'default', count: 0 })
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith('data.json.corrupt-'))).toBe(true)
  })

  it('rejects invalid data on save', async () => {
    await expect(store().save({ name: 'a' } as never)).rejects.toThrow()
  })
})
