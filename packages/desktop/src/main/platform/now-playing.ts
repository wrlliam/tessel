// What's playing, per OS: Spotify or Apple Music on macOS (AppleScript), the system media
// session on Windows (Spotify, browsers and most players), and MPRIS players on Linux (playerctl).
import type { NowPlayingInfo, OS } from '@tessel/core'
import { isMissingProgram, type Run } from './exec.ts'

const num = (s: string | undefined) => {
  const n = Number(
    String(s ?? '')
      .trim()
      .replace(',', '.'),
  )
  return Number.isFinite(n) ? n : undefined
}

export const DARWIN_SCRIPT = `set out to ""
if application "Spotify" is running then
  tell application "Spotify"
    if player state is not stopped then set out to "Spotify" & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & ((duration of current track) / 1000) & tab & player position & tab & (player state as text)
  end tell
end if
if out is "" and application "Music" is running then
  tell application "Music"
    if player state is not stopped then set out to "Music" & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & (duration of current track) & tab & player position & tab & (player state as text)
  end tell
end if
return out`

/** app, title, artist, album, duration s, position s, state; separated by tabs. */
export function parseDarwin(stdout: string): NowPlayingInfo | undefined {
  const [app, title, artist, album, duration, position, state] = stdout.trim().split('\t')
  if (!title) return undefined
  return {
    app,
    title,
    artist: artist ?? '',
    ...(album && { album }),
    playing: state === 'playing',
    ...(num(duration) !== undefined && { duration: num(duration) }),
    ...(num(position) !== undefined && { position: num(position) }),
  }
}

export const LINUX_FORMAT =
  '{{playerName}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:length}}\t{{position}}\t{{status}}'

/** Same as macOS, but length and position are in microseconds. */
export function parseLinux(stdout: string): NowPlayingInfo | undefined {
  const [app, title, artist, album, length, position, status] = stdout.trim().split('\t')
  if (!title) return undefined
  const us = (v: string | undefined) => (num(v) !== undefined ? (num(v) ?? 0) / 1e6 : undefined)
  return {
    app,
    title,
    artist: artist ?? '',
    ...(album && { album }),
    playing: status === 'Playing',
    ...(us(length) !== undefined && { duration: us(length) }),
    ...(us(position) !== undefined && { position: us(position) }),
  }
}

export const WIN32_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $manager.GetCurrentSession()
if ($s) {
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $s.GetTimelineProperties()
  $playing = $s.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
  $pos = $tl.Position.TotalSeconds
  if ($playing) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
  [pscustomobject]@{ app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; position = $pos; duration = $tl.EndTime.TotalSeconds; playing = $playing } | ConvertTo-Json -Compress
}`

export function parseWin32(stdout: string): NowPlayingInfo | undefined {
  const text = stdout.trim()
  if (!text) return undefined
  const j = JSON.parse(text) as Record<string, unknown>
  if (!j['title']) return undefined
  const app = String(j['app'] ?? '')
  const duration = num(String(j['duration']))
  const position = num(String(j['position']))
  return {
    app: /spotify/i.test(app) ? 'Spotify' : app,
    title: String(j['title']),
    artist: String(j['artist'] ?? ''),
    ...(j['album'] ? { album: String(j['album']) } : {}),
    playing: j['playing'] === true,
    ...(duration ? { duration } : {}),
    ...(position !== undefined && duration ? { position: Math.min(position, duration) } : {}),
  }
}

export function createNowPlaying(os: OS, run: Run): () => Promise<NowPlayingInfo | undefined> {
  return async () => {
    try {
      if (os === 'darwin')
        return parseDarwin((await run('osascript', ['-e', DARWIN_SCRIPT])).stdout)
      if (os === 'win32')
        return parseWin32(
          (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN32_SCRIPT]))
            .stdout,
        )
      return parseLinux(
        (await run('playerctl', ['-p', 'spotify,%any', 'metadata', '--format', LINUX_FORMAT]))
          .stdout,
      )
    } catch (err) {
      if (os === 'linux' && isMissingProgram(err))
        throw new Error(
          "Reading what's playing needs playerctl. Install it with your package manager.",
          { cause: err },
        )
      // playerctl exits non-zero when no player is running.
      if (os === 'linux') return undefined
      throw err
    }
  }
}
