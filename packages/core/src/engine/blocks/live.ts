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
    text('artwork', 'album art'),
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
        artwork: np.artwork ?? '',
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

export const getClipboard = defineBlock({
  id: 'data.getClipboard',
  category: 'data',
  name: 'Get clipboard',
  description:
    'Reads the text on the clipboard. To use what is selected, run Key combo Cmd/Ctrl+C and a short Delay first.',
  inputs: [flowIn],
  outputs: [flowOut, text('text')],
  paramsSchema: z.object({}),
  fields: [],
  defaults: {},
  run: async (ctx) => {
    if (!ctx.platform.readClipboard)
      throw new UnsupportedError('Reading the clipboard', ctx.platform.os)
    return { values: { text: await ctx.platform.readClipboard() } }
  },
})

export const toast = defineBlock({
  id: 'action.toast',
  category: 'action',
  name: 'Show a pop-up',
  description:
    "Shows a message on the computer's screen, above every window, then hides it. Wire text into title or body, e.g. the song from What's playing.",
  inputs: [
    flowIn,
    { id: 'title', kind: 'value', type: 'string' },
    { id: 'body', kind: 'value', type: 'string' },
  ],
  outputs: [flowOut],
  paramsSchema: z.object({
    title: z.string().max(80).default(''),
    body: z.string().max(400).default(''),
    icon: z.string().max(8).default(''),
    colour: z
      .union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #22D3C5')])
      .default(''),
    seconds: z.coerce.number().min(1).max(60).default(5),
    position: z
      .enum(['top-right', 'top-left', 'top-center', 'bottom-right', 'bottom-left', 'bottom-center'])
      .default('top-right'),
  }),
  fields: [
    { key: 'title', label: 'Title', widget: 'text', placeholder: 'Now playing' },
    { key: 'body', label: 'Message', widget: 'textarea', placeholder: '{{var.count}} presses' },
    { key: 'icon', label: 'Emoji', widget: 'text', placeholder: '🎵' },
    { key: 'colour', label: 'Accent colour', widget: 'text', placeholder: '#22D3C5' },
    { key: 'seconds', label: 'Seconds on screen', widget: 'number' },
    {
      key: 'position',
      label: 'Where',
      widget: 'select',
      options: [
        { value: 'top-right', label: 'Top right' },
        { value: 'top-center', label: 'Top middle' },
        { value: 'top-left', label: 'Top left' },
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'bottom-center', label: 'Bottom middle' },
        { value: 'bottom-left', label: 'Bottom left' },
      ],
    },
  ],
  defaults: { title: '', body: '', icon: '', colour: '', seconds: 5, position: 'top-right' },
  run: async (ctx, p) => {
    if (!ctx.platform.toast) throw new UnsupportedError('Pop-ups', ctx.platform.os)
    if (!p.title.trim() && !p.body.trim())
      throw new UserFacingError('The pop-up has nothing to say')
    await ctx.platform.toast({
      title: p.title,
      body: p.body,
      ...(p.icon && { icon: p.icon }),
      ...(p.colour && { colour: p.colour }),
      seconds: p.seconds,
      position: p.position,
    })
  },
})

export const changed = defineBlock({
  id: 'logic.changed',
  category: 'logic',
  name: 'Changed?',
  description:
    "Goes out 'changed' when the wired-in value differs from last time this tile ran, otherwise 'same'. Good for reacting once to a new song or reading.",
  inputs: [flowIn, { id: 'value', kind: 'value', type: 'any' }],
  outputs: [
    { id: 'changed', kind: 'flow', label: 'changed' },
    { id: 'same', kind: 'flow', label: 'same' },
  ],
  paramsSchema: z.object({
    key: z
      .string()
      .regex(/^[a-zA-Z_]\w*$/, 'Use letters, numbers and _')
      .max(32)
      .default('last'),
  }),
  fields: [{ key: 'key', label: 'Remember it as', widget: 'text', placeholder: 'last' }],
  defaults: { key: 'last' },
  run: (ctx, { key }, input) => {
    const now = JSON.stringify(input['value'] ?? null)
    const before = ctx.tileState.get(key)
    ctx.tileState.set(key, now)
    return { next: before === now ? 'same' : 'changed' }
  },
})

export const zxScript = defineBlock({
  id: 'action.zx',
  category: 'action',
  name: 'Run a zx script',
  description:
    'Runs JavaScript with zx: $`command` runs a command, and fs, path, os, glob, sleep and YAML are ready to use. input is the wired-in value; what the script returns comes out of result. Follows the shell commands setting.',
  inputs: [flowIn, { id: 'input', kind: 'value', type: 'any' }],
  outputs: [
    flowOut,
    { id: 'result', kind: 'value', type: 'any' },
    text('output', 'printed output'),
  ],
  paramsSchema: z.object({
    script: z.string().min(1, 'Write a script').max(20_000),
    cwd: z.string().max(500).default(''),
    timeout: z.coerce.number().int().min(1).max(600).default(30),
  }),
  fields: [
    {
      key: 'script',
      label: 'Script',
      widget: 'textarea',
      placeholder: 'const { stdout } = await $`git branch --show-current`\nreturn stdout.trim()',
      help: 'Top-level await works. echo() or console.log() goes to the output value.',
    },
    { key: 'cwd', label: 'Run in folder', widget: 'text', placeholder: 'Your home folder' },
    { key: 'timeout', label: 'Stop after (seconds)', widget: 'number' },
  ],
  defaults: { script: '', cwd: '', timeout: 30 },
  run: async (ctx, p, input) => {
    if (!ctx.platform.runZx) throw new UnsupportedError('zx scripts', ctx.platform.os)
    ctx.extendTimeout(p.timeout * 1000)
    const { result, output } = await ctx.platform.runZx(p.script, {
      input: input['input'],
      ...(p.cwd && { cwd: p.cwd }),
      signal: ctx.signal,
    })
    return { values: { result, output } }
  },
})

