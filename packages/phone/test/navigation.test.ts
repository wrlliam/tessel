import type { PhoneProfile } from '@tessel/core'
import { describe, expect, it } from 'vitest'
import { back, currentPage, openFolder, reconcile, show, START, swipe } from '../src/navigation.ts'

const page = (id: string, kind: 'page' | 'folder' = 'page') => ({
  id,
  name: id,
  kind,
  cols: 3,
  rows: 5,
  tiles: [],
})
const profile: PhoneProfile = {
  id: 'p',
  name: 'P',
  pages: [page('a'), page('f', 'folder'), page('b'), page('c')],
}

describe('navigation', () => {
  it('swipes through ordinary pages only, stopping at the ends', () => {
    let nav = swipe(profile, START, 1)
    expect(currentPage(profile, nav)?.id).toBe('b')
    nav = swipe(profile, nav, 1)
    expect(currentPage(profile, nav)?.id).toBe('c')
    expect(swipe(profile, nav, 1)).toBe(nav)
    expect(swipe(profile, START, -1)).toBe(START)
  })

  it('opens folders on top and goes back', () => {
    const inFolder = openFolder(START, 'f')
    expect(currentPage(profile, inFolder)?.id).toBe('f')
    expect(swipe(profile, inFolder, 1)).toBe(inFolder)
    expect(currentPage(profile, back(inFolder))?.id).toBe('a')
  })

  it('stays valid when pages disappear', () => {
    const smaller: PhoneProfile = { ...profile, pages: [page('a')] }
    expect(reconcile(smaller, { index: 2, folders: ['f'] })).toEqual({ index: 0, folders: [] })
    const nav = { index: 0, folders: [] }
    expect(reconcile(profile, nav)).toBe(nav)
  })

  it('shows a page the desktop asks for', () => {
    expect(show(profile, START, 'c')).toEqual({ index: 2, folders: [] })
    expect(show(profile, START, 'f')).toEqual({ index: 0, folders: ['f'] })
    expect(show(profile, START, 'missing')).toBe(START)
  })
})
