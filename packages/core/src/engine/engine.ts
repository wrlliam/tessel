import type { Graph, GraphEdge, GraphNode } from '../model.ts'
import {
  isDataBlock,
  type AppearanceChange,
  type BlockDefinition,
  type BlockRegistry,
  type RunContext,
  type TriggerEvent,
  type ValueType,
} from './block.ts'
import { isNumeric, renderParams, toBool, toText } from './expression.ts'
import { osName, UserFacingError, type Platform } from './platform.ts'
import { toJsonValue, type VariableStore } from './variables.ts'
import { validateGraph } from './validate.ts'

export type NodeStatus = 'idle' | 'running' | 'ok' | 'error' | 'skipped'
export type RunStatus = 'ok' | 'error' | 'cancelled' | 'timeout'
export type Concurrency = 'ignore' | 'restart' | 'queue'

export type EngineEvent =
  | { type: 'run:start'; runId: string; tileId: string; trigger: TriggerEvent['type'] }
  | {
      type: 'node'
      runId: string
      tileId: string
      nodeId: string
      status: NodeStatus
      error?: string
      ms?: number
    }
  | {
      type: 'run:end'
      runId: string
      tileId: string
      status: RunStatus
      error?: string
      failedNodeId?: string
      ms: number
      steps: number
    }

export interface RunResult {
  runId: string
  status: RunStatus
  error?: string
  failedNodeId?: string
  steps: number
  nodes: Record<string, NodeStatus>
}

export interface RunnableTile {
  id: string
  graph: Graph
  concurrency?: Concurrency
}

export interface EngineOptions {
  registry: BlockRegistry
  platform: Platform
  globals: VariableStore
  onEvent?: (event: EngineEvent) => void
  onAppearance?: (tileId: string, change: AppearanceChange, remember: boolean) => void
  /** Per-tile values that last between runs (Toggle). */
  tileState?: {
    get(tileId: string, key: string): unknown
    set(tileId: string, key: string, value: unknown): void
  }
  onSwitchPage?: (pageId: string) => void
  /** Looks up another tile in the same profile, for Run another tile. */
  findTile?: (tileId: string) => RunnableTile | undefined
  now?: () => Date
  /** Most blocks one run may execute. */
  maxSteps?: number
  timeoutMs?: number
  /** Presses waiting behind a running tile under the 'queue' policy. */
  maxQueue?: number
}

class StopRun extends Error {
  constructor(
    readonly status: Exclude<RunStatus, 'ok' | 'error'>,
    message: string,
  ) {
    super(message)
  }
}

class NodeFailure extends Error {
  constructor(
    readonly nodeId: string,
    message: string,
  ) {
    super(message)
  }
}

interface Lane {
  current?: Run
  tail: Promise<unknown>
  waiting: number
  generation: number
}

let runCounter = 0
const MAX_TILE_CHAIN = 8

export class Engine {
  private lanes = new Map<string, Lane>()
  readonly maxSteps: number
  readonly timeoutMs: number
  private readonly maxQueue: number

  constructor(readonly opts: EngineOptions) {
    this.maxSteps = opts.maxSteps ?? 1000
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.maxQueue = opts.maxQueue ?? 5
  }

  /** Runs the tile's graph for this event. Resolves null when nothing ran. */
  trigger(tile: RunnableTile, event: TriggerEvent): Promise<RunResult | null> {
    const listens = tile.graph.nodes.some(
      (n) => this.opts.registry.get(n.type)?.trigger === event.type,
    )
    if (!listens) return Promise.resolve(null)

    const policy = tile.concurrency ?? 'queue'
    let lane = this.lanes.get(tile.id)
    if (!lane) {
      lane = { tail: Promise.resolve(), waiting: 0, generation: 0 }
      this.lanes.set(tile.id, lane)
    }
    const inFlight = lane.waiting + (lane.current ? 1 : 0)
    if (inFlight > 0 && policy === 'ignore') return Promise.resolve(null)
    if (policy === 'queue' && inFlight > this.maxQueue) return Promise.resolve(null)
    if (policy === 'restart') lane.current?.stop('cancelled', 'Restarted by another press')

    const l = lane
    const generation = ++l.generation
    l.waiting++
    const job = l.tail.then(async () => {
      l.waiting--
      try {
        // Under 'restart', only the newest press runs.
        if (policy === 'restart' && generation !== l.generation) return null
        const run = new Run(this, tile, event)
        l.current = run
        return await run.execute()
      } finally {
        l.current = undefined
        if (l.waiting === 0) this.lanes.delete(tile.id)
      }
    })
    l.tail = job.catch(() => undefined)
    return job
  }

