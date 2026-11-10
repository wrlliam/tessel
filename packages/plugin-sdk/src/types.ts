// Plugin-facing types. They mirror Tessel's core block types so plugins don't depend on core.

export type ValueType = 'string' | 'number' | 'boolean' | 'any'
export type OS = 'darwin' | 'win32' | 'linux'
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface PortDef {
  id: string
  kind: 'flow' | 'value'
  type?: ValueType
  label?: string
}

export interface FieldDef {
  key: string
  label: string
  widget: 'text' | 'textarea' | 'number' | 'toggle' | 'select'
  placeholder?: string
  help?: string
  options?: Array<{ value: string; label: string }>
  when?: { key: string; is: string[] }
}

export interface BlockResult {
  /** Flow output to follow. Defaults to the first flow output. */
  next?: string
  values?: Record<string, unknown>
}

/** Anything with zod's safeParse, so plugins can use their own zod version. */
export interface ParamsSchema<P> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: P }
    | { success: false; error: { issues: Array<{ message: string; path: PropertyKey[] }> } }
}

export interface PluginLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Small key-value store kept by Tessel for each plugin. */
export interface PluginStorage {
  get<T extends Json>(key: string): Promise<T | undefined>
  set(key: string, value: Json): Promise<void>
  delete(key: string): Promise<void>
}

export interface PluginContext {
  pluginId: string
  os: OS
  /** Current values of the plugin's settings form. */
  settings: Record<string, unknown>
  log: PluginLogger
  storage: PluginStorage
  /**
   * Presses a key combination on the computer, e.g. 'f8' or 'ctrl+shift+s' ('mod' is Cmd on macOS,
   * Ctrl elsewhere). Needs the "input" permission in the manifest.
   */
  pressKeys(combo: string): Promise<void>
}

export interface BlockRunContext extends PluginContext {
  tileId: string
  /** Aborted when the tile is stopped or times out. */
  signal: AbortSignal
  /** Sets a value the tile can show, e.g. {{state.muted}} in live appearance. */
  setTileState(key: string, value: Json): void
  /**
   * Runs one of Tessel's blocks (or another plugin's) for this tile, e.g.
   * runBlock('action.toast', { title: 'Hi', body: 'There' }). Needs the "shell" permission,
   * since Tessel's blocks can do anything.
   */
  runBlock(
    type: string,
    params?: Record<string, unknown>,
    input?: Record<string, unknown>,
  ): Promise<{ next?: string; values: Record<string, unknown> }>
}

export interface PluginBlock<P = unknown> {
  /** Short id, unique within the plugin. Tessel adds the plugin id in front. */
  id: string
  name: string
  description: string
  platforms?: OS[]
  inputs: PortDef[]
  outputs: PortDef[]
  paramsSchema: ParamsSchema<P>
  fields?: FieldDef[]
  defaults?: Record<string, unknown>
  /** For slow work, e.g. asking an AI model: how long a run may take, up to 600 s. Default 30 s. */
  timeoutSeconds?: number
  run(
    ctx: BlockRunContext,
    params: P,
    input: Record<string, unknown>,
    // Plugins may return nothing, or the result of a call that returns void.
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ): Promise<BlockResult | void> | BlockResult | void
}

export interface TriggerSubscription<P = unknown> {
  tileId: string
  params: P
  /** Starts the tile. Values appear on the trigger block's value outputs. */
  emit(values?: Record<string, unknown>): void
  setTileState(key: string, value: Json): void
}

export interface PluginTrigger<P = unknown> {
  id: string
  name: string
  description: string
  platforms?: OS[]
  /** Value outputs only; Tessel adds the flow output. */
  outputs: PortDef[]
  paramsSchema: ParamsSchema<P>
  fields?: FieldDef[]
  defaults?: Record<string, unknown>
  /**
   * Called for each trigger block placed on a tile of the active profile.
   * Return a function that stops watching.
   */
  // Plugins may return nothing, or the result of a call that returns void.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  subscribe(ctx: PluginContext, sub: TriggerSubscription<P>): (() => void) | void
}

export interface PluginDefinition {
  // Any params type: each block checks its own with paramsSchema.
  blocks?: Array<PluginBlock<never>>
  triggers?: Array<PluginTrigger<never>>
  onLoad?(ctx: PluginContext): Promise<void> | void
  onUnload?(): Promise<void> | void
  onSettings?(settings: Record<string, unknown>): Promise<void> | void
}

/** Identity helpers that give plugin authors type checking. */
export const definePlugin = (plugin: PluginDefinition): PluginDefinition => plugin
export const defineBlock = <P>(block: PluginBlock<P>): PluginBlock<never> =>
  block as unknown as PluginBlock<never>
export const defineTrigger = <P>(trigger: PluginTrigger<P>): PluginTrigger<never> =>
  trigger as unknown as PluginTrigger<never>

/** Thrown with a message meant for the person using the tile. */
export class PluginError extends Error {}
