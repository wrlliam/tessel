import { defineBlock, definePlugin, defineTrigger, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export interface SavedFile {
  path: string
  name: string
  mtime: number
}

/** Lists clip and screenshot files under a folder (and its subfolders). */
export type ListMedia = (folder: string) => Promise<SavedFile[]>

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }
const VIDEO = /\.(mp4|mkv|mov|webm)$/i
const IMAGE = /\.(png|jpe?g|webp)$/i

export function createMedalPlugin(
  list: ListMedia,
  defaultFolders: () => string[],
  now = () => Date.now(),
) {
  let settings = { clipKey: 'f8', screenshotKey: '', recordKey: '', folder: '' }
  const apply = (s: Record<string, unknown>) => {
    settings = {
      clipKey: String(s['clipKey'] || 'f8'),
      screenshotKey: String(s['screenshotKey'] ?? ''),
      recordKey: String(s['recordKey'] ?? ''),
      folder: String(s['folder'] ?? '').trim(),
    }
  }
  const folders = () => (settings.folder ? [settings.folder] : defaultFolders())
  async function media(): Promise<SavedFile[]> {
    const all: SavedFile[] = []
    for (const f of folders()) all.push(...(await list(f).catch(() => [])))
    return all
      .filter((m) => VIDEO.test(m.name) || IMAGE.test(m.name))
      .sort((a, b) => b.mtime - a.mtime)
  }
  const press = async (ctx: { pressKeys(c: string): Promise<void> }, key: string, what: string) => {
    if (!key)
      throw new PluginError(`Set Medal's ${what} hotkey in Plugins › Medal › Settings first.`)
    try {
      await ctx.pressKeys(key)
    } catch (err) {
      throw new PluginError((err as Error).message)
    }
  }

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'clip',
        name: 'Medal: clip that',
        description:
          "Presses Medal's clip hotkey, saving the last moments of your game. Medal must be running; the game keeps focus.",
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => press(ctx, settings.clipKey, 'clip'),
      }),
      defineBlock({
        id: 'screenshot',
        name: 'Medal: screenshot',
        description: "Presses Medal's screenshot hotkey.",
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => press(ctx, settings.screenshotKey, 'screenshot'),
      }),
      defineBlock({
        id: 'record',
        name: 'Medal: start or stop recording',
        description:
          "Presses Medal's start/stop recording hotkey, and keeps {{state.recording}} on the tile.",
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [
          { id: 'started', kind: 'flow' },
          { id: 'stopped', kind: 'flow' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => {
          await press(ctx, settings.recordKey, 'start/stop recording')
          const was = (await ctx.storage.get<boolean>('recording')) ?? false
          await ctx.storage.set('recording', !was)
          ctx.setTileState('recording', !was)
          return { next: was ? 'stopped' : 'started' }
        },
      }),
      defineBlock({
        id: 'latest',
        name: 'Medal: latest clip',
        description:
          'The newest clip or screenshot in your Medal library: its name, path and how long ago.',
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [
          flowOut,
          { id: 'nothing', kind: 'flow' },
          { id: 'name', kind: 'value', type: 'string' },
          { id: 'path', kind: 'value', type: 'string' },
          { id: 'minutesAgo', kind: 'value', type: 'number', label: 'minutes ago' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async () => {
          const [first] = await media()
          if (!first) return { next: 'nothing' }
          return {
            values: {
              name: first.name,
              path: first.path,
              minutesAgo: Math.round((now() - first.mtime) / 60_000),
            },
          }
        },
      }),
    ],
    triggers: [
      defineTrigger({
        id: 'saved',
        name: 'Medal: when a clip is saved',
        description:
          'Starts the tile when a new clip (or screenshot) appears in your Medal library, e.g. to pop up "Clip saved".',
        platforms: ['win32'],
        outputs: [
          { id: 'name', kind: 'value', type: 'string' },
          { id: 'path', kind: 'value', type: 'string' },
          { id: 'kind', kind: 'value', type: 'string', label: 'clip or screenshot' },
        ],
        paramsSchema: z.object({ what: z.enum(['clips', 'screenshots', 'both']).default('clips') }),
        fields: [
          {
            key: 'what',
            label: 'Watch for',
            widget: 'select',
            options: [
              { value: 'clips', label: 'Clips' },
              { value: 'screenshots', label: 'Screenshots' },
              { value: 'both', label: 'Both' },
            ],
          },
        ],
        defaults: { what: 'clips' },
        subscribe: (_ctx, sub) => {
          let since = now()
          let seen = new Set<string>()
          let stopped = false
          const check = async () => {
            if (stopped) return
            const found = await media()
            const fresh = found.filter((m) => m.mtime >= since - 1000 && !seen.has(m.path))
            for (const m of fresh.reverse()) {
              const kind = VIDEO.test(m.name) ? 'clip' : 'screenshot'
              seen.add(m.path)
              if (sub.params.what !== 'both' && `${kind}s` !== sub.params.what) continue
              sub.setTileState('lastClip', m.name)
              sub.emit({ name: m.name, path: m.path, kind })
            }
            if (seen.size > 500) seen = new Set([...seen].slice(-100))
          }
          // Clips already there when the tile starts don't count.
          void media().then((m) => {
            seen = new Set(m.map((x) => x.path))
            since = now()
          })
          const timer = setInterval(() => void check(), 3000)
          return () => {
            stopped = true
            clearInterval(timer)
          }
        },
      }),
    ],
  })
}
