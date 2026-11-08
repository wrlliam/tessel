import { defineBlock, definePlugin, PluginError, type OS } from '@tessel/plugin-sdk'
import { z } from 'zod'

export type Run = (cmd: string, args: string[]) => Promise<string>
const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

/** https://open.spotify.com/playlist/abc?si=… -> spotify:playlist:abc */
export function toUri(link: string): string {
  const t = link.trim()
  if (/^spotify:[a-z]+:[A-Za-z0-9]+$/.test(t)) return t
  const m =
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/.exec(
      t,
    )
  if (!m) throw new PluginError('Paste a Spotify link (Share › Copy link) or a spotify: URI.')
  return `spotify:${m[1]}:${m[2]}`
}

const apple = (script: string) => ['-e', script]

export function createSpotifyPlugin(run: Run, os: () => OS) {
  const mac = async (script: string) => {
    if (os() !== 'darwin') throw new PluginError('This works with Spotify on macOS.')
    try {
      return await run('osascript', apple(`tell application "Spotify"\n${script}\nend tell`))
    } catch (err) {
      const m = (err as Error).message
      throw new PluginError(
        m.includes('-1743')
          ? 'Allow Tessel to control Spotify in System Settings › Privacy & Security › Automation.'
          : `Spotify: ${m.split('\n')[0]}`,
      )
    }
  }
  return definePlugin({
    blocks: [
      defineBlock({
        id: 'play',
        name: 'Spotify: play',
        description:
          'Plays a playlist, album, song or podcast from its Spotify link. On Windows and Linux it opens it in Spotify.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({ link: z.string().min(1, 'Paste a Spotify link').max(300) }),
        fields: [
          {
            key: 'link',
            label: 'Spotify link',
            widget: 'text',
            placeholder: 'https://open.spotify.com/playlist/…',
          },
        ],
        defaults: { link: '' },
        run: async (_ctx, p) => {
          const uri = toUri(p.link)
          if (os() === 'darwin') await mac(`play track "${uri}"`)
          else if (os() === 'win32') await run('cmd.exe', ['/c', 'start', '', uri])
          else await run('xdg-open', [uri])
        },
      }),
      defineBlock({
        id: 'volume',
        name: 'Spotify: volume',
        description: "Sets Spotify's own volume, 0 to 100 (macOS). Wire a slider into level.",
        platforms: ['darwin'],
        inputs: [flowIn, { id: 'level', kind: 'value', type: 'number' }],
        outputs: [flowOut],
        paramsSchema: z.object({ level: z.coerce.number().min(0).max(100) }),
        fields: [{ key: 'level', label: 'Volume', widget: 'number' }],
        defaults: { level: 50 },
        run: async (_ctx, p) => {
          await mac(`set sound volume to ${Math.round(p.level)}`)
        },
      }),
      defineBlock({
        id: 'shuffle',
        name: 'Spotify: shuffle and repeat',
        description: "Turns shuffle or repeat on, off or flips it (macOS). Goes out 'on' or 'off'.",
        platforms: ['darwin'],
        inputs: [flowIn],
        outputs: [
          { id: 'on', kind: 'flow' },
          { id: 'off', kind: 'flow' },
        ],
        paramsSchema: z.object({
          what: z.enum(['shuffling', 'repeating']).default('shuffling'),
          action: z.enum(['toggle', 'on', 'off']).default('toggle'),
        }),
        fields: [
          {
            key: 'what',
            label: 'What',
            widget: 'select',
            options: [
              { value: 'shuffling', label: 'Shuffle' },
              { value: 'repeating', label: 'Repeat' },
            ],
          },
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'toggle', label: 'Flip' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ],
          },
        ],
        defaults: { what: 'shuffling', action: 'toggle' },
        run: async (ctx, p) => {
          const value = p.action === 'toggle' ? `not ${p.what}` : String(p.action === 'on')
          const now = (await mac(`set ${p.what} to ${value}\nreturn ${p.what}`)).trim() === 'true'
          ctx.setTileState(p.what === 'shuffling' ? 'shuffle' : 'repeat', now)
          return { next: now ? 'on' : 'off' }
        },
      }),
    ],
  })
}
