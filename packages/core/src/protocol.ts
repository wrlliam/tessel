import { z } from 'zod'
import type { Profile } from './model.ts'

export const PROTOCOL_VERSION = 1
/** Largest message the server accepts from a phone, in bytes. */
export const MAX_CLIENT_MESSAGE_BYTES = 4096

const TileId = z.string().min(1).max(64)
const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** What the phone is allowed to know about a tile. Graphs never leave the desktop. */
export const PhoneTile = z.object({
  id: TileId,
  label: z.string(),
  icon: z.string().optional(),
  colour: HexColour,
  position: z.object({ col: z.int(), row: z.int() }),
  span: z.object({ w: z.int(), h: z.int() }),
  kind: z.enum(['action', 'folder']),
  /** Folder tiles: the folder page they open. */
  targetPageId: z.string().optional(),
})
export type PhoneTile = z.infer<typeof PhoneTile>

export const PhonePage = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['page', 'folder']),
  cols: z.int(),
  rows: z.int(),
  tiles: z.array(PhoneTile),
})
export type PhonePage = z.infer<typeof PhonePage>

export const PhoneProfile = z.object({
  id: z.string(),
  name: z.string(),
  pages: z.array(PhonePage),
})
export type PhoneProfile = z.infer<typeof PhoneProfile>

export function toPhoneProfile(profile: Profile): PhoneProfile {
  return {
    id: profile.id,
    name: profile.name,
    pages: profile.pages.map((page) => ({
      id: page.id,
      name: page.name,
      kind: page.kind,
      cols: page.cols,
      rows: page.rows,
      tiles: page.tiles.map((t) => {
        const tile: PhoneTile = {
          id: t.id,
          label: t.label,
          colour: t.colour,
          position: t.position,
          span: t.span,
          kind: t.kind,
        }
        if (t.icon !== undefined) tile.icon = t.icon
        if (t.kind === 'folder' && t.targetPageId) tile.targetPageId = t.targetPageId
        return tile
      }),
    })),
  }
}

// Phone -> desktop
export const HelloMessage = z.object({
  type: z.literal('hello'),
  protocol: z.int(),
  token: z.string().min(1).max(128),
  deviceName: z.string().max(64),
})
export const PressMessage = z.object({
  type: z.literal('press'),
  tileId: TileId,
  phase: z.enum(['down', 'up']),
})
export const PageChangeMessage = z.object({
  type: z.literal('pageChange'),
  pageId: z.string().min(1).max(64),
})
export const PingMessage = z.object({ type: z.literal('ping'), t: z.number() })

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMessage,
  PressMessage,
  PageChangeMessage,
  PingMessage,
])
export type ClientMessage = z.infer<typeof ClientMessage>

// Desktop -> phone
export const ProfileMessage = z.object({ type: z.literal('profile'), profile: PhoneProfile })
export const TileStateMessage = z.object({
  type: z.literal('tileState'),
  tileId: TileId,
  label: z.string().optional(),
  colour: HexColour.optional(),
  /** An empty string removes the icon. */
  icon: z.string().optional(),
})
export const PongMessage = z.object({ type: z.literal('pong'), t: z.number() })
export const ErrorCode = z.enum(['unauthorized', 'protocol-mismatch', 'bad-message'])
export type ErrorCode = z.infer<typeof ErrorCode>
export const ErrorMessage = z.object({
  type: z.literal('error'),
  code: ErrorCode,
  message: z.string(),
})

export const ServerMessage = z.discriminatedUnion('type', [
  ProfileMessage,
  TileStateMessage,
  PageChangeMessage,
  PongMessage,
  ErrorMessage,
])
export type ServerMessage = z.infer<typeof ServerMessage>

/** WebSocket close codes in the 4000 private range. */
export const CloseCode = {
  unauthorized: 4401,
  protocolMismatch: 4400,
  revoked: 4403,
  serverStopping: 4503,
} as const

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string }

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Message is not valid JSON' }
  }
  const result = schema.safeParse(data)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}

export const parseClientMessage = (raw: string) => parseWith(ClientMessage, raw)
export const parseServerMessage = (raw: string) => parseWith(ServerMessage, raw)

// Pairing over HTTP
export const PairRequest = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code is 6 digits'),
  deviceName: z.string().trim().min(1).max(64),
})
export type PairRequest = z.infer<typeof PairRequest>

export const PairResponse = z.object({ deviceId: z.string(), token: z.string() })
export type PairResponse = z.infer<typeof PairResponse>
