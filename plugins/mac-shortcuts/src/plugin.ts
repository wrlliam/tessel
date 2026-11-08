import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

/** Runs the shortcuts command line tool; input and output go through files. */
export type RunShortcuts = (args: string[]) => Promise<string>
export interface Files {
  temp(): Promise<{
    input: string
    output: string
    read(): Promise<string>
    write(text: string): Promise<void>
    done(): Promise<void>
  }>
}

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

export function createShortcutsPlugin(run: RunShortcuts, files: Files) {
  return definePlugin({
    blocks: [
      defineBlock({
        id: 'run',
        name: 'Run a shortcut',
        description:
          'Runs a shortcut from the Shortcuts app by its name. Text wired into "input" is passed to it; what it outputs comes back.',
        platforms: ['darwin'],
        inputs: [flowIn, { id: 'input', kind: 'value', type: 'string' }],
        outputs: [flowOut, { id: 'output', kind: 'value', type: 'string' }],
        paramsSchema: z.object({ name: z.string().min(1, 'Type the shortcut’s name').max(200) }),
        fields: [{ key: 'name', label: 'Shortcut', widget: 'text', placeholder: 'Start my day' }],
        defaults: { name: '' },
        timeoutSeconds: 120,
        run: async (_ctx, p, input) => {
          const t = await files.temp()
          try {
            const text =
              input['input'] === undefined || input['input'] === null ? '' : String(input['input'])
            const args = ['run', p.name, '--output-path', t.output]
            if (text) {
              await t.write(text)
              args.push('--input-path', t.input)
            }
            try {
              await run(args)
            } catch (err) {
              const m = (err as Error).message
              throw new PluginError(
                /couldn.t find|not found|no shortcut/i.test(m)
                  ? `There's no shortcut called "${p.name}" in the Shortcuts app.`
                  : `The shortcut stopped: ${m.split('\n')[0]}`,
              )
            }
            return { values: { output: (await t.read()).trim() } }
          } finally {
            await t.done()
          }
        },
      }),
      defineBlock({
        id: 'list',
        name: 'List shortcuts',
        description: 'The names of your shortcuts, one per line.',
        platforms: ['darwin'],
        inputs: [flowIn],
        outputs: [
          flowOut,
          { id: 'names', kind: 'value', type: 'string' },
          { id: 'count', kind: 'value', type: 'number' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async () => {
          const names = (await run(['list']))
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
          return { values: { names: names.join('\n'), count: names.length } }
        },
      }),
    ],
  })
}
