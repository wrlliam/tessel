import {
  isRequest,
  isResponse,
  type Description,
  type HostMethods,
  type Message,
  type Request,
  type Subscription,
} from './protocol.ts'
import type {
  Json,
  OS,
  PluginBlock,
  PluginContext,
  PluginDefinition,
  PluginTrigger,
  PortDef,
} from './types.ts'

export interface Transport {
  send(message: Message): void
  onMessage(listener: (message: Message) => void): void
}

const describeBlock = (b: PluginBlock<never> | PluginTrigger<never>) => ({
  id: b.id,
  name: b.name,
  description: b.description,
  ...(b.platforms && { platforms: b.platforms }),
  outputs: b.outputs,
  fields: b.fields ?? [],
  defaults: b.defaults ?? {},
})

const flowOut: PortDef = { id: 'out', kind: 'flow' }

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

function firstIssue(error: { issues: Array<{ message: string; path: PropertyKey[] }> }) {
  const issue = error.issues[0]
  const field = issue?.path.map(String).join('.')
  return `${field ? `${field}: ` : ''}${issue?.message ?? 'invalid settings'}`
}

/** Runs a plugin definition against Tessel over a message transport. */
export function runPlugin(
  plugin: PluginDefinition,
  transport: Transport,
  exit: () => void = () => {},
) {
  const blocks = new Map((plugin.blocks ?? []).map((b) => [b.id, b]))
  const triggers = new Map((plugin.triggers ?? []).map((t) => [t.id, t]))
  const runs = new Map<string, AbortController>()
  const subscriptions = new Map<string, () => void>()
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let nextId = 1
  let ctx: PluginContext | undefined

  const notify = (message: Message) => transport.send(message)
  const call = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      transport.send({ id, method, params })
    })

  const log = (level: 'info' | 'warn' | 'error') => (message: string) =>
    notify({ method: 'log', params: { level, message: String(message) } })

  function makeContext(pluginId: string, os: OS, settings: Record<string, unknown>): PluginContext {
    return {
      pluginId,
      os,
      settings,
      log: { info: log('info'), warn: log('warn'), error: log('error') },
      storage: {
        get: (key) => call('storage.get', { key }) as Promise<never>,
        set: async (key, value) => void (await call('storage.set', { key, value })),
        delete: async (key) => void (await call('storage.delete', { key })),
      },
    }
  }

  function setSubscriptions(next: Subscription[]) {
    if (!ctx) throw new Error('Plugin not started')
    const wanted = new Map(next.map((s) => [s.id, s]))
    for (const [id, stop] of subscriptions) {
      if (!wanted.has(id)) {
        stop()
        subscriptions.delete(id)
      }
    }
    for (const sub of next) {
      if (subscriptions.has(sub.id)) continue
      const trigger = triggers.get(sub.trigger)
      const parsed = trigger?.paramsSchema.safeParse(sub.params)
      if (!trigger || !parsed?.success) {
        log('warn')(
          `Skipped ${sub.trigger} on tile ${sub.tileId}: ${parsed && !parsed.success ? firstIssue(parsed.error) : 'unknown trigger'}`,
        )
        continue
      }
      const stop = trigger.subscribe(ctx, {
        tileId: sub.tileId,
        params: parsed.data,
        emit: (values = {}) =>
          notify({ method: 'event', params: { subscriptionId: sub.id, values } }),
        setTileState: (key: string, value: Json) =>
          notify({ method: 'tileState', params: { tileId: sub.tileId, key, value } }),
      })
      subscriptions.set(sub.id, stop ?? (() => {}))
    }
  }

  async function handle(req: Request): Promise<unknown> {
    switch (req.method as keyof HostMethods) {
      case 'init': {
        const p = req.params as HostMethods['init']['params']
        ctx = makeContext(p.pluginId, p.os, p.settings)
        await plugin.onLoad?.(ctx)
        return null
      }
      case 'describe':
        return {
          blocks: [...blocks.values()].map((b) => ({ ...describeBlock(b), inputs: b.inputs })),
          triggers: [...triggers.values()].map((t) => ({
            ...describeBlock(t),
            outputs: [flowOut, ...t.outputs],
          })),
        } satisfies Description
      case 'run': {
        const p = req.params as HostMethods['run']['params']
        const block = blocks.get(p.block)
        if (!block || !ctx) throw new Error(`Unknown block "${p.block}"`)
        const parsed = block.paramsSchema.safeParse(p.params)
        if (!parsed.success) throw new Error(firstIssue(parsed.error))
        const controller = new AbortController()
        runs.set(p.callId, controller)
        try {
          const result = await block.run(
            {
              ...ctx,
              tileId: p.tileId,
              signal: controller.signal,
              setTileState: (key, value) =>
                notify({ method: 'tileState', params: { callId: p.callId, key, value } }),
            },
            parsed.data,
            p.input,
          )
          return result ?? {}
        } finally {
          runs.delete(p.callId)
        }
      }
      case 'cancel':
        runs.get((req.params as { callId: string }).callId)?.abort(new Error('Stopped'))
        return null
      case 'subscribe':
        setSubscriptions((req.params as HostMethods['subscribe']['params']).subscriptions)
        return null
      case 'settings': {
        const { settings } = req.params as HostMethods['settings']['params']
        if (ctx) ctx.settings = settings
        await plugin.onSettings?.(settings)
        return null
      }
      case 'shutdown':
        for (const stop of subscriptions.values()) stop()
        subscriptions.clear()
        await plugin.onUnload?.()
        setTimeout(exit, 10)
        return null
      default:
        throw new Error(`Unknown method "${req.method}"`)
    }
  }

  transport.onMessage((message) => {
    if (isResponse(message)) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if ('error' in message) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result)
      return
    }
    if (!isRequest(message)) return
    handle(message).then(
      (result) => transport.send({ id: message.id, result: result ?? null }),
      (err: unknown) => transport.send({ id: message.id, error: { message: messageOf(err) } }),
    )
  })
}
