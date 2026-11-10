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
  kind: z.enum(['action', 'folder', 'slider']),
  /** This tile's own key style, instead of the phone's. */
  style: z.enum(['tinted', 'solid', 'outline', 'glass']).optional(),
  /** A small picture (data: URL) shown instead of the icon. */
  image: z.string().optional(),
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
        if (t.style) tile.style = t.style
        if (t.image) tile.image = t.image
        if (t.kind === 'folder' && t.targetPageId) tile.targetPageId = t.targetPageId
        return tile
      }),
    })),
  }
}

/** How phones look and behave. Set on the desktop, applied by every connected phone. */
export const PhoneSettings = z.object({
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  /** 'tinted' shows a tile's colour on a dark key; 'solid' fills the key with it. */
  keyStyle: z.enum(['tinted', 'solid', 'outline', 'glass']).default('tinted'),
  /** Corners: rounded (20% of the side), square-ish, or round (circles and pills). */
  keyShape: z.enum(['rounded', 'square', 'round']).default('rounded'),
  iconSize: z.enum(['small', 'regular', 'large']).default('regular'),
  /** The small indicator light in each key's corner. */
  lights: z.boolean().default(true),
  labels: z.boolean().default(true),
  labelSize: z.enum(['small', 'regular', 'large']).default('regular'),
  spacing: z.enum(['compact', 'regular', 'roomy']).default('regular'),
  haptics: z.boolean().default(true),
  keepAwake: z.boolean().default(true),
  /** Darkness of the dim overlay when a phone turns Dim screen on, 20 to 90 percent. */
  dimLevel: z.int().min(20).max(90).default(60),
  /**
   * Phone held sideways: 'reflow' lays the keys out again in wide rows, 'fill' stretches the
   * grid to the whole screen, 'fit' keeps keys square, 'rotate' swaps rows and columns.
   */
  landscape: z.enum(['reflow', 'fill', 'fit', 'rotate']).default('reflow'),
  header: z.boolean().default(true),
  /** Let paired phones rename, recolour, re-icon and rearrange keys (never what they do). */
  allowEdit: z.boolean().default(true),
  /** Ask the phone for its location, for weather and other live tiles. */
  shareLocation: z.boolean().default(false),
})
export type PhoneSettings = z.infer<typeof PhoneSettings>
export const defaultPhoneSettings = (): PhoneSettings => PhoneSettings.parse({})

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
  /** 'hold': the phone saw a long press itself (sliders, where dragging decides first). */
  phase: z.enum(['down', 'up', 'hold']),
})
export const PageChangeMessage = z.object({
  type: z.literal('pageChange'),
  pageId: z.string().min(1).max(64),
})
/** A slider tile was dragged to `value` (0 to 100). Phones send these at most ~20 times a second. */
export const SlideMessage = z.object({
  type: z.literal('slide'),
  tileId: TileId,
  value: z.number().min(0).max(100),
})
/** The phone's position, sent only when the desktop asks for it and the person allows it. */
export const LocationMessage = z.object({
  type: z.literal('location'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
})
/**
 * Changes how a key looks, or swaps two keys, from the phone. The desktop only accepts it when
 * "Edit keys on the phone" is on, and never lets a phone change what a key does.
 */
export const EditTileMessage = z.object({
  type: z.literal('editTile'),
  tileId: TileId,
  label: z.string().max(40).optional(),
  colour: HexColour.optional(),
  /** An icon name or one emoji; empty removes the icon. */
  icon: z.string().max(64).optional(),
  /** Another key on the same page to trade places with. */
  swapWith: TileId.optional(),
})
export const PingMessage = z.object({ type: z.literal('ping'), t: z.number() })

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMessage,
  PressMessage,
  PageChangeMessage,
  SlideMessage,
  LocationMessage,
  EditTileMessage,
  PingMessage,
])
export type EditTileMessage = z.infer<typeof EditTileMessage>
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
  /** A picture (data: URL) instead of the icon; an empty string removes it. */
  image: z.string().optional(),
  /** Slider tiles: where the bar sits, 0 to 100. */
  value: z.number().min(0).max(100).optional(),
  /** Lights the key's indicator, e.g. while the app an Open app tile opens is running. */
  active: z.boolean().optional(),
})
export const PongMessage = z.object({ type: z.literal('pong'), t: z.number() })
export const PhoneSettingsMessage = z.object({
  type: z.literal('phoneSettings'),
  settings: PhoneSettings,
})
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
  PhoneSettingsMessage,
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
  /** The token this phone had before, so the new pairing replaces the old one once approved. */
  previousToken: z.string().max(128).optional(),
})
export type PairRequest = z.infer<typeof PairRequest>

export const PairResponse = z.object({ deviceId: z.string(), token: z.string() })
export type PairResponse = z.infer<typeof PairResponse>

/** The code was right; someone at the computer now has to approve the phone. */
export const PairPending = z.object({ requestId: z.string(), secret: z.string() })
export type PairPending = z.infer<typeof PairPending>

/** Asks whether a pending pairing was approved yet. Waits a while for the answer. */
export const PairWaitRequest = z.object({
  requestId: z.string().max(64),
  secret: z.string().max(64),
})
export type PairWaitRequest = z.infer<typeof PairWaitRequest>
