import { defineBlock, definePlugin, PluginError, type OS } from '@tessel/plugin-sdk'
import { z } from 'zod'
import { listScript, useScript } from './windows.ts'

/** Runs a program and returns what it printed. */
export type Run = (cmd: string, args: string[]) => Promise<string>

export interface Output {
  name: string
  /** Windows device id; macOS uses the name. */
  id: string
  current: boolean
}

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

/** "*Speakers\\t{id}" lines from the Windows helper. */
export function parseWindows(text: string): Output[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [name = '', id = ''] = l.slice(1).split('\t')
      return { name: name.trim(), id: id.trim(), current: l.startsWith('*') }
    })
}

export function pick(outputs: Output[], wanted: string): Output | undefined {
  const w = wanted.trim().toLowerCase()
  return (
    outputs.find((o) => o.name.toLowerCase() === w) ??
    outputs.find((o) => o.name.toLowerCase().includes(w))
  )
}

export function createAudioOutputPlugin(run: Run, os: () => OS) {
  const ps = (script: string) =>
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])

  async function list(): Promise<Output[]> {
    if (os() === 'win32') return parseWindows(await ps(listScript))
    if (os() === 'darwin') {
      try {
        const all = await run('SwitchAudioSource', ['-a', '-t', 'output'])
        const current = (await run('SwitchAudioSource', ['-c', '-t', 'output'])).trim()
        return all
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((name) => ({ name, id: name, current: name === current }))
      } catch (err) {
        if (/ENOENT|not found/i.test((err as Error).message))
          throw new PluginError('Install SwitchAudioSource first: brew install switchaudio-osx')
        throw err
      }
    }
    throw new PluginError('Switching outputs works on Windows and macOS.')
  }
  async function use(o: Output) {
    if (os() === 'win32') await ps(useScript(o.id))
    else await run('SwitchAudioSource', ['-s', o.name, '-t', 'output'])
  }

  return definePlugin({
    blocks: [
      defineBlock({
        id: 'use',
        name: 'Use sound output',
        description:
          'Sends sound to an output, by part of its name, e.g. Headphones or Speakers. With a second name it switches between the two.',
        platforms: ['darwin', 'win32'],
        inputs: [flowIn],
        outputs: [flowOut, { id: 'name', kind: 'value', type: 'string' }],
        paramsSchema: z.object({
          output: z.string().min(1, 'Type part of the output’s name').max(120),
          other: z.string().max(120).default(''),
        }),
        fields: [
          { key: 'output', label: 'Output', widget: 'text', placeholder: 'Headphones' },
          {
            key: 'other',
            label: 'Or switch with',
            widget: 'text',
            placeholder: 'Speakers (optional)',
          },
        ],
        defaults: { output: 'Headphones', other: '' },
        run: async (ctx, p) => {
          const outputs = await list()
          const a = pick(outputs, p.output)
          if (!a)
            throw new PluginError(
              `No output matches "${p.output}". Outputs: ${outputs.map((o) => o.name).join(', ')}`,
            )
          let target = a
          if (p.other.trim() && a.current) {
            const b = pick(outputs, p.other)
            if (!b) throw new PluginError(`No output matches "${p.other}".`)
            target = b
          }
          await use(target)
          ctx.setTileState('output', target.name)
          return { values: { name: target.name } }
        },
      }),
      defineBlock({
        id: 'current',
        name: 'Sound output now',
        description: 'Which output sound goes to, and the list of all of them.',
        platforms: ['darwin', 'win32'],
        inputs: [flowIn],
        outputs: [
          flowOut,
          { id: 'name', kind: 'value', type: 'string' },
          { id: 'all', kind: 'value', type: 'string' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => {
          const outputs = await list()
          const now = outputs.find((o) => o.current)?.name ?? ''
          ctx.setTileState('output', now)
          return { values: { name: now, all: outputs.map((o) => o.name).join('\n') } }
        },
      }),
    ],
  })
}
