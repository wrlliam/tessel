import type { Page, Profile } from '@tessel/core'

export interface Cell {
  col: number
  row: number
}

const key = (c: number, r: number) => `${c},${r}`

/** Cells in use. Folder pages keep the top-left cell for the phone's Back tile. */
export function occupied(page: Page, exceptTileId?: string): Set<string> {
  const taken = new Set<string>(page.kind === 'folder' ? [key(0, 0)] : [])
  for (const t of page.tiles) {
    if (t.id === exceptTileId) continue
    for (let c = t.position.col; c < t.position.col + t.span.w; c++) {
      for (let r = t.position.row; r < t.position.row + t.span.h; r++) taken.add(key(c, r))
    }
  }
  return taken
}

export function fits(
  page: Page,
  at: Cell,
  span: { w: number; h: number },
  exceptTileId?: string,
): boolean {
  if (at.col < 0 || at.row < 0 || span.w < 1 || span.h < 1) return false
  if (at.col + span.w > page.cols || at.row + span.h > page.rows) return false
  const taken = occupied(page, exceptTileId)
  for (let c = at.col; c < at.col + span.w; c++) {
    for (let r = at.row; r < at.row + span.h; r++) if (taken.has(key(c, r))) return false
  }
  return true
}

export function freeCells(page: Page): Cell[] {
  const taken = occupied(page)
  const out: Cell[] = []
  for (let row = 0; row < page.rows; row++) {
    for (let col = 0; col < page.cols; col++) if (!taken.has(key(col, row))) out.push({ col, row })
  }
  return out
}

/** Folder pages opened from tiles on this page, and from folders inside those, and so on. */
export function foldersUnder(profile: Profile, pageId: string): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    const page = profile.pages.find((p) => p.id === id)
    for (const t of page?.tiles ?? []) {
      if (t.kind === 'folder' && t.targetPageId && !out.includes(t.targetPageId)) {
        out.push(t.targetPageId)
        visit(t.targetPageId)
      }
    }
  }
  visit(pageId)
  return out
}

/** The page holding the folder tile that opens this folder page. */
export const parentOf = (profile: Profile, folderPageId: string) =>
  profile.pages.find((p) =>
    p.tiles.some((t) => t.kind === 'folder' && t.targetPageId === folderPageId),
  )