export const getVolume = defineBlock({
  id: 'data.getVolume',
  category: 'data',
  name: 'Get volume',
  description:
    "Reads the computer's output volume (0 to 100) and whether it's muted, which it also keeps in {{state.muted}}.",
  inputs: [flowIn],
  outputs: [
    flowOut,
    num('level', 'volume'),
    { id: 'muted', kind: 'value', type: 'boolean', label: 'muted' },
  ],
  paramsSchema: z.object({}),
  fields: [],
  defaults: {},
  run: async (ctx) => {
    if (!ctx.platform.getVolume) throw new UnsupportedError('Reading the volume', ctx.platform.os)
    const { level, muted } = await ctx.platform.getVolume()
    // Kept on the tile too, so a volume tile can show {{state.muted}}.
    ctx.tileState.set('muted', muted)
    return { values: { level: Math.round(level), muted } }
  },
})

export const setSlider = defineBlock({
  id: 'action.setSlider',
  category: 'action',
  name: 'Set slider',
  description:
    "Moves a slider tile's bar, e.g. to follow the volume when it changes elsewhere. The value is in the slider's own range (its On slide Lowest to Highest).",
  inputs: [flowIn, { id: 'value', kind: 'value', type: 'number' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    value: z.coerce.number(),
    tile: z.string().max(64).default(''),
  }),
  fields: [
    { key: 'tile', label: 'Which slider', widget: 'tile', placeholder: 'This tile' },
    { key: 'value', label: 'Value', widget: 'number' },
  ],
  defaults: { value: 0, tile: '' },
  run: (ctx, p) => {
    ctx.setSlider(p.value, p.tile ? { tileId: p.tile } : undefined)
  },
})

export const systemStats = defineBlock({
  id: 'data.systemStats',
  category: 'data',
  name: 'System stats',
  description:
    'How busy the computer is: CPU, graphics card, memory and disk in %, network in KB/s. GPU readings are empty where the computer has no way to report them. Wire one into Show a value to draw it as a ring or chart.',
  inputs: [flowIn],
  outputs: [
    flowOut,
    num('cpu', 'CPU %'),
    num('memory', 'memory %'),
    num('disk', 'disk %'),
    num('down', 'download KB/s'),
    num('up', 'upload KB/s'),
    num('memoryUsedGb', 'memory used GB'),
    num('memoryTotalGb', 'memory GB'),
    num('diskFreeGb', 'disk free GB'),
    num('uptimeHours', 'hours on'),
    num('gpu', 'GPU %'),
    num('gpuMemory', 'GPU memory %'),
    num('gpuMemoryUsedGb', 'GPU memory GB'),
    num('gpuTemp', 'GPU °C'),
  ],
  paramsSchema: z.object({}),
  fields: [],
  defaults: {},
  run: async (ctx) => {
    if (!ctx.platform.systemStats)
      throw new UnsupportedError('Reading system stats', ctx.platform.os)
    const s = await ctx.platform.systemStats()
    const r1 = (n: number) => Math.round(n * 10) / 10
    return {
      values: {
        cpu: r1(s.cpu),
        memory: r1(s.memory),
        disk: r1(s.disk),
        down: r1(s.downKbps),
        up: r1(s.upKbps),
        memoryUsedGb: r1(s.memoryUsedGb),
        memoryTotalGb: r1(s.memoryTotalGb),
        diskFreeGb: r1(s.diskFreeGb),
        uptimeHours: r1(s.uptimeHours),
        // Left empty, not 0, when unknown: a ring then shows a dash instead of an idle card.
        gpu: s.gpu === undefined ? null : r1(s.gpu),
        gpuMemory: s.gpuMemory === undefined ? null : r1(s.gpuMemory),
        gpuMemoryUsedGb: s.gpuMemoryUsedGb === undefined ? null : r1(s.gpuMemoryUsedGb),
        gpuTemp: s.gpuTemp === undefined ? null : r1(s.gpuTemp),
      },
    }
  },
})

export const showValue = defineBlock({
  id: 'action.showValue',
  category: 'action',
  name: 'Show a value',
  description:
    'Keeps a number on the tile as {{state.reading}}, for its display (ring, bar or chart, under Tile › Display) to draw. Charts remember each value. An empty value shows a dash.',
  inputs: [flowIn, { id: 'value', kind: 'value', type: 'number' }],
  outputs: [flowOut],
  paramsSchema: z.object({
    // Null is "no reading" (a stat this computer can't report), kept apart from 0.
    value: z.coerce.number().nullable().default(0),
    key: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, 'Letters, digits and _ only')
      .default('reading'),
  }),
  fields: [
    { key: 'value', label: 'Value', widget: 'number' },
    { key: 'key', label: 'Keep as', widget: 'text', placeholder: 'reading' },
  ],
  defaults: { value: 0, key: 'reading' },
  run: (ctx, p) => {
    if (p.value !== null && !Number.isFinite(p.value))
      throw new UserFacingError("That value isn't a number.")
    ctx.tileState.set(p.key, p.value)
  },
})

export const liveBlocks = [
  getVolume,
  systemStats,
  showValue,
  setSlider,
  countdown,
  nowPlaying,
  weather,
  getClipboard,
  toast,
  changed,
  zxScript,
]