  isRunning(tileId: string) {
    return this.lanes.get(tileId)?.current !== undefined
  }

  cancel(tileId: string) {
    this.lanes.get(tileId)?.current?.stop('cancelled', 'Stopped')
  }

  cancelAll() {
    for (const lane of this.lanes.values()) lane.current?.stop('cancelled', 'Stopped')
  }

  emit(event: EngineEvent) {
    this.opts.onEvent?.(event)
  }
}

class Run {
  readonly id = `${Date.now().toString(36)}-${++runCounter}`
  private controller = new AbortController()
  private nodes: Map<string, GraphNode>
  private flowEdges = new Map<string, GraphEdge[]>()
  private valueEdges = new Map<string, GraphEdge[]>()
  private outputs = new Map<string, Record<string, unknown>>()
  private status = new Map<string, NodeStatus>()
  private locals = new Map<string, unknown>()
  private steps = 0

  constructor(
    private engine: Engine,
    private tile: RunnableTile,
    private event: TriggerEvent,
  ) {
    this.nodes = new Map(tile.graph.nodes.map((n) => [n.id, n]))
    for (const edge of tile.graph.edges) {
      const def = this.def(edge.to.nodeId)
      const port = def?.inputs.find((p) => p.id === edge.to.port)
      if (port?.kind === 'value') push(this.valueEdges, edge.to.nodeId, edge)
      else push(this.flowEdges, `${edge.from.nodeId}:${edge.from.port}`, edge)
    }
  }

  private timer?: ReturnType<typeof setTimeout>
  private deadline = 0

  /** Pushes the run's time limit out so it ends no sooner than `ms` from now plus the usual limit. */
  extendTimeout(ms: number) {
    const deadline = Date.now() + ms + this.engine.timeoutMs
    if (deadline <= this.deadline) return
    this.armTimer(deadline - Date.now())
  }

  private armTimer(ms: number) {
    clearTimeout(this.timer)
    this.deadline = Date.now() + ms
    const seconds = Math.round((Date.now() - this.startedAt + ms) / 1000)
    this.timer = setTimeout(() => this.stop('timeout', `Stopped after ${seconds} s`), ms)
  }

  private startedAt = Date.now()

  stop(status: StopRun['status'], message: string) {
    if (!this.controller.signal.aborted) this.controller.abort(new StopRun(status, message))
  }

