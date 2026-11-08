import { createHarness } from '@tessel/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import { buildPrompt, createOllamaPlugin } from '../src/plugin.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('ollama plugin', () => {
  it('adds wired-in text below the prompt', () => {
    expect(buildPrompt('Explain:', ' some code ')).toBe('Explain:\n\nsome code')
    expect(buildPrompt('Hi', undefined)).toBe('Hi')
  })

  it('asks the model from settings and returns the answer', async () => {
    const fetchFn = vi.fn(async () => json({ response: ' It adds two numbers. ' }))
    const h = createHarness(createOllamaPlugin(fetchFn), {
      settings: { host: 'http://box:11434/', model: 'qwen3' },
    })
    await h.load()
    const r = await h.run('ask', { prompt: 'Explain:', model: '', system: '' }, { text: 'a+b' })
    expect(r).toEqual({ values: { answer: 'It adds two numbers.' } })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://box:11434/api/generate')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'qwen3',
      prompt: 'Explain:\n\na+b',
      stream: false,
    })
  })

  it('explains a missing model and an unreachable Ollama', async () => {
    const missing = createHarness(
      createOllamaPlugin(async () => json({ error: 'model "x" not found' }, 404)),
    )
    await expect(missing.run('ask', { prompt: 'Hi', model: 'x', system: '' })).rejects.toThrow(
      /ollama pull/,
    )
    const down = createHarness(
      createOllamaPlugin(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(down.run('ask', { prompt: 'Hi', model: '', system: '' })).rejects.toThrow(
      /Start Ollama/,
    )
  })

  it('lists installed models', async () => {
    const h = createHarness(
      createOllamaPlugin(async () => json({ models: [{ name: 'a' }, { name: 'b' }] })),
    )
    expect(await h.run('models', {})).toEqual({ values: { models: 'a, b', count: 2 } })
  })
})
