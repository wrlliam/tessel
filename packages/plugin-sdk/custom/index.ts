// Write your own Tessel blocks in TypeScript. Each file in blocks/ default-exports block({...}).
// Tessel copies this folder in and refreshes it on updates, so keep your own code in blocks/.
import { readdir } from 'node:fs/promises'
import { std } from './std.ts'

export { std }
export * from './std.ts'

export type ParamType = 'text' | 'textarea' | 'number' | 'toggle' | 'select'
export type ValueType = 'string' | 'number' | 'boolean' | 'any'
type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface ParamSpec {
  type: ParamType
  label?: string
  default?: string | number | boolean
  /** For 'select'. */
  options?: readonly string[]
  placeholder?: string
  help?: string
  /** For 'number'. */
  min?: number
  max?: number
}

/** The value a param arrives as in run(). */
type ParamValue<S extends ParamSpec> = S['type'] extends 'number'
  ? number
  : S['type'] extends 'toggle'
    ? boolean
    : string

type InputValue<T extends ValueType> = T extends 'number'
  ? number | undefined
  : T extends 'boolean'
    ? boolean | undefined
    : T extends 'string'
      ? string | undefined
      : unknown

export interface BlockContext {
  pluginId: string
  os: 'darwin' | 'win32' | 'linux'
  /** Values from Plugins › My blocks › Settings. */
  settings: Record<string, unknown>
  log: { info(m: string): void; warn(m: string): void; error(m: string): void }
  /** Kept on disk between runs and restarts. */
  storage: {
    get<T extends Json>(key: string): Promise<T | undefined>
    set(key: string, value: Json): Promise<void>
    delete(key: string): Promise<void>
  }
  tileId: string
  /** Aborted when the tile is stopped or runs out of time; pass it to fetch and std.sleep. */
  signal: AbortSignal
  /** Sets {{state.key}} on the tile, for its live appearance. */
  setTileState(key: string, value: Json): void
}

/** What a value output carries, by its declared type. */
type OutputValue<T extends ValueType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'string'
      ? string
      : unknown

/**
 * What run() can return:
 * - nothing: carry on through the first output;
 * - a string, e.g. 'yes': carry on through that output;
 * - the values themselves, e.g. { days: 12, words: '12 days to go' }, with an optional
 *   `next` to pick the output;
 * - { next, values }, the long form.
 */
export type BlockResult<V extends Record<string, ValueType> = Record<string, ValueType>> =
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  | void
  | string
  | ({ [K in keyof V]?: OutputValue<V[K]> } & { next?: string })
  | { next?: string; values?: { [K in keyof V]?: OutputValue<V[K]> } }

export interface BlockSpec<
  P extends Record<string, ParamSpec>,
  I extends Record<string, ValueType>,
  V extends Record<string, ValueType>,
> {
  name: string
  description?: string
  /** Settings shown in the editor's inspector. */
  params?: P
  /** Value inputs that other blocks can wire into. */
  inputs?: I
  /** Flow outputs to choose between. Default: one output, 'out'. */
  outputs?: readonly string[]
  /** Value outputs other blocks can read; return them from run() by name. */
  values?: V
  /** How long a run may take, up to 600 s. Default 30 s. */
  timeoutSeconds?: number
  /** Operating systems the block works on. */
  platforms?: Array<'darwin' | 'win32' | 'linux'>
  run(args: {
    params: { [K in keyof P]: ParamValue<P[K]> }
    inputs: { [K in keyof I]: InputValue<I[K]> }
    ctx: BlockContext
    std: typeof std
  }): BlockResult<V> | Promise<BlockResult<V>>
}

/** What Tessel's plugin runner expects for one block. */
export interface PluginBlock {
  id: string
  name: string
  description: string
  platforms?: Array<'darwin' | 'win32' | 'linux'>
  inputs: Array<{ id: string; kind: 'flow' | 'value'; type?: ValueType; label?: string }>
  outputs: Array<{ id: string; kind: 'flow' | 'value'; type?: ValueType; label?: string }>
  paramsSchema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: unknown }
      | { success: false; error: { issues: Array<{ message: string; path: PropertyKey[] }> } }
  }
  fields: Array<Record<string, unknown>>
  defaults: Record<string, unknown>
  timeoutSeconds?: number
  run(ctx: BlockContext, params: unknown, input: Record<string, unknown>): Promise<unknown>
}

const WIDGET: Record<ParamType, string> = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  toggle: 'toggle',
  select: 'select',
}

function defaultFor(spec: ParamSpec): string | number | boolean {
  if (spec.default !== undefined) return spec.default
  if (spec.type === 'number') return spec.min ?? 0
  if (spec.type === 'toggle') return false
  if (spec.type === 'select') return spec.options?.[0] ?? ''
  return ''
}

/** Checks and converts params the way the inspector sends them (numbers may arrive as text). */
function checkParams(specs: Record<string, ParamSpec>, raw: unknown) {
  const given = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const issues: Array<{ message: string; path: PropertyKey[] }> = []
  for (const [key, spec] of Object.entries(specs)) {
    const value = given[key] ?? defaultFor(spec)
    const label = spec.label ?? key
    if (spec.type === 'number') {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      if (String(value).trim() === '' || !Number.isFinite(n))
        issues.push({ message: `${label} must be a number`, path: [key] })
      else if (spec.min !== undefined && n < spec.min)
        issues.push({ message: `${label} must be at least ${spec.min}`, path: [key] })
      else if (spec.max !== undefined && n > spec.max)
        issues.push({ message: `${label} must be at most ${spec.max}`, path: [key] })
      out[key] = n
    } else if (spec.type === 'toggle') {
      out[key] = value === true || value === 'true'
    } else {
      const s = String(value ?? '')
      if (spec.type === 'select' && spec.options && !spec.options.includes(s))
        issues.push({ message: `Choose one of: ${spec.options.join(', ')}`, path: [key] })
      out[key] = s
    }
  }
  return issues.length
    ? ({ success: false, error: { issues } } as const)
    : ({ success: true, data: out } as const)
}

