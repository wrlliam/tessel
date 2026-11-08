// Blocks for live tiles: things that change on their own, like the weather, what's playing and
// how long a timer has left. Pair them with On schedule (cron takes seconds) or On page open.
import { z } from 'zod'
import { defineBlock, flowIn, flowOut } from '../block.ts'
import { UnsupportedError, UserFacingError } from '../platform.ts'

const text = (id: string, label = id) => ({
  id,
  kind: 'value' as const,
  type: 'string' as const,
  label,
})
const num = (id: string, label = id) => ({
  id,
  kind: 'value' as const,
  type: 'number' as const,
  label,
})

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Countdown

export const countdown = defineBlock({
  id: 'logic.countdown',
  category: 'logic',
  name: 'Countdown',
  description:
    'Waits, keeping the time left in tile state so the tile can show it, e.g. label {{state.left}}. Stopping the tile (a press under Restart, or Stop) cancels it.',
  inputs: [flowIn],
  outputs: [flowOut],
  paramsSchema: z.object({
    seconds: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 60),
    key: z
      .string()
      .regex(/^[a-zA-Z_]\w*$/, 'Use letters, numbers and _')
      .max(32),
  }),
  fields: [
    { key: 'seconds', label: 'Seconds', widget: 'number', placeholder: '300' },
    {
      key: 'key',
      label: 'Keep time left in',
      widget: 'text',
      placeholder: 'left',
      help: 'Tile state name. While counting it holds e.g. 4:59; afterwards it is empty.',
    },
  ],
  defaults: { seconds: 300, key: 'left' },
  run: async (ctx, { seconds, key }) => {
    ctx.extendTimeout(seconds * 1000)
    const end = Date.now() + seconds * 1000
    try {
      for (;;) {
        const left = Math.ceil((end - Date.now()) / 1000)
        if (left <= 0) break
        ctx.tileState.set(key, formatDuration(left))
        ctx.tileState.set(`${key}Seconds`, left)
        // Wake just after the next whole second so the label never skips a number.
        const wait = (end - Date.now()) % 1000 || 1000
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, wait + 5)
          ctx.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(ctx.signal.reason)
            },
            { once: true },
          )
        })
      }
    } finally {
      ctx.tileState.set(key, '')
      ctx.tileState.set(`${key}Seconds`, 0)
    }
  },
})

// Now playing

export const nowPlaying = defineBlock({
  id: 'data.nowPlaying',
  category: 'data',
  name: "What's playing",
  description:
    "Reads the song playing in Spotify or another music app: title, artist and time left. Follows 'nothing' when nothing is playing.",
  inputs: [flowIn],
  outputs: [
    flowOut,
    { id: 'nothing', kind: 'flow', label: 'nothing' },
    text('title'),
    text('artist'),
    text('song', 'song – artist'),
    text('left', 'time left'),
    text('elapsed'),
    num('progress', 'progress %'),
    { id: 'playing', kind: 'value', type: 'boolean', label: 'playing' },
  ],
  paramsSchema: z.object({}),
  fields: [],
  defaults: {},
  run: async (ctx) => {
    if (!ctx.platform.nowPlaying)
      throw new UnsupportedError("Reading what's playing", ctx.platform.os)
    const np = await ctx.platform.nowPlaying()
    if (!np || !np.title) {
      return {
        next: 'nothing',
        values: {
          title: '',
          artist: '',
          song: '',
          left: '',
          elapsed: '',
          progress: 0,
          playing: false,
        },
      }
    }
    const known = np.duration !== undefined && np.position !== undefined && np.duration > 0
    return {
      values: {
        title: np.title,
        artist: np.artist,
        song: np.artist ? `${np.title} – ${np.artist}` : np.title,
        left: known ? `-${formatDuration((np.duration ?? 0) - (np.position ?? 0))}` : '',
        elapsed: np.position !== undefined ? formatDuration(np.position) : '',
        progress: known ? Math.round(((np.position ?? 0) / (np.duration ?? 1)) * 100) : 0,
        playing: np.playing,
      },
    }
  },
})

// Weather (Open-Meteo: free, no key)

export interface GeoPoint {
  lat: number
  lon: number
  name?: string
}

