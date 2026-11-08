import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

export const SEARCH_URLS = {
  web: 'https://www.google.com/search?q=',
  images: 'https://www.google.com/search?tbm=isch&q=',
  maps: 'https://www.google.com/maps/search/',
  news: 'https://news.google.com/search?q=',
  youtube: 'https://www.youtube.com/results?search_query=',
  translate: 'https://translate.google.com/?op=translate&text=',
} as const

export function searchUrl(where: keyof typeof SEARCH_URLS, query: string): string {
  return SEARCH_URLS[where] + encodeURIComponent(query.trim())
}

const joined = (a: string, b: unknown) =>
  [a.trim(), b === undefined || b === null ? '' : String(b).trim()].filter(Boolean).join(' ')

export function createGooglePlugin(fetchFn: Fetch) {
  let apiKey = ''
  let defaultModel = 'gemini-2.5-flash'
  const apply = (s: Record<string, unknown>) => {
    apiKey = String(s['apiKey'] ?? '')
    defaultModel = String(s['model'] || defaultModel)
  }

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'search',
        name: 'Google search link',
        description:
          'Makes a search link for Google, Images, Maps, News, YouTube or Translate. Wire "url" into Open URL. Text wired into "text" is searched too.',
        inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
        outputs: [flowOut, { id: 'url', kind: 'value', type: 'string' }],
        paramsSchema: z.object({
          where: z.enum(['web', 'images', 'maps', 'news', 'youtube', 'translate']).default('web'),
          query: z.string().max(500).default(''),
        }),
        fields: [
          {
            key: 'where',
            label: 'Search',
            widget: 'select',
            options: [
              { value: 'web', label: 'Google' },
              { value: 'images', label: 'Images' },
              { value: 'maps', label: 'Maps' },
              { value: 'news', label: 'News' },
              { value: 'youtube', label: 'YouTube' },
              { value: 'translate', label: 'Translate' },
            ],
          },
          { key: 'query', label: 'For', widget: 'text', placeholder: 'Leave empty to use "text"' },
        ],
        defaults: { where: 'web', query: '' },
        run: (_ctx, p, input) => {
          const query = joined(p.query, input['text'])
          if (!query)
            throw new PluginError('Nothing to search for. Type something or wire in text.')
          return { values: { url: searchUrl(p.where, query) } }
        },
      }),
      defineBlock({
        id: 'gemini',
        name: 'Ask Gemini',
        description:
          'Asks Google\'s Gemini and gives back the answer. Needs an API key in the plugin settings. Text wired into "text" is added below the prompt.',
        inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
        outputs: [flowOut, { id: 'answer', kind: 'value', type: 'string' }],
        paramsSchema: z.object({
          prompt: z.string().min(1, 'Write a prompt').max(4000),
          model: z.string().max(100).default(''),
        }),
        fields: [
          { key: 'prompt', label: 'Prompt', widget: 'textarea', placeholder: 'Summarise this:' },
          { key: 'model', label: 'Model', widget: 'text', placeholder: 'Plugin setting' },
        ],
        defaults: { prompt: '', model: '' },
        timeoutSeconds: 120,
        run: async (ctx, p, input) => {
          if (!apiKey)
            throw new PluginError('Add a Gemini API key in Plugins › Google › Settings first.')
          const extra = input['text'] === undefined ? '' : String(input['text']).trim()
          const prompt = extra ? `${p.prompt.trim()}\n\n${extra}` : p.prompt.trim()
          const model = encodeURIComponent(p.model || defaultModel)
          let res: Response
          try {
            res = await fetchFn(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: ctx.signal,
              },
            )
          } catch (err) {
            if (ctx.signal.aborted) throw err
            throw new PluginError("Can't reach Google. Check the internet connection.")
          }
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string }
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
          }
          if (!res.ok)
            throw new PluginError(
              res.status === 400 || res.status === 403
                ? `Gemini refused: ${body.error?.message ?? 'check the API key'}`
                : `Gemini answered ${res.status}: ${body.error?.message ?? ''}`.trim(),
            )
          const answer = (body.candidates?.[0]?.content?.parts ?? [])
            .map((part) => part.text ?? '')
            .join('')
            .trim()
          return { values: { answer } }
        },
      }),
    ],
  })
}