const BLOCK = Symbol.for('tessel.customBlock')

/** Defines one block. Export it as the default from a file in blocks/; the file name is its id. */
export function block<
  P extends Record<string, ParamSpec> = Record<never, ParamSpec>,
  I extends Record<string, ValueType> = Record<never, ValueType>,
  V extends Record<string, ValueType> = Record<never, ValueType>,
>(spec: BlockSpec<P, I, V>): Omit<PluginBlock, 'id'> & { [BLOCK]: true } {
  const params = (spec.params ?? {}) as Record<string, ParamSpec>
  const flows = spec.outputs?.length ? spec.outputs : ['out']
  for (const reserved of ['next', 'values'])
    if (spec.values && reserved in spec.values)
      throw new Error(`"${spec.name}": "${reserved}" can't be a value name; pick another`)
  return {
    [BLOCK]: true,
    name: spec.name,
    description: spec.description ?? '',
    ...(spec.platforms && { platforms: spec.platforms }),
    inputs: [
      { id: 'in', kind: 'flow' },
      ...Object.entries(spec.inputs ?? {}).map(([id, type]) => ({
        id,
        kind: 'value' as const,
        type,
      })),
    ],
    outputs: [
      ...flows.map((id) => ({ id, kind: 'flow' as const })),
      ...Object.entries(spec.values ?? {}).map(([id, type]) => ({
        id,
        kind: 'value' as const,
        type,
      })),
    ],
    paramsSchema: { safeParse: (v: unknown) => checkParams(params, v) },
    fields: Object.entries(params).map(([key, p]) => ({
      key,
      label: p.label ?? key,
      widget: WIDGET[p.type],
      ...(p.placeholder !== undefined && { placeholder: p.placeholder }),
      ...(p.help !== undefined && { help: p.help }),
      ...(p.options && { options: p.options.map((o) => ({ value: o, label: o })) }),
    })),
    defaults: Object.fromEntries(Object.entries(params).map(([k, p]) => [k, defaultFor(p)])),
    ...(spec.timeoutSeconds && { timeoutSeconds: spec.timeoutSeconds }),
    async run(ctx, p, input) {
      const result = await spec.run({
        params: p as never,
        inputs: input as never,
        ctx,
        std,
      })
      if (typeof result === 'string') {
        if (!flows.includes(result))
          throw new Error(
            `"${spec.name}" chose "${result}", but its outputs are ${flows.join(', ')}`,
          )
        return { next: result }
      }
      if (result === undefined || result === null) return undefined
      return normalise(
        spec.name,
        result as Record<string, unknown>,
        flows,
        Object.keys(spec.values ?? {}),
      )
    },
  }
}

/**
 * Turns either result form into { next, values }, and checks names so a typo says what's wrong
 * instead of quietly giving nothing.
 */
export function normalise(
  name: string,
  result: Record<string, unknown>,
  flows: readonly string[],
  declared: readonly string[],
): { next?: string; values?: Record<string, unknown> } {
  const long =
    Object.keys(result).every((k) => k === 'next' || k === 'values') &&
    (result['values'] === undefined || typeof result['values'] === 'object')
  const { next, ...rest } = result
  const values = (long ? (result['values'] ?? {}) : rest) as Record<string, unknown>
  if (next !== undefined && (typeof next !== 'string' || !flows.includes(next)))
    throw new Error(`"${name}" chose "${String(next)}", but its outputs are ${flows.join(', ')}`)
  const unknown = Object.keys(values).filter((k) => !declared.includes(k))
  if (unknown.length)
    throw new Error(
      `"${name}" returned ${unknown.join(', ')}, which ${unknown.length === 1 ? "isn't a value" : "aren't values"} it declares. Add ${unknown.length === 1 ? 'it' : 'them'} to values: ${declared.length ? `(it has ${declared.join(', ')})` : '{ ... }'}.`,
    )
  return {
    ...(next !== undefined && { next: next as string }),
    ...(Object.keys(values).length && { values }),
  }
}

const isBlock = (v: unknown): v is Omit<PluginBlock, 'id'> =>
  typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[BLOCK] === true

/**
 * Loads every block in a folder: each .ts or .js file whose name doesn't start with _ and
 * default-exports block({...}) (or an array of them, which get -1, -2... ids).
 */
export async function loadBlocks(folder: URL) {
  const blocks: PluginBlock[] = []
  // A broken file is skipped and reported, so one mistake doesn't take every block away.
  const problems: string[] = []
  const files = (await readdir(folder)).filter((f) => /^[^_.].*\.(ts|js|mjs)$/.test(f)).sort()
  for (const file of files) {
    const id = file
      .replace(/\.(ts|js|mjs)$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
    try {
      const mod = (await import(new URL(file, folder).href)) as { default?: unknown }
      const found = Array.isArray(mod.default) ? mod.default : [mod.default]
      const valid = found.filter(isBlock)
      if (valid.length !== found.length) throw new Error('it must export default block({...})')
      valid.forEach((b, i) => blocks.push({ ...b, id: found.length > 1 ? `${id}-${i + 1}` : id }))
    } catch (err) {
      problems.push(
        `blocks/${file}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      )
    }
  }
  return {
    blocks,
    onLoad(ctx: Pick<BlockContext, 'log'>) {
      for (const p of problems) ctx.log.error(`Skipped ${p}`)
    },
  }
}
