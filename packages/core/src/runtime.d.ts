// The few web-standard globals core relies on. Browsers, Node and Electron all provide them;
// declaring them here keeps DOM and Node typings (and their APIs) out of core.
declare function setTimeout(callback: (...args: never[]) => void, ms?: number): unknown
declare function clearTimeout(id: unknown): void

interface AbortSignal {
  readonly aborted: boolean
  readonly reason: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

declare class AbortController {
  readonly signal: AbortSignal
  abort(reason?: unknown): void
}

interface Performance {
  now(): number
}
declare const performance: Performance

declare function structuredClone<T>(value: T): T
