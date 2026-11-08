import {
  Engine,
  type AppearanceChange,
  type BlockRegistry,
  type EngineEvent,
  type JsonValue,
  type Platform,
  type Profile,
} from '@tessel/core'

const VARIABLE_SAVE_DELAY_MS = 500

export interface RuntimeHost {
  registry: BlockRegistry
  platform: Platform
  get(): Profile
  /** Stores a changed profile in memory; `persist` writes it to disk. */
  replace(profile: Profile): void
  persist(profile: Profile): Promise<void>
  onEvent(event: EngineEvent): void
  onAppearance(tileId: string, change: AppearanceChange): void
  onVariablesChanged(): void
  onSaveError(err: Error): void
}

/** One profile's engine and its global variables. Each profile runs separately. */
export class ProfileRuntime {
  readonly engine: Engine
  private saveTimer?: NodeJS.Timeout

  constructor(private host: RuntimeHost) {
    this.engine = new Engine({
      registry: host.registry,
      platform: host.platform,
      globals: {
        get: (name) => {
          const vars = host.get().variables
          return Object.hasOwn(vars, name) ? vars[name] : undefined
        },
        set: (name, value) => this.setVariables({ [name]: value }),
        all: () => ({ ...host.get().variables }),
      },
      onEvent: (e) => host.onEvent(e),
      onAppearance: (tileId, change) => host.onAppearance(tileId, change),
    })
  }

  setVariables(values: Record<string, JsonValue>) {
    const profile = this.host.get()
    this.host.replace({ ...profile, variables: { ...profile.variables, ...values } })
    this.host.onVariablesChanged()
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.host.persist(this.host.get()).catch((err: Error) => this.host.onSaveError(err))
    }, VARIABLE_SAVE_DELAY_MS)
  }

  /** Writes pending variable changes now. */
  async flush() {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    await this.host.persist(this.host.get())
  }

  async dispose() {
    this.engine.cancelAll()
    await this.flush()
  }
}
