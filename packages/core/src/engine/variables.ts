import type { JsonValue } from '../model.ts'

/** Global variables persist per profile; the desktop backs this with the profile file. */
export interface VariableStore {
  get(name: string): JsonValue | undefined
  set(name: string, value: JsonValue): void
  all(): Record<string, JsonValue>
}

export class MemoryVariables implements VariableStore {
  private values: Record<string, JsonValue>
  constructor(initial: Record<string, JsonValue> = {}) {
    this.values = { ...initial }
  }
  get(name: string) {
    return Object.hasOwn(this.values, name) ? this.values[name] : undefined
  }
  set(name: string, value: JsonValue) {
    this.values[name] = value
  }
  all() {
    return { ...this.values }
  }
}

/** Coerces block output into something storable as JSON. */
export function toJsonValue(v: unknown): JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v === undefined) return null
  return JSON.stringify(v)
}
