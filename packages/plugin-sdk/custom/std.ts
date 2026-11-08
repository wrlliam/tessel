// Tessel's standard library for blocks you write: small, dependable helpers for dates, text,
// numbers, the web and Home Assistant. Plain TypeScript, no dependencies, safe to copy.

// Dates

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 24 * 60 * 60 * 1000
const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d))

export const date = {
  now: () => new Date(),
  /** Accepts a Date, an ISO string like 2026-12-25, or a timestamp. */
  parse: toDate,
  /** 1 (January) to 12. */
  month: (d: Date | string | number = new Date()) => toDate(d).getMonth() + 1,
  monthName: (d: Date | string | number = new Date()) => MONTHS[toDate(d).getMonth()] ?? '',
  /** 0 (Sunday) to 6. */
  weekday: (d: Date | string | number = new Date()) => toDate(d).getDay(),
  weekdayName: (d: Date | string | number = new Date()) => DAYS[toDate(d).getDay()] ?? '',
  isWeekend: (d: Date | string | number = new Date()) => [0, 6].includes(toDate(d).getDay()),
  isAfter: (a: Date | string | number, b: Date | string | number) =>
    toDate(a).getTime() > toDate(b).getTime(),
  isBefore: (a: Date | string | number, b: Date | string | number) =>
    toDate(a).getTime() < toDate(b).getTime(),
  addDays: (d: Date | string | number, days: number) =>
    new Date(toDate(d).getTime() + days * DAY_MS),
  startOfDay: (d: Date | string | number = new Date()) => {
    const out = toDate(d)
    return new Date(out.getFullYear(), out.getMonth(), out.getDate())
  },
  /** Whole days from a to b, counting calendar days in local time. */
  daysBetween: (a: Date | string | number, b: Date | string | number) =>
    Math.round((date.startOfDay(b).getTime() - date.startOfDay(a).getTime()) / DAY_MS),
  /** Days from today until a date; negative once it has passed. */
  daysUntil: (target: Date | string | number) => date.daysBetween(new Date(), target),
  /**
   * Formats with YYYY, MM, DD, HH, mm, ss, MMMM (month name) and dddd (weekday name).
   * format(now, 'dddd D MMMM') -> "Friday 25 December".
   */
  format(d: Date | string | number, pattern = 'YYYY-MM-DD HH:mm'): string {
    const x = toDate(d)
    const parts: Record<string, string> = {
      YYYY: String(x.getFullYear()),
      MMMM: MONTHS[x.getMonth()] ?? '',
      MM: pad(x.getMonth() + 1),
      dddd: DAYS[x.getDay()] ?? '',
      DD: pad(x.getDate()),
      D: String(x.getDate()),
      HH: pad(x.getHours()),
      mm: pad(x.getMinutes()),
      ss: pad(x.getSeconds()),
    }
    return pattern.replace(/YYYY|MMMM|MM|dddd|DD|D|HH|mm|ss/g, (t) => parts[t] ?? t)
  },
}

// Text

export const text = {
  truncate: (s: string, max: number, end = '…') =>
    s.length <= max ? s : s.slice(0, Math.max(0, max - end.length)) + end,
  titleCase: (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
  slug: (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-'),
  words: (s: string) => s.trim().split(/\s+/).filter(Boolean),
  /** fill('Hi {name}', { name: 'Sam' }) -> "Hi Sam". Unknown names stay as they are. */
  fill: (template: string, values: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m)),
}

// Numbers

export const math = {
  clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)),
  round: (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  /** Maps n from one range onto another, e.g. a 0-100 slider onto -60..12 dB. */
  map: (n: number, inMin: number, inMax: number, outMin: number, outMax: number) =>
    outMin + ((n - inMin) * (outMax - outMin)) / (inMax - inMin),
  random: (min = 0, max = 1) => min + Math.random() * (max - min),
  randomInt: (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1)),
  pick: <T>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)],
  sum: (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0),
  average: (ns: readonly number[]) => (ns.length ? math.sum(ns) / ns.length : 0),
}

// Time

/** Waits, and stops waiting if the tile is stopped (pass ctx.signal). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason as Error)
      },
      { once: true },
    )
  })
}

// Web

export interface HttpOptions {
  headers?: Record<string, string>
  /** Pass ctx.signal so a stopped tile stops the request. */
  signal?: AbortSignal
  /** Milliseconds; default 15 s. */
  timeout?: number
}

async function request(method: string, url: string, body: unknown, opts: HttpOptions = {}) {
  const timeout = AbortSignal.timeout(opts.timeout ?? 15_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...opts.headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal,
  })
  const textBody = await res.text()
  if (!res.ok)
    throw new Error(
      `${method} ${new URL(url).host} answered ${res.status}: ${textBody.slice(0, 200)}`,
    )
  return textBody
}

export const http = {
  getText: (url: string, opts?: HttpOptions) => request('GET', url, undefined, opts),
  getJson: async <T = unknown>(url: string, opts?: HttpOptions) =>
    JSON.parse(await request('GET', url, undefined, opts)) as T,
  postJson: async <T = unknown>(url: string, body: unknown, opts?: HttpOptions) => {
    const out = await request('POST', url, body, opts)
    return (out ? JSON.parse(out) : undefined) as T
  },
}

/** JSON.parse that returns `fallback` instead of throwing. */
export function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// Home Assistant

export interface HaState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
}

/**
 * A small Home Assistant client over its REST API. `url` is e.g. http://homeassistant.local:8123
 * and `token` a long-lived access token (your profile page in Home Assistant, at the bottom).
 */
export function homeAssistant(opts: { url: string; token: string; signal?: AbortSignal }) {
  const base = opts.url.replace(/\/+$/, '')
  if (!base) throw new Error('Set the Home Assistant address first')
  if (!opts.token) throw new Error('Set a Home Assistant access token first')
  const auth: HttpOptions = {
    headers: { authorization: `Bearer ${opts.token}` },
    ...(opts.signal && { signal: opts.signal }),
  }
  const call = (service: string, data: Record<string, unknown> = {}) => {
    const [domain, name] = service.split('.')
    if (!domain || !name) throw new Error(`Write the service as domain.service, e.g. light.toggle`)
    return request('POST', `${base}/api/services/${domain}/${name}`, data, auth).then((out) =>
      parseJson<HaState[]>(out, []),
    )
  }
  const forEntity =
    (service: string) =>
    (entityId: string, data: Record<string, unknown> = {}) =>
      call(`${entityId.split('.')[0]}.${service}`, { entity_id: entityId, ...data })
  return {
    /** One entity's state, e.g. state('light.desk').state === 'on'. */
    state: async (entityId: string) =>
      JSON.parse(
        await request('GET', `${base}/api/states/${entityId}`, undefined, auth),
      ) as HaState,
    states: async () =>
      JSON.parse(await request('GET', `${base}/api/states`, undefined, auth)) as HaState[],
    /** Any service: call('light.turn_on', { entity_id: 'light.desk', brightness_pct: 40 }). */
    call,
    toggle: forEntity('toggle'),
    turnOn: forEntity('turn_on'),
    turnOff: forEntity('turn_off'),
  }
}

export const std = { date, text, math, http, sleep, parseJson, homeAssistant }
export default std
