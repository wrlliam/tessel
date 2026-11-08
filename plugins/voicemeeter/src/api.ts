export type VmType = 'basic' | 'banana' | 'potato'

/** What the plugin needs from Voicemeeter's Remote API. The real one wraps the DLL; tests use a mock. */
export interface VoicemeeterApi {
  type(): VmType
  /** True when any parameter changed since the last call. */
  isDirty(): boolean
  getFloat(param: string): number
  getString(param: string): string
  setFloat(param: string, value: number): void
  setString(param: string, value: string): void
  /** Runs a script such as `Strip[0].Mute=1;`. */
  setParameters(script: string): void
  /** Level as a linear value; 1 is full scale. */
  getLevel(kind: number, channel: number): number
  setMacroButton(index: number, value: number): void
  logout(): void
}

export const LAYOUT: Record<VmType, { strips: number; buses: number; outputs: string[] }> = {
  basic: { strips: 3, buses: 2, outputs: ['A1', 'B1'] },
  banana: { strips: 5, buses: 5, outputs: ['A1', 'A2', 'A3', 'B1', 'B2'] },
  potato: { strips: 8, buses: 8, outputs: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3'] },
}

export const TYPE_BY_NUMBER: Record<number, VmType> = { 1: 'basic', 2: 'banana', 3: 'potato' }

/** Parameter names like Strip[0].Gain or Bus[2].Mute; nothing that could end a script command early. */
export const PARAM_NAME = /^[A-Za-z]+(\[\d{1,2}\])?(\.[A-Za-z0-9_]+(\[\d{1,2}\])?)*$/

export class VoicemeeterError extends Error {}

export function checkIndex(api: VoicemeeterApi, target: 'strip' | 'bus', index: number) {
  const layout = LAYOUT[api.type()]
  const count = target === 'strip' ? layout.strips : layout.buses
  if (index < 0 || index >= count) {
    throw new VoicemeeterError(
      `Voicemeeter ${api.type()} has ${count} ${target === 'strip' ? 'inputs' : 'outputs'} (numbered 1 to ${count})`,
    )
  }
}

export const paramName = (target: 'strip' | 'bus', index: number, field: string) =>
  `${target === 'strip' ? 'Strip' : 'Bus'}[${index}].${field}`

/** Script value: numbers as they are, text in quotes. */
export function scriptValue(value: string | number): string {
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(value.trim())) return String(value).trim()
  if (/["\n;]/.test(value))
    throw new VoicemeeterError('Text values cannot contain quotes, semicolons or line breaks')
  return `"${value}"`
}

export const toDb = (linear: number) =>
  linear <= 0 ? -200 : Math.round(20 * Math.log10(linear) * 10) / 10
