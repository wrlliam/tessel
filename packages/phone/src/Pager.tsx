import type { PhoneProfile, PhoneSettings } from '@tessel/core'
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { TileOverride } from './connection.ts'
import { haptic } from './device.ts'
import { back, currentPage, openFolder, swipe, swipePages, type Nav } from './navigation.ts'
import { PageGrid } from './PageGrid.tsx'

/** A tap fires when the finger lifts, or after this long held still, so a swipe never fires a tile. */
const COMMIT_MS = 150
/** Movement before a touch counts as a swipe rather than a tap. */
const SLOP = 10
/** Movement that cancels a tap that hasn't fired yet. */
const CANCEL = 24
const MIN_PRESS_MS = 90

interface Props {
  profile: PhoneProfile
  nav: Nav
  overrides: Record<string, TileOverride>
  disabled: boolean
  settings: PhoneSettings
  onNav: (nav: Nav) => void
  onPress: (tileId: string, phase: 'down' | 'up') => void
}

interface Gesture {
  pointer: number
  x: number
  y: number
  at: number
  tile?: { id: string; kind: string; target?: string }
  committed: boolean
  swiping: boolean
  timer?: ReturnType<typeof setTimeout>
}

function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

export function Pager({ profile, nav, overrides, disabled, settings, onNav, onPress }: Props) {
  const [ref, box] = useBoxSize()
  const gesture = useRef<Gesture | null>(null)
  const pressedAt = useRef(0)
  const [pressed, setPressed] = useState<string>()
  const [drag, setDrag] = useState(0)
  const inFolder = nav.folders.length > 0
  const pages = swipePages(profile)
  const canSwipe = !inFolder && pages.length > 1
  // Portrait keys sit at the bottom, where a thumb reaches; sideways they're centred.
  const align = box.width > box.height ? 'items-center' : 'items-end'

  function release() {
    const wait = Math.max(0, MIN_PRESS_MS - (performance.now() - pressedAt.current))
    setTimeout(() => setPressed(undefined), wait)
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (gesture.current) return
    const el = (e.target as Element).closest<HTMLElement>('[data-tile-id]')
    const data = el?.dataset
    const g: Gesture = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      at: performance.now(),
      committed: false,
      swiping: false,
    }
    if (data?.tileId && !disabled) {
      g.tile = {
        id: data.tileId,
        kind: data.tileKind ?? 'action',
        ...(data.target && { target: data.target }),
      }
      pressedAt.current = performance.now()
      setPressed(data.tileId)
      if (settings.haptics) haptic()
      if (g.tile.kind === 'action') {
        g.timer = setTimeout(() => {
          if (gesture.current === g && g.tile) {
            g.committed = true
            onPress(g.tile.id, 'down')
          }
        }, COMMIT_MS)
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = g
  }

  function dropTile(g: Gesture) {
    clearTimeout(g.timer)
    if (g.tile && g.committed) onPress(g.tile.id, 'up')
    if (g.tile) release()
    delete g.tile
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointer) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.swiping && canSwipe && Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) {
      g.swiping = true
      dropTile(g)
    } else if (!g.swiping && g.tile && !g.committed && Math.hypot(dx, dy) > CANCEL) {
      dropTile(g)
    }
    if (g.swiping) {
      // Resist past the first and last page.
      const atEdge = (dx > 0 && nav.index === 0) || (dx < 0 && nav.index === pages.length - 1)
      setDrag(atEdge ? dx / 3 : dx)
    }
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointer) return
    gesture.current = null
    clearTimeout(g.timer)
    if (g.swiping) {
      const dx = e.clientX - g.x
      const speed = Math.abs(dx) / Math.max(1, performance.now() - g.at)
      if (Math.abs(dx) > box.width * 0.18 || speed > 0.5)
        onNav(swipe(profile, nav, dx < 0 ? 1 : -1))
      setDrag(0)
      return
    }
    const tile = g.tile
    if (!tile) return
    release()
    if (tile.kind === 'back') onNav(back(nav))
    else if (tile.kind === 'folder' && tile.target) onNav(openFolder(nav, tile.target))
    else {
      if (!g.committed) onPress(tile.id, 'down')
      onPress(tile.id, 'up')
    }
  }

  function cancel(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointer) return
    gesture.current = null
    dropTile(g)
    setDrag(0)
  }

  const handlers = {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: cancel,
  }
  const grid = (pageId: string) => {
    const page = profile.pages.find((p) => p.id === pageId)
    return (
      page && (
        <PageGrid
          profile={profile}
          settings={settings}
          page={page}
          width={box.width}
          height={box.height}
          overrides={overrides}
          pressedId={pressed}
          disabled={disabled}
        />
      )
    )
  }

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 touch-none overflow-hidden"
      {...handlers}
      onContextMenu={(e) => e.preventDefault()}
    >
      {inFolder ? (
        <div className={`absolute inset-0 flex justify-center ${align}`}>
          {grid(currentPage(profile, nav)?.id ?? '')}
        </div>
      ) : (
        <div
          className="flex h-full"
          style={{
            width: box.width * pages.length,
            transform: `translateX(${-nav.index * box.width + drag}px)`,
            transition: drag === 0 ? 'transform 300ms var(--ease)' : 'none',
          }}
        >
          {pages.map((p) => (
            <div
              key={p.id}
              className={`flex h-full shrink-0 justify-center ${align}`}
              style={{ width: box.width }}
              aria-hidden={p !== pages[nav.index] || undefined}
            >
              {grid(p.id)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
