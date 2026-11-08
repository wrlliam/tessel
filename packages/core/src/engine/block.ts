import type { z } from 'zod'
import type { Platform, OS } from './platform.ts'

export type Category = 'trigger' | 'action' | 'logic' | 'data' | 'plugin'
export type ValueType = 'string' | 'number' | 'boolean' | 'any'

export interface PortDef {
  id: string
  kind: 'flow' | 'value'
  /** Value ports only. */
  type?: ValueType
  label?: string
}

export type TriggerType = 'press' | 'longPress' | 'release' | 'pageOpen' | 'schedule' | 'plugin'

export interface TriggerEvent {
  type: TriggerType
  data?: Record<string, unknown>
}

export interface RunContext {
  platform: Platform
  tileId: string
  trigger: TriggerEvent
  /** Global variables, persisted per profile. */
  globals: { get(name: string): unknown; set(name: string, value: unknown): void }
  /** Variables that live for this run only. */
  locals: Map<string, unknown>
  signal: AbortSignal
  now(): Date
}

export interface BlockResult {
  /** Flow output to follow. Defaults to the block's first flow output. */
  next?: string
  values?: Record<string, unknown>
}

export type FieldWidget =
  'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'combo' | 'condition'

/** How the editor shows one param. Text-like fields accept {{templates}}. */
export interface FieldDef {
  key: string
  label: string
  widget: FieldWidget
  placeholder?: string
  help?: string
  options?: Array<{ value: string; label: string }>
}

export interface BlockDefinition<P = unknown> {
  id: string
  category: Category
  name: string
  description: string
  /** Leave out for every OS. */
  platforms?: OS[]
  /** For trigger blocks: the event that starts them. */
  trigger?: TriggerType
  inputs: PortDef[]
  outputs: PortDef[]
  paramsSchema: z.ZodType<P>
  /** Editor form, in display order. */
  fields?: FieldDef[]
  /** Params for a freshly added block. */
  defaults?: Record<string, unknown>
  run(
    ctx: RunContext,
    params: P,
    input: Record<string, unknown>,
    // void lets simple actions return the platform call directly.
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ): Promise<BlockResult | void> | BlockResult | void
}

/** Keeps the params type tied to the schema. */
export const defineBlock = <S extends z.ZodType>(
  def: BlockDefinition<z.output<S>> & { paramsSchema: S },
) => def as unknown as BlockDefinition

/** The serialisable part of a block, sent to the editor. */
export type BlockDescriptor = Omit<BlockDefinition, 'run' | 'paramsSchema'>

export function describeBlock(def: BlockDefinition): BlockDescriptor {
  const { run: _run, paramsSchema: _schema, ...rest } = def
  return structuredClone(rest)
}

export const flowIn: PortDef = { id: 'in', kind: 'flow' }
export const flowOut: PortDef = { id: 'out', kind: 'flow' }

/** A data block has no flow ports; the engine evaluates it whenever a value is read from it. */
export const isDataBlock = (def: BlockDefinition) =>
  !def.trigger && !def.inputs.some((p) => p.kind === 'flow')

export class BlockRegistry {
  private blocks = new Map<string, BlockDefinition>()

  constructor(blocks: BlockDefinition[] = []) {
    blocks.forEach((b) => this.register(b))
  }

  register(block: BlockDefinition) {
    if (this.blocks.has(block.id)) throw new Error(`Block "${block.id}" is already registered`)
    this.blocks.set(block.id, block)
  }

  get(id: string) {
    return this.blocks.get(id)
  }

  list() {
    return [...this.blocks.values()]
  }
}