  async execute(): Promise<RunResult> {
    const { engine, tile } = this
    const started = performance.now()
    engine.emit({ type: 'run:start', runId: this.id, tileId: tile.id, trigger: this.event.type })
    this.startedAt = Date.now()
    this.armTimer(engine.timeoutMs)

    let status: RunStatus = 'ok'
    let error: string | undefined
    let failedNodeId: string | undefined
    try {
      const problem = validateGraph(tile.graph, engine.opts.registry).find(
        (i) => i.severity === 'error',
      )
      if (problem)
        throw new NodeFailure(problem.nodeId ?? '', `This tile needs fixing: ${problem.message}`)
      const triggers = tile.graph.nodes.filter(
        (n) =>
          this.def(n.id)?.trigger === this.event.type &&
          (!this.event.nodeId || n.id === this.event.nodeId),
      )
      for (const node of triggers) await this.runFlow(node)
    } catch (err) {
      if (err instanceof StopRun) status = err.status
      else status = 'error'
      error = (err as Error).message
      if (err instanceof NodeFailure && err.nodeId) failedNodeId = err.nodeId
    } finally {
      clearTimeout(this.timer)
    }

    for (const node of tile.graph.nodes) {
      if (!this.status.has(node.id)) this.setStatus(node.id, 'skipped')
    }
    const result: RunResult = {
      runId: this.id,
      status,
      steps: this.steps,
      nodes: Object.fromEntries(this.status),
    }
    if (error !== undefined) result.error = error
    if (failedNodeId !== undefined) result.failedNodeId = failedNodeId
    engine.emit({
      type: 'run:end',
      runId: this.id,
      tileId: tile.id,
      status,
      ms: Math.round(performance.now() - started),
      steps: this.steps,
      ...(error !== undefined && { error }),
      ...(failedNodeId !== undefined && { failedNodeId }),
    })
    return result
  }

  private def(nodeId: string): BlockDefinition | undefined {
    const node = this.nodes.get(nodeId)
    return node && this.engine.opts.registry.get(node.type)
  }

  private async runFlow(node: GraphNode): Promise<void> {
    const def = this.def(node.id)
    if (!def) return
    const result = await this.exec(node, def, 0)
    if (result.loop) {
      const values = this.outputs.get(node.id) ?? {}
      for (let index = 0; index < result.loop.times; index++) {
        this.outputs.set(node.id, { ...values, index })
        for (const edge of this.flowEdges.get(`${node.id}:${result.loop.port}`) ?? []) {
          const target = this.nodes.get(edge.to.nodeId)
          if (target) await this.runFlow(target)
        }
      }
    }
    const flowOutputs = def.outputs.filter((p) => p.kind === 'flow')
    const next = result.next ?? flowOutputs[0]?.id
    if (next === undefined) return
    if (!flowOutputs.some((p) => p.id === next)) {
      throw new NodeFailure(node.id, `${def.name} chose an output it does not have ("${next}")`)
    }
    for (const edge of this.flowEdges.get(`${node.id}:${next}`) ?? []) {
      const target = this.nodes.get(edge.to.nodeId)
      if (target) await this.runFlow(target)
    }
  }

