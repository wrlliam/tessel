import { TileIcon } from '@tessel/brand/icons'
import type { Appearance } from '@tessel/core'

export function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) > 150 ? '#0E1116' : '#F4F6F8'
}

/** Icon and label as the phone shows them, at editor scale. */
export function TileFace({
  look,
  size,
  folder,
}: {
  look: Appearance
  size: number
  folder?: boolean
}) {
  return (
    <>
      <TileIcon icon={look.icon || (folder ? 'folder' : '')} size={Math.round(size * 0.3)} />
      <span className="line-clamp-2 [overflow-wrap:anywhere]">{look.label || 'Untitled'}</span>
    </>
  )
}
