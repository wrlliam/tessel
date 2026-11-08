import {
  Engine,
  toJsonValue,
  type AppearanceChange,
  type BlockRegistry,
  type EngineEvent,
  type JsonValue,
  type Platform,
  type Profile,
  type RunnableTile,
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
  /** Variables or tile state changed, so live appearance may need updating. */
  onStateChanged(): void
  onSwitchPage(pageId: string): void
  findTile(tileId: string): RunnableTile | undefined
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
      tileState: {
        get: (tileId, key) => host.get().tileState[tileId]?.[key],
        set: (tileId, key, value) =>
          this.update((p) => ({
            ...p,
            tileState: {
              ...p.tileState,
              [tileId]: { ...p.tileState[tileId], [key]: toJsonValue(value) },
            },
          })),
      },
      onSwitchPage: (pageId) => host.onSwitchPage(pageId),
      findTile: (tileId) => host.findTile(tileId),
    })
  }

  setVariables(values: Record<string, JsonValue>) {
    this.update((p) => ({ ...p, variables: { ...p.variables, ...values } }))
  }

  /** Changes run-time data in the profile and saves it shortly after. */
  private update(change: (profile: Profile) => Profile) {
    this.host.replace(change(this.host.get()))
    this.host.onStateChanged()
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
