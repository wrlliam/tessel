import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

/** Sends one remote-control command to Soundpad and returns its reply, e.g. "R-200". */
export type Send = (command: string) => Promise<string>

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

export interface Sound {
  index: number
  title: string
}

/** Reads Soundpad's GetSoundlistXML() reply. */
export function parseSoundList(xml: string): Sound[] {
  const out: Sound[] = []
  for (const m of xml.matchAll(/<Sound\b([^>]*)\/?>/g)) {
    const attrs = m[1] ?? ''
    const index = Number(/\bindex="(\d+)"/.exec(attrs)?.[1])
    const title = decode(/\btitle="([^"]*)"/.exec(attrs)?.[1] ?? '')
    if (Number.isFinite(index)) out.push({ index, title })
  }
  return out
}

const decode = (s: string) =>
  s
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

/** "3" plays sound 3; anything else plays the first sound whose title contains it. */
export function findSound(sounds: Sound[], wanted: string): Sound | undefined {
  const w = wanted.trim()
  if (/^\d+$/.test(w))
    return sounds.find((s) => s.index === Number(w)) ?? { index: Number(w), title: w }
  const lower = w.toLowerCase()
  return (
    sounds.find((s) => s.title.toLowerCase() === lower) ??
    sounds.find((s) => s.title.toLowerCase().includes(lower))
  )
}

const quote = (s: string) => `"${s.replaceAll('"', '')}"`

export function createSoundpadPlugin(send: Send) {
  async function command(cmd: string): Promise<string> {
    let reply: string
    try {
      reply = (await send(cmd)).trim()
    } catch {
      throw new PluginError("Soundpad isn't running, or its remote control is off. Start Soundpad.")
    }
    if (/^R-[45]\d\d/.test(reply)) throw new PluginError(`Soundpad said no (${reply}).`)
    return reply
  }

  return definePlugin({
    blocks: [
      defineBlock({
        id: 'play',
        name: 'Play sound',
        description:
          'Plays a sound by its number in Soundpad, or by part of its name. Choose whether others hear it on your mic.',
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [flowOut, { id: 'title', kind: 'value', type: 'string' }],
        paramsSchema: z.object({
          sound: z.string().min(1, 'Type a sound number or name').max(200),
          where: z.enum(['both', 'speakers', 'mic']).default('both'),
        }),
        fields: [
          { key: 'sound', label: 'Sound', widget: 'text', placeholder: '1, or airhorn' },
          {
            key: 'where',
            label: 'Play on',
            widget: 'select',
            options: [
              { value: 'both', label: 'Speakers and mic' },
              { value: 'speakers', label: 'Speakers only' },
              { value: 'mic', label: 'Mic only' },
            ],
          },
        ],
        defaults: { sound: '1', where: 'both' },
        run: async (_ctx, p) => {
          const list = /^\d+$/.test(p.sound.trim())
            ? []
            : parseSoundList(await command('GetSoundlistXML()'))
          const sound = findSound(list, p.sound)
          if (!sound) throw new PluginError(`No sound called "${p.sound}" in Soundpad.`)
          const speakers = p.where !== 'mic'
          const mic = p.where !== 'speakers'
          await command(`DoPlaySound(${sound.index}, ${speakers}, ${mic})`)
          return { values: { title: sound.title } }
        },
      }),
      defineBlock({
        id: 'random',
        name: 'Play a random sound',
        description: 'Plays a random sound, from one category if you name it.',
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({ category: z.string().max(100).default('') }),
        fields: [
          { key: 'category', label: 'Category', widget: 'text', placeholder: 'Any category' },
        ],
        defaults: { category: '' },
        run: async (_ctx, p) => {
          await command(
            p.category.trim()
              ? `DoPlayRandomSoundFromCategory(${quote(p.category.trim())}, true, true)`
              : 'DoPlayRandomSound(true, true)',
          )
        },
      }),
      defineBlock({
        id: 'control',
        name: 'Soundpad control',
        description: 'Stops, pauses or replays the sound playing in Soundpad.',
        platforms: ['win32'],
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({ action: z.enum(['stop', 'pause', 'again', 'previous']) }),
        fields: [
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'stop', label: 'Stop' },
              { value: 'pause', label: 'Pause or resume' },
              { value: 'again', label: 'Play the last sound again' },
              { value: 'previous', label: 'Play the previous sound' },
            ],
          },
        ],
        defaults: { action: 'stop' },
        run: async (_ctx, p) => {
          const cmd = {
            stop: 'DoStopSound()',
            pause: 'DoTogglePause()',
            again: 'DoPlayCurrentSoundAgain()',
            previous: 'DoPlayPreviousSound()',
          }[p.action]
          await command(cmd)
        },
      }),
      defineBlock({
        id: 'volume',
        name: 'Soundpad volume',
        description: "Sets Soundpad's volume, 0 to 100. Wire a slider's value into level.",
        platforms: ['win32'],
        inputs: [flowIn, { id: 'level', kind: 'value', type: 'number' }],
        outputs: [flowOut],
        paramsSchema: z.object({ level: z.coerce.number().min(0).max(100) }),
        fields: [{ key: 'level', label: 'Level', widget: 'number', placeholder: '80' }],
        defaults: { level: 80 },
        run: async (_ctx, p) => {
          await command(`SetVolume(${Math.round(p.level)})`)
        },
      }),
    ],
  })
}
