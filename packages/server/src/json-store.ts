import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { z } from 'zod'

/** Upgrades data saved at version `from` to version `from + 1`. */
export type Migrations = Record<number, (data: unknown) => unknown>

export interface JsonStoreOptions<T> {
  file: string
  schemaVersion: number
  schema: z.ZodType<T>
  migrations?: Migrations
  defaults: () => T
}

interface Envelope {
  schemaVersion: number
  data: unknown
}

export class NewerSchemaError extends Error {
  constructor(file: string, found: number, supported: number) {
    super(
      `${file} was saved by a newer Tessel (schema ${found}, this build reads up to ${supported}). Update Tessel to open it.`,
    )
  }
}

export interface JsonStore<T> {
  load(): Promise<T>
  save(data: T): Promise<void>
}

export function createJsonStore<T>(opts: JsonStoreOptions<T>): JsonStore<T> {
  const { file, schemaVersion, schema, migrations = {}, defaults } = opts
  // Serialise writes so two saves never race on the same temp-then-rename.
  let queue: Promise<void> = Promise.resolve()

  function migrate(env: Envelope): unknown {
    let { schemaVersion: version, data } = env
    if (version > schemaVersion) throw new NewerSchemaError(file, version, schemaVersion)
    while (version < schemaVersion) {
      const step = migrations[version]
      if (!step) throw new Error(`${file}: no migration from schema ${version}`)
      data = step(data)
      version++
    }
    return data
  }

  async function load(): Promise<T> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaults()
      throw err
    }
    let env: Envelope
    try {
      env = JSON.parse(raw) as Envelope
      if (typeof env.schemaVersion !== 'number') throw new Error('missing schemaVersion')
    } catch {
      await quarantine()
      return defaults()
    }
    const result = schema.safeParse(migrate(env))
    if (!result.success) {
      await quarantine()
      return defaults()
    }
    return result.data
  }

  // Keep unreadable files for the user instead of silently overwriting them.
  async function quarantine() {
    await rename(file, `${file}.corrupt-${Date.now()}`)
  }

  async function write(data: T) {
    const body = JSON.stringify({ schemaVersion, data } satisfies Envelope, null, 2)
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
    const handle = await open(tmp, 'w', 0o600)
    try {
      await handle.writeFile(body, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(tmp, file)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  }

  function save(data: T): Promise<void> {
    const next = queue.then(() => write(schema.parse(data)))
    queue = next.catch(() => undefined)
    return next
  }

  return { load, save }
}
