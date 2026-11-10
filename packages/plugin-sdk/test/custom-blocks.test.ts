import { describe, expect, it } from 'vitest'
import { block, normalise } from '../custom/index.ts'

const ctx = {} as never

describe('custom block results', () => {
  it('takes values returned by name, with or without next', () => {
    expect(normalise('B', { days: 3, words: 'x' }, ['out'], ['days', 'words'])).toEqual({
      values: { days: 3, words: 'x' },
    })
    expect(normalise('B', { next: 'no', days: 1 }, ['yes', 'no'], ['days'])).toEqual({
      next: 'no',
      values: { days: 1 },
    })
  })

  it('still takes the long form', () => {
    expect(normalise('B', { next: 'yes', values: { a: 1 } }, ['yes'], ['a'])).toEqual({
      next: 'yes',
      values: { a: 1 },
    })
    expect(normalise('B', { next: 'yes' }, ['yes'], [])).toEqual({ next: 'yes' })
  })

  it('says which names are wrong', () => {
    expect(() => normalise('B', { dayz: 1 }, ['out'], ['days'])).toThrow(
      /returned dayz, which isn't a value it declares.*\(it has days\)/,
    )
    expect(() => normalise('B', { next: 'maybe' }, ['yes', 'no'], [])).toThrow(
      /outputs are yes, no/,
    )
  })

  it('runs a block that hands on several values', async () => {
    const b = block({
      name: 'Split',
      params: { text: { type: 'text', default: 'a b' } },
      values: { first: 'string', rest: 'string', count: 'number' },
      run({ params }) {
        const [first = '', ...rest] = params.text.split(' ')
        return { first, rest: rest.join(' '), count: rest.length + 1 }
      },
    })
    expect(await b.run(ctx, { text: 'one two three' }, {})).toEqual({
      values: { first: 'one', rest: 'two three', count: 3 },
    })
  })

  it("won't use next or values as value names", () => {
    expect(() => block({ name: 'X', values: { next: 'string' }, run: () => undefined })).toThrow(
      /can't be a value name/,
    )
  })
})

describe('std, imported or from run()', () => {
  it('runs Tessel blocks from the imported std too, for the block that is running', async () => {
    const { std } = await import('../custom/index.ts')
    // The repo's generated.ts is empty; a My blocks folder has every block typed.
    const blocks = std.blocks as unknown as Record<string, () => Promise<{ cpu?: number }>> & {
      google: { search(): Promise<unknown> }
    }
    const calls: string[] = []
    const runCtx = {
      tileId: 'tile-1',
      runBlock: async (type: string) => {
        calls.push(type)
        return { values: { cpu: 12 } }
      },
    } as never
    const b = block({
      name: 'Imported',
      values: { cpu: 'number' },
      async run() {
        // Not taken from run({ std }): the module's own std.
        const { cpu } = await blocks.systemStats!()
        await new Promise((r) => setTimeout(r, 1))
        await blocks.google.search()
        return { cpu: cpu ?? 0 }
      },
    })
    expect(await b.run(runCtx, {}, {})).toEqual({ values: { cpu: 12 } })
    expect(calls).toEqual(['@systemStats', '@google.search'])
    expect(std.math.clamp(5, 0, 3)).toBe(3)
  })

  it('says so when std.blocks is used outside a run', async () => {
    const { std } = await import('../custom/index.ts')
    const blocks = std.blocks as unknown as Record<string, () => Promise<unknown>>
    await expect(blocks.getTime!()).rejects.toThrow(/only work inside a block’s run\(\)/)
  })
})
