// Run plugin blocks and triggers in a test without starting Tessel.
import type { BlockResult, Json, OS, PluginContext, PluginDefinition } from './types.ts'

export interface Harness {
  ctx: PluginContext
  logs: Array<{ level: string; message: string }>
  storage: Map<string, Json>
  /** Key combinations the plugin pressed. */
  keys: string[]
  /** Blocks the plugin ran with ctx.runBlock. */
  ranBlocks: Array<{
    type: string
    params: Record<string, unknown>
    input: Record<string, unknown>
  }>
  tileState: Map<string, Json>
  load(): Promise<void>
  unload(): Promise<void>
  run(
    block: string,
    params: Record<string, unknown>,
    input?: Record<string, unknown>,
  ): Promise<BlockResult>
  subscribe(
    trigger: string,
    params: Record<string, unknown>,
    tileId?: string,
  ): { events: Array<Record<string, unknown>>; stop(): void }
}

export function createHarness(
  plugin: PluginDefinition,
  opts: {
    os?: OS
    settings?: Record<string, unknown>
    pluginId?: string
    /** Answers runBlock calls; by default they do nothing and return no values. */
    runBlock?: (
      type: string,
      params: Record<string, unknown>,
      input: Record<string, unknown>,
    ) => { next?: string; values: Record<string, unknown> }
  } = {},
): Harness {
  const logs: Harness['logs'] = []
  const storage = new Map<string, Json>()
  const keys: string[] = []
  const ranBlocks: Harness['ranBlocks'] = []
  const tileState = new Map<string, Json>()
  const ctx: PluginContext = {
    pluginId: opts.pluginId ?? 'test',
    os: opts.os ?? 'win32',
    settings: opts.settings ?? {},
    log: {
      info: (message) => logs.push({ level: 'info', message }),
      warn: (message) => logs.push({ level: 'warn', message }),
      error: (message) => logs.push({ level: 'error', message }),
    },
    storage: {
      get: async (key) => storage.get(key) as never,
      set: async (key, value) => void storage.set(key, value),
      delete: async (key) => void storage.delete(key),
    },
    pressKeys: async (combo) => void keys.push(combo),
  }

  return {
    ctx,
    logs,
    storage,
    keys,
    ranBlocks,
    tileState,
    load: async () => plugin.onLoad?.(ctx),
    unload: async () => plugin.onUnload?.(),
    async run(id, params, input = {}) {
      const block = plugin.blocks?.find((b) => b.id === id)
      if (!block) throw new Error(`No block "${id}"`)
      const parsed = block.paramsSchema.safeParse(params)
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid params')
      const result = await block.run(
        {
          ...ctx,
          tileId: 'tile',
          signal: new AbortController().signal,
          setTileState: (k, v) => void tileState.set(k, v),
          runBlock: async (type, params = {}, blockInput = {}) => {
            ranBlocks.push({ type, params, input: blockInput })
            return opts.runBlock?.(type, params, blockInput) ?? { values: {} }
          },
        },
        parsed.data,
        input,
      )
      return result ?? {}
    },
    subscribe(id, params, tileId = 'tile') {
      const trigger = plugin.triggers?.find((t) => t.id === id)
      if (!trigger) throw new Error(`No trigger "${id}"`)
      const parsed = trigger.paramsSchema.safeParse(params)
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid params')
      const events: Array<Record<string, unknown>> = []
      const stop = trigger.subscribe(ctx, {
        tileId,
        params: parsed.data,
        emit: (values = {}) => events.push(values),
        setTileState: (k, v) => void tileState.set(k, v),
      })
      return { events, stop: stop ?? (() => {}) }
    },
  }
}
