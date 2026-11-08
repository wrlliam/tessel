import { migrateProfile, Profile, PROFILE_SCHEMA_VERSION } from '@tessel/core'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'

/** A .tessel file is a zip holding manifest.json and profile.json. */
const FORMAT = 'tessel-profile'
const MAX_ENTRY_BYTES = 5 * 1024 * 1024
export const MAX_FILE_BYTES = 10 * 1024 * 1024

const Manifest = z.object({ format: z.literal(FORMAT), version: z.literal(1) })
const Envelope = z.object({ schemaVersion: z.number(), data: z.unknown() })

export class ImportError extends Error {}

export function packProfile(profile: Profile): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: FORMAT, version: 1 })),
    'profile.json': strToU8(
      JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, data: profile }, null, 2),
    ),
  })
}

export function unpackProfile(bytes: Uint8Array): Profile {
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new ImportError('That file is too big to be a Tessel profile.')
  let files: Record<string, Uint8Array>
  try {
    // Only the two expected entries, and only if their declared size is sane (guards against zip bombs).
    files = unzipSync(bytes, {
      filter: (f) =>
        (f.name === 'manifest.json' || f.name === 'profile.json') &&
        f.originalSize <= MAX_ENTRY_BYTES,
    })
  } catch {
    throw new ImportError("That file isn't a Tessel profile.")
  }
  const read = (name: string): unknown => {
    const file = files[name]
    if (!file || file.byteLength > MAX_ENTRY_BYTES)
      throw new ImportError("That file isn't a Tessel profile.")
    try {
      return JSON.parse(strFromU8(file))
    } catch {
      throw new ImportError('That profile file is damaged.')
    }
  }
  if (!Manifest.safeParse(read('manifest.json')).success)
    throw new ImportError("That file isn't a Tessel profile.")
  const envelope = Envelope.safeParse(read('profile.json'))
  if (!envelope.success) throw new ImportError('That profile file is damaged.')
  if (envelope.data.schemaVersion > PROFILE_SCHEMA_VERSION) {
    throw new ImportError('That profile was made with a newer Tessel. Update Tessel to import it.')
  }
  const profile = Profile.safeParse(migrateProfile(envelope.data.schemaVersion, envelope.data.data))
  if (!profile.success)
    throw new ImportError(
      `That profile isn't valid: ${profile.error.issues[0]?.message ?? 'unknown problem'}`,
    )
  return profile.data
}

/** Block names used by a profile, so the user can see what it will be able to do. */
export function blocksUsed(
  profile: Profile,
  nameOf: (type: string) => string | undefined,
): string[] {
  const types = new Set(
    profile.pages.flatMap((p) => p.tiles.flatMap((t) => t.graph.nodes.map((n) => n.type))),
  )
  return [...types].map((t) => nameOf(t) ?? `${t} (not installed)`).sort()
}