/** WMO weather codes as words and a tile icon. */
export function describeWeather(code: number, day = true): { text: string; icon: string } {
  if (code === 0) return { text: 'Clear', icon: day ? 'sun' : 'moon' }
  if (code <= 2) return { text: 'Partly cloudy', icon: day ? 'cloud-sun' : 'cloud-moon' }
  if (code === 3) return { text: 'Cloudy', icon: 'cloud' }
  if (code <= 48) return { text: 'Fog', icon: 'cloud-fog' }
  if (code <= 57) return { text: 'Drizzle', icon: 'cloud-drizzle' }
  if (code <= 67 || (code >= 80 && code <= 82)) return { text: 'Rain', icon: 'cloud-rain' }
  if (code <= 77 || code === 85 || code === 86) return { text: 'Snow', icon: 'cloud-snow' }
  if (code >= 95) return { text: 'Thunder', icon: 'cloud-lightning' }
  return { text: 'Cloudy', icon: 'cloud' }
}

const CACHE_MS = 10 * 60_000
const cache = new Map<string, { at: number; body: unknown }>()

async function getJson(
  ctx: {
    platform: { http: (r: never) => Promise<{ status: number; body: string }> }
    signal: AbortSignal
  },
  url: string,
): Promise<unknown> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body
  const res = await ctx.platform.http({
    method: 'GET',
    url,
    headers: {},
    signal: ctx.signal,
  } as never)
  if (res.status !== 200) throw new UserFacingError(`The weather service answered ${res.status}`)
  const body = JSON.parse(res.body) as unknown
  cache.set(url, { at: Date.now(), body })
  if (cache.size > 50) cache.delete(cache.keys().next().value as string)
  return body
}

export const weather = defineBlock({
  id: 'data.weather',
  category: 'data',
  name: 'Weather',
  description:
    "Current weather from Open-Meteo, for a place you type or the phone's location (turn on Share location in Phones › On the phone). Results are kept for 10 minutes.",
  inputs: [flowIn],
  outputs: [
    flowOut,
    text('summary', 'e.g. 12° Cloudy'),
    num('temperature'),
    text('condition'),
    text('icon'),
    num('high'),
    num('low'),
    text('place'),
  ],
  paramsSchema: z.object({
    place: z.string().max(80).default(''),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  fields: [
    {
      key: 'place',
      label: 'Place',
      widget: 'text',
      placeholder: "The phone's location",
      help: 'A town or city. Leave empty to use where the phone is.',
    },
    {
      key: 'units',
      label: 'Units',
      widget: 'select',
      options: [
        { value: 'celsius', label: '°C' },
        { value: 'fahrenheit', label: '°F' },
      ],
    },
  ],
  defaults: { place: '', units: 'celsius' },
  run: async (ctx, { place, units }) => {
    let point: GeoPoint | undefined
    if (place.trim()) {
      const found = (await getJson(
        ctx,
        `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place.trim())}`,
      )) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
      const first = found.results?.[0]
      if (!first) throw new UserFacingError(`Couldn't find "${place}"`)
      point = { lat: first.latitude, lon: first.longitude, name: first.name }
    } else {
      point = ctx.platform.location?.()
      if (!point)
        throw new UserFacingError(
          'No location yet. Turn on Share location for phones, or type a place in the Weather block.',
        )
    }
    const lat = point.lat.toFixed(2)
    const lon = point.lon.toFixed(2)
    const data = (await getJson(
      ctx,
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto&temperature_unit=${units}`,
    )) as {
      current?: { temperature_2m: number; weather_code: number; is_day: number }
      daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] }
    }
    if (!data.current) throw new UserFacingError('The weather service sent nothing back')
    const temperature = Math.round(data.current.temperature_2m)
    const { text: condition, icon } = describeWeather(
      data.current.weather_code,
      data.current.is_day === 1,
    )
    return {
      values: {
        summary: `${temperature}° ${condition}`,
        temperature,
        condition,
        icon,
        high: Math.round(data.daily?.temperature_2m_max[0] ?? temperature),
        low: Math.round(data.daily?.temperature_2m_min[0] ?? temperature),
        place: point.name ?? '',
      },
    }
  },
})

export const liveBlocks = [countdown, nowPlaying, weather]
