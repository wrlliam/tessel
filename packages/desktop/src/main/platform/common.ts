import {
  UserFacingError,
  type HttpRequest,
  type HttpResponse,
  type ShellResult,
} from '@tessel/core'
import { exec } from 'node:child_process'
import { homedir } from 'node:os'

/** Shell commands are off unless the user allows them, and can ask every time. */
export type ShellPolicy = 'off' | 'confirm' | 'on'

export interface CommonDeps {
  shellPolicy: () => ShellPolicy
  /** Shows the command and resolves true if the user says to run it. */
  confirmShell: (command: string) => Promise<boolean>
  runCommand?: (command: string, signal: AbortSignal) => Promise<ShellResult>
  fetch?: typeof fetch
  openExternal: (url: string) => Promise<void>
  openPath: (path: string) => Promise<string>
  writeClipboard: (text: string) => Promise<void>
  notify: (title: string, body: string) => void
}

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024

const runCommand = (command: string, signal: AbortSignal) =>
  new Promise<ShellResult>((resolve, reject) => {
    exec(
      command,
      { signal, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && (err.name === 'AbortError' || signal.aborted))
          return reject(signal.reason ?? err)
        if (err && typeof err.code !== 'number')
          return reject(new UserFacingError(`Couldn't run the command: ${err.message}`))
        resolve({ code: err ? (err.code as number) : 0, stdout, stderr })
      },
    )
  })

/** Reads at most `limit` bytes of a response body as text. */
export async function readCapped(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  await reader.cancel().catch(() => {})
  const bytes = new Uint8Array(Math.min(size, limit))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, bytes.length - offset))
    bytes.set(part, offset)
    offset += part.length
  }
  return new TextDecoder().decode(bytes)
}

export const expandHome = (path: string) =>
  path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path

/** Platform calls that work the same on every OS. */
export function createCommon(deps: CommonDeps) {
  const doFetch = deps.fetch ?? fetch
  const doRun = deps.runCommand ?? runCommand

  return {
    openUrl: (url: string) => deps.openExternal(url),

    async openFile(path: string) {
      const error = await deps.openPath(expandHome(path))
      if (error) throw new UserFacingError(`Couldn't open "${path}": ${error}`)
    },

    setClipboard: (text: string) => deps.writeClipboard(text),

    async notify(title: string, body: string) {
      deps.notify(title, body)
    },

    async http(req: HttpRequest): Promise<HttpResponse> {
      let response: Response
      try {
        response = await doFetch(req.url, {
          method: req.method,
          headers: req.headers,
          ...(req.body !== undefined && { body: req.body }),
          signal: req.signal,
          redirect: 'follow',
        })
      } catch (err) {
        if (req.signal.aborted) throw req.signal.reason
        const cause = (err as { cause?: { code?: string } }).cause?.code
        throw new UserFacingError(
          `Couldn't reach ${new URL(req.url).host}${cause ? ` (${cause})` : ''}`,
        )
      }
      return { status: response.status, body: await readCapped(response) }
    },

    async runShell(command: string, signal: AbortSignal): Promise<ShellResult> {
      const policy = deps.shellPolicy()
      if (policy === 'off') {
        throw new UserFacingError(
          'Shell commands are turned off. Allow them in Settings if you trust this tile.',
        )
      }
      if (policy === 'confirm' && !(await deps.confirmShell(command))) {
        throw new UserFacingError('You chose not to run the command.')
      }
      return doRun(command, signal)
    },
  }
}
