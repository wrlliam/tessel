import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { builtinBlocks, describeBlock } from '../src/index.ts'

describe('built-in blocks', () => {
  it.each(builtinBlocks.map((b) => [b.id, b] as const))(
    '%s has a field for every param and JSON-safe descriptor',
    (_, block) => {
      const shape = (block.paramsSchema as z.ZodObject).shape
      const params = Object.keys(shape)
      expect((block.fields ?? []).map((f) => f.key).sort()).toEqual(params.sort())
      expect(Object.keys(block.defaults ?? {}).sort()).toEqual(params.sort())
      const descriptor = describeBlock(block)
      expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor)
      expect(descriptor).not.toHaveProperty('run')
    },
  )

  it('has unique ids', () => {
    expect(new Set(builtinBlocks.map((b) => b.id)).size).toBe(builtinBlocks.length)
  })
})
