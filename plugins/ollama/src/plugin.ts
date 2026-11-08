import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

/** The prompt, with the wired-in text added below it when there is some. */
export function buildPrompt(prompt: string, text: unknown): string {
  const extra = text === undefined || text === null ? '' : String(text).trim()
  return extra ? `${prompt.trim()}\n\n${extra}` : prompt.trim()
}

export function createOllamaPlugin(fetchFn: Fetch) {
  let host = 'http://127.0.0.1:11434'
  let defaultModel = 'llama3.2'
  const apply = (s: Record<string, unknown>) => {
    host = String(s['host'] || host).replace(/\/+$/, '')
    defaultModel = String(s['model'] || defaultModel)
  }

  async function call(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Response
    try {
      res = await fetchFn(`${host}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        ...(signal && { signal }),
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new PluginError(
        `Can't reach Ollama at ${host}. Start Ollama, or check the address in the plugin settings.`,
      )
    }
    const text = await res.text()
    if (!res.ok) {
      const message = (() => {
        try {
          return String((JSON.parse(text) as { error?: string }).error ?? text)
        } catch {
          return text
        }
      })()
      if (res.status === 404 && /model/i.test(message))
        throw new PluginError(`${message}. Install it with: ollama pull <model>`)
      throw new PluginError(`Ollama answered ${res.status}: ${message.slice(0, 200)}`)
    }
    return JSON.parse(text) as unknown
  }

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'ask',
        name: 'Ask Ollama',
        description:
          'Sends a prompt to a local model and gives back its answer. Text wired into "text" is added below the prompt, e.g. from Get clipboard.',
        inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
        outputs: [flowOut, { id: 'answer', kind: 'value', type: 'string' }],
        paramsSchema: z.object({
          prompt: z.string().min(1, 'Write a prompt').max(4000),
          model: z.string().max(100).default(''),
          system: z.string().max(2000).default(''),
        }),
        fields: [
          {
            key: 'prompt',
            label: 'Prompt',
            widget: 'textarea',
            placeholder: 'Explain this simply:',
          },
          {
            key: 'model',
            label: 'Model',
            widget: 'text',
            placeholder: 'Plugin setting (llama3.2)',
          },
          {
            key: 'system',
            label: 'Instructions',
            widget: 'textarea',
            placeholder: 'Answer in one short paragraph.',
          },
        ],
        defaults: { prompt: '', model: '', system: '' },
        timeoutSeconds: 300,
        run: async (ctx, p, input) => {
          const prompt = buildPrompt(p.prompt, input['text'])
          const result = (await call(
            '/api/generate',
            {
              model: p.model || defaultModel,
              prompt,
              stream: false,
              ...(p.system && { system: p.system }),
            },
            ctx.signal,
          )) as { response?: string }
          return { values: { answer: (result.response ?? '').trim() } }
        },
      }),
      defineBlock({
        id: 'models',
        name: 'Ollama models',
        description: 'Lists the models installed in Ollama, separated by commas.',
        inputs: [flowIn],
        outputs: [
          flowOut,
          { id: 'models', kind: 'value', type: 'string' },
          { id: 'count', kind: 'value', type: 'number' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => {
          const result = (await call('/api/tags', undefined, ctx.signal)) as {
            models?: Array<{ name: string }>
          }
          const names = (result.models ?? []).map((m) => m.name)
          return { values: { models: names.join(', '), count: names.length } }
        },
      }),
    ],
  })
}
