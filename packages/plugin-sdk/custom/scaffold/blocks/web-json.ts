// Reads one field from a JSON web API. Example: a random joke.
import { block } from '../tessel/index.ts'

export default block({
  name: 'Read from a web API',
  description:
    'Fetches JSON from a URL and reads one field by its path, e.g. setup or data.items.0.name.',
  params: {
    url: {
      type: 'text',
      label: 'URL',
      default: 'https://official-joke-api.appspot.com/random_joke',
    },
    path: { type: 'text', label: 'Field', default: 'setup' },
  },
  values: { value: 'any', text: 'string' },
  async run({ params, ctx, std }) {
    const data = await std.http.getJson(params.url, { signal: ctx.signal })
    const value = params.path
      .split('.')
      .filter(Boolean)
      .reduce<unknown>(
        (v, key) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined),
        data,
      )
    return { values: { value, text: value === undefined ? '' : String(value) } }
  },
})