  private async exec(node: GraphNode, def: BlockDefinition, depth: number) {
    const { signal } = this.controller
    if (signal.aborted) throw signal.reason
    if (++this.steps > this.engine.maxSteps) {
      throw new NodeFailure(
        node.id,
        `Stopped after ${this.engine.maxSteps} steps. Is something looping?`,
      )
    }
    const { platform } = this.engine.opts
    if (def.platforms && !def.platforms.includes(platform.os)) {
      const message = `${def.name} isn't available on ${osName[platform.os]}`
      this.setStatus(node.id, 'error', message)
      throw new NodeFailure(node.id, message)
    }

    this.setStatus(node.id, 'running')
    const started = performance.now()
    try {
      const input = await this.resolveInputs(node, depth)
      const params = this.renderParams(node, def, input)
      const ctx: RunContext = {
        platform,
        tileId: this.tile.id,
        trigger: this.event,
        globals: {
          get: (name) => this.engine.opts.globals.get(name),
          set: (name, value) => this.engine.opts.globals.set(name, toJsonValue(value)),
        },
        locals: this.locals,
        signal,
        now: () => this.engine.opts.now?.() ?? new Date(),
        setAppearance: (change, opts) =>
          this.engine.opts.onAppearance?.(
            opts?.tileId || this.tile.id,
            change,
            opts?.remember ?? false,
          ),
        tileState: {
          get: (key) => this.engine.opts.tileState?.get(this.tile.id, key),
          set: (key, value) => this.engine.opts.tileState?.set(this.tile.id, key, value),
        },
        switchPage: (pageId) => this.engine.opts.onSwitchPage?.(pageId),
        runTile: (tileId) => this.runOther(tileId),
        extendTimeout: (ms) => this.extendTimeout(ms),
        refreshParams: async () =>
          this.renderParams(node, def, await this.resolveInputs(node, depth)),
      }
      const result = (await raceAbort(Promise.resolve(def.run(ctx, params, input)), signal)) ?? {}
      this.outputs.set(node.id, result.values ?? {})
      this.setStatus(node.id, 'ok', undefined, performance.now() - started)
      return result
    } catch (err) {
      if (err instanceof StopRun) {
        this.setStatus(node.id, 'error', err.message)
        throw err
      }
      if (err instanceof NodeFailure && err.nodeId !== node.id) {
        this.setStatus(node.id, 'error', 'An input failed')
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus(node.id, 'error', message)
      throw new NodeFailure(node.id, message)
    }
  }

  /** Tiles that pressed each other in this chain, so A -> B -> A is refused. */
  private async runOther(tileId: string) {
    const chain = [...((this.event.data?.['chain'] as string[] | undefined) ?? []), this.tile.id]
    if (chain.includes(tileId)) throw new UserFacingError('That would run tiles in a circle')
    if (chain.length >= MAX_TILE_CHAIN)
      throw new UserFacingError(`Tiles can only run each other ${MAX_TILE_CHAIN} deep`)
    const target = this.engine.opts.findTile?.(tileId)
    if (!target) throw new UserFacingError('That tile no longer exists')
    const result = await this.engine.trigger(target, { type: 'press', data: { chain } })
    if (result && result.status !== 'ok') {
      throw new UserFacingError(
        `The other tile ${result.status === 'error' ? 'failed' : 'stopped'}${result.error ? `: ${result.error}` : ''}`,
      )
    }
  }

  private async resolveInputs(node: GraphNode, depth: number) {
    const input: Record<string, unknown> = {}
    const def = this.def(node.id)
    for (const edge of this.valueEdges.get(node.id) ?? []) {
      const source = this.nodes.get(edge.from.nodeId)
      const sourceDef = source && this.def(source.id)
      if (!source || !sourceDef) continue
      // Data blocks are re-read every time so values like Get variable are never stale.
      const outputs = isDataBlock(sourceDef)
        ? (await this.exec(source, sourceDef, depth + 1)).values
        : this.outputs.get(source.id)
      const type = def?.inputs.find((p) => p.id === edge.to.port)?.type ?? 'any'
      input[edge.to.port] = coerce(outputs?.[edge.from.port], type)
    }
    return input
  }

  private renderParams(node: GraphNode, def: BlockDefinition, input: Record<string, unknown>) {
    const scope = {
      input,
      var: this.engine.opts.globals.all(),
      local: Object.fromEntries(this.locals),
      trigger: { type: this.event.type, ...this.event.data },
      tile: { id: this.tile.id },
    }
    const rendered = renderParams(node.params, scope) as Record<string, unknown>
    // A wired value input overrides the param of the same name.
    for (const [port, value] of Object.entries(input)) rendered[port] = value
    const parsed = def.paramsSchema.safeParse(rendered)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.')
      throw new Error(`${field ? `${field}: ` : ''}${issue?.message ?? 'invalid settings'}`)
    }
    return parsed.data
  }

  private setStatus(nodeId: string, status: NodeStatus, error?: string, ms?: number) {
    this.status.set(nodeId, status)
    this.engine.emit({
      type: 'node',
      runId: this.id,
      tileId: this.tile.id,
      nodeId,
      status,
      ...(error !== undefined && { error }),
      ...(ms !== undefined && { ms: Math.round(ms) }),
    })
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function coerce(value: unknown, type: ValueType): unknown {
  if (value === undefined) return value
  switch (type) {
    case 'number':
      return isNumeric(value) ? Number(value) : value
    case 'boolean':
      return typeof value === 'boolean' ? value : toBool(value)
    case 'string':
      return toText(value)
    case 'any':
      return value
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}
