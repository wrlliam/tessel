// Which apps are open, for Open app tiles that light up while their app runs. Process lists
// are cheap to read and need no extra permissions.
import type { OS } from '@tessel/core'
import type { Run } from './exec.ts'

/** "Visual Studio Code.app" -> "visualstudiocode". */
export const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(app|exe)$/, '')
    .replace(/[^a-z0-9]/g, '')

/** macOS: app bundles from full process paths, e.g. /Applications/Spotify.app/Contents/MacOS/Spotify. */
export function parseMac(ps: string): string[] {
  const names = new Set<string>()
  for (const line of ps.split('\n')) {
    const m = /\/([^/]+)\.app\/Contents\/MacOS\//.exec(line)
    if (m?.[1]) names.add(normalise(m[1]))
  }
  return [...names]
}

/** Windows: `tasklist /fo csv /nh` lines, e.g. "Spotify.exe","1234",... */
export function parseTasklist(csv: string): string[] {
  const names = new Set<string>()
  for (const line of csv.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim())
    if (m?.[1]) names.add(normalise(m[1]))
  }
  return [...names]
}

export const parseLinux = (ps: string) => [
  ...new Set(
    ps
      .split('\n')
      .map((l) => normalise(l.trim()))
      .filter(Boolean),
  ),
]

/** Whether an Open app target (a name or a path) is among the running apps. */
export function isRunning(app: string, running: readonly string[]): boolean {
  const base = app.split(/[\\/]/).pop() ?? app
  const want = normalise(base)
  if (!want) return false
  return running.some(
    (r) =>
      r === want || (r.length >= 4 && want.includes(r)) || (want.length >= 4 && r.includes(want)),
  )
}

export function createRunningApps(os: OS, run: Run): () => Promise<string[]> {
  return async () => {
    if (os === 'darwin') return parseMac((await run('ps', ['-axo', 'comm='])).stdout)
    if (os === 'win32')
      return parseTasklist((await run('tasklist.exe', ['/fo', 'csv', '/nh'])).stdout)
    return parseLinux((await run('ps', ['-eo', 'comm='])).stdout)
  }
}
