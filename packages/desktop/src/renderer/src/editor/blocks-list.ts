import type { BlockDescriptor, Category } from '@tessel/core'
import { CATEGORY_ORDER } from './theme.ts'

export function groupBlocks(
  blocks: Iterable<BlockDescriptor>,
): Array<[Category, BlockDescriptor[]]> {
  const all = [...blocks]
  return CATEGORY_ORDER.map((c): [Category, BlockDescriptor[]] => [
    c,
    all.filter((b) => b.category === c),
  ]).filter(([, list]) => list.length > 0)
}

export const BLOCK_MIME = 'application/x-tessel-block'
