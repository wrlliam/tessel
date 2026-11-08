import type { PhonePage, PhoneProfile } from '@tessel/core'

/** Where the phone is: an index into the swipeable pages, plus any open folders on top. */
export interface Nav {
  index: number
  folders: string[]
}

export const START: Nav = { index: 0, folders: [] }

export const swipePages = (p: PhoneProfile) => p.pages.filter((pg) => pg.kind === 'page')

export function currentPage(p: PhoneProfile, nav: Nav): PhonePage | undefined {
  const folder = nav.folders.at(-1)
  if (folder) return p.pages.find((pg) => pg.id === folder)
  return swipePages(p)[nav.index]
}

/** Keeps navigation valid after the desktop sends a changed profile. */
export function reconcile(p: PhoneProfile, nav: Nav): Nav {
  const pages = swipePages(p)
  const index = Math.min(nav.index, Math.max(pages.length - 1, 0))
  const folders = nav.folders.filter((id) =>
    p.pages.some((pg) => pg.id === id && pg.kind === 'folder'),
  )
  return index === nav.index && folders.length === nav.folders.length ? nav : { index, folders }
}

export function swipe(p: PhoneProfile, nav: Nav, delta: number): Nav {
  if (nav.folders.length) return nav
  const index = Math.min(Math.max(nav.index + delta, 0), swipePages(p).length - 1)
  return index === nav.index ? nav : { ...nav, index }
}

export const openFolder = (nav: Nav, pageId: string): Nav => ({
  ...nav,
  folders: [...nav.folders, pageId],
})
export const back = (nav: Nav): Nav => ({ ...nav, folders: nav.folders.slice(0, -1) })

/** The desktop asked to show a page (Switch page block). */
export function show(p: PhoneProfile, nav: Nav, pageId: string): Nav {
  const page = p.pages.find((pg) => pg.id === pageId)
  if (!page) return nav
  if (page.kind === 'folder') return { ...nav, folders: [pageId] }
  return { index: swipePages(p).indexOf(page), folders: [] }
}
