import { Profile, PROFILE_SCHEMA_VERSION, sampleProfile } from '@tessel/core'
import { createJsonStore, type JsonStore } from '@tessel/server'
import { randomBytes } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const Index = z.object({ activeId: z.string(), order: z.array(z.string()) })
type Index = z.infer<typeof Index>

export interface ProfileSummary {
  id: string
  name: string
}

export const newProfileId = () => `p-${randomBytes(5).toString('hex')}`
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** All profiles on disk: one JSON file each, plus an index with the order and the active one. */
export class ProfileLibrary {
  private profiles = new Map<string, Profile>()
  private stores = new Map<string, JsonStore<Profile>>()
  private index: Index = { activeId: '', order: [] }
  private indexStore: JsonStore<Index>

  constructor(
    private dir: string,
    private warn: (message: string) => void,
  ) {
    this.indexStore = createJsonStore({
      file: join(dir, 'index.json'),
      schemaVersion: 1,
      schema: Index,
      defaults: () => ({ activeId: '', order: [] }),
    })
  }

  async load() {
    this.index = await this.indexStore.load()
    // No index yet (first run or an older install): pick up whatever profile files exist.
    if (this.index.order.length === 0) {
      const files = await readdir(this.dir).catch(() => [] as string[])
      this.index.order = files
        .filter((f) => f.endsWith('.json') && f !== 'index.json')
        .map((f) => f.slice(0, -5))
    }
    for (const id of this.index.order.filter((i) => SAFE_ID.test(i))) {
      try {
        this.profiles.set(id, await this.store(id).load())
      } catch (err) {
        this.warn(`Couldn't open profile "${id}": ${(err as Error).message}`)
      }
    }
    if (this.profiles.size === 0)
      this.profiles.set(sampleProfile.id, structuredClone(sampleProfile))
    this.index.order = this.index.order.filter((id) => this.profiles.has(id))
    for (const id of this.profiles.keys())
      if (!this.index.order.includes(id)) this.index.order.push(id)
    if (!this.profiles.has(this.index.activeId)) this.index.activeId = this.index.order[0] ?? ''
    // Write everything back so the files on disk match what was loaded (and older files get migrated).
    for (const profile of this.profiles.values()) await this.store(profile.id).save(profile)
    await this.indexStore.save(this.index)
  }

  list(): ProfileSummary[] {
    return this.index.order.flatMap((id) => {
      const p = this.profiles.get(id)
      return p ? [{ id, name: p.name }] : []
    })
  }

  get(id: string) {
    return this.profiles.get(id)
  }

  get activeId() {
    return this.index.activeId
  }

  active(): Profile {
    return this.profiles.get(this.index.activeId) as Profile
  }

  has(id: string) {
    return this.profiles.has(id)
  }

  /** Updates a known profile in memory only; call save to write it. */
  put(profile: Profile) {
    if (this.profiles.has(profile.id)) this.profiles.set(profile.id, profile)
  }

  /** Saves a profile. New ids are added to the end of the list. */
  async save(profile: Profile) {
    if (!SAFE_ID.test(profile.id)) throw new Error('Profile id is not valid')
    const isNew = !this.profiles.has(profile.id)
    this.profiles.set(profile.id, profile)
    await this.store(profile.id).save(profile)
    if (isNew) {
      this.index.order.push(profile.id)
      await this.indexStore.save(this.index)
    }
  }

  async setActive(id: string) {
    if (!this.profiles.has(id)) return
    this.index.activeId = id
    await this.indexStore.save(this.index)
  }

  async remove(id: string): Promise<boolean> {
    if (!this.profiles.has(id) || this.profiles.size === 1) return false
    this.profiles.delete(id)
    this.stores.delete(id)
    this.index.order = this.index.order.filter((i) => i !== id)
    if (this.index.activeId === id) this.index.activeId = this.index.order[0] ?? ''
    await this.indexStore.save(this.index)
    await rm(join(this.dir, `${id}.json`), { force: true })
    return true
  }

  /** A name not already used, e.g. "Gaming (2)". */
  uniqueName(name: string) {
    const names = new Set([...this.profiles.values()].map((p) => p.name))
    if (!names.has(name)) return name
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, 34)} (${i})`
      if (!names.has(candidate)) return candidate
    }
  }

  private store(id: string) {
    let store = this.stores.get(id)
    if (!store) {
      store = createJsonStore({
        file: join(this.dir, `${id}.json`),
        schemaVersion: PROFILE_SCHEMA_VERSION,
        schema: Profile,
        defaults: () => ({ ...structuredClone(sampleProfile), id }),
      })
      this.stores.set(id, store)
    }
    return store
  }
}
