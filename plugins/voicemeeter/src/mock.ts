import { TYPE_BY_NUMBER, VoicemeeterError, type VmType, type VoicemeeterApi } from './api.ts'

/** In-memory Voicemeeter for tests and for trying the plugin without Windows. */
export class MockVoicemeeter implements VoicemeeterApi {
  params = new Map<string, number | string>()
  levels = new Map<string, number>()
  macro = new Map<number, number[]>()
  scripts: string[] = []
  dirty = false
  loggedOut = false
  private kind: VmType

  constructor(kind: VmType | number = 'banana') {
    this.kind = typeof kind === 'number' ? (TYPE_BY_NUMBER[kind] ?? 'banana') : kind
  }

  type() {
    return this.kind
  }
  isDirty() {
    const d = this.dirty
    this.dirty = false
    return d
  }
  getFloat(param: string) {
    const v = this.params.get(param) ?? 0
    if (typeof v !== 'number') throw new VoicemeeterError(`${param} is text`)
    return v
  }
  getString(param: string) {
    return String(this.params.get(param) ?? '')
  }
  setFloat(param: string, value: number) {
    this.params.set(param, value)
    this.dirty = true
  }
  setString(param: string, value: string) {
    this.params.set(param, value)
    this.dirty = true
  }
  setParameters(script: string) {
    this.scripts.push(script)
    for (const command of script.split(';').filter(Boolean)) {
      const [name = '', raw = ''] = command.split('=')
      const value = raw.startsWith('"') ? raw.slice(1, -1) : Number(raw)
      this.params.set(name.trim(), value)
    }
    this.dirty = true
  }
  getLevel(kind: number, channel: number) {
    return this.levels.get(`${kind}:${channel}`) ?? 0
  }
  setMacroButton(index: number, value: number) {
    this.macro.set(index, [...(this.macro.get(index) ?? []), value])
  }
  logout() {
    this.loggedOut = true
  }
  /** Simulates a change made in Voicemeeter itself. */
  externalChange(param: string, value: number) {
    this.params.set(param, value)
    this.dirty = true
  }
}
