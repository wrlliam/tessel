import { PageGrid, type TileOverride } from '@tessel/brand/page-grid'
import { toPhoneProfile, type Appearance, type PhoneSettings, type Profile } from '@tessel/core'
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { cn } from '../lib/cn.ts'

/** A typical phone screen in CSS pixels, without the status bar and home indicator. */
const PHONE = { short: 390, long: 780 }

/**
 * The page as the phone draws it: the same grid code, key style, shape, spacing and theme, in
 * portrait or turned sideways (laid out by Phone settings › Landscape). Clicking a key selects
 * it in the editor.
 */
export function PhonePreview({
  profile,
  pageId,
  live,
  series,
  settings,
  sideways,
  selectedId,
  onSelect,
}: {
  profile: Profile
  pageId: string
  live: Record<string, Appearance>
  series: Record<string, number[]>
  settings: PhoneSettings
  sideways: boolean
  selectedId: string | null
  onSelect: (tileId: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(288)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom(el.clientWidth))
    ro.observe(el)
    setRoom(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const phone = useMemo(() => toPhoneProfile(profile), [profile])
  const page = phone.pages.find((p) => p.id === pageId)
  const overrides = useMemo(() => {
    const out: Record<string, TileOverride> = {}
    for (const [id, look] of Object.entries(live)) out[id] = look
    return out
  }, [live])
  const points = useMemo(() => {
    // The preview only needs values; times are made up evenly.
    const out: Record<string, Array<[number, number]>> = {}
    for (const [id, values] of Object.entries(series))
      out[id] = values.map((v, i) => [i, v] as [number, number])
    return out
  }, [series])
  if (!page) return null

  const width = sideways ? PHONE.long : PHONE.short
  const height = sideways ? PHONE.short : PHONE.long
  const bezel = 10
  // Fits the sidebar's width, and stays short enough to see without scrolling.
  const scale = Math.min(1, (room - bezel * 2) / width, 440 / height)
  const pages = phone.pages.filter((p) => p.kind === 'page')
  const index = pages.findIndex((p) => p.id === page.id)
  const theme = settings.theme === 'system' ? undefined : settings.theme

  const dots = pages.length > 1 && (
    <div className={cn('flex gap-1', sideways && 'flex-col')} aria-hidden>
      {pages.map((p, i) => (
        <span
          key={p.id}
          className={cn(
            'rounded-full',
            sideways ? 'w-1.5' : 'h-1.5',
            i === index ? cn(sideways ? 'h-4' : 'w-4', 'bg-text') : 'size-1.5 bg-line',
          )}
        />
      ))}
    </div>
  )
  const statusDot = <span className="size-2 rounded-full bg-glaze" aria-hidden />

  function pick(e: MouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tile-id]')?.dataset['tileId']
    if (id && id !== '__back') onSelect(id)
  }

  // Keys sit in this box; the rest mirrors the phone's header, rail and footer.
  const gridBox = sideways
    ? { w: width - 16 - 12 - 48, h: height - 16 }
    : {
        w: width - 32,
        h: height - (settings.header ? 56 : 16) - 4 - 12 - (pages.length > 1 ? 40 : 0),
      }

  const grid = (
    <PageGrid
      profile={phone}
      page={page}
      width={gridBox.w}
      height={gridBox.h}
      overrides={overrides}
      series={points}
      pressedId={undefined}
      disabled={false}
      settings={settings}
      dragging={{}}
    />
  )

  return (
    <div ref={box} className="flex w-full justify-center">
      <div
        style={{ width: width * scale + bezel * 2, height: height * scale + bezel * 2 }}
        className="relative rounded-[36px] bg-ink-900 p-[10px] shadow-[0_0_0_1px_var(--line)]"
      >
        <div
          data-theme={theme}
          onClick={pick}
          className="phone-preview overflow-hidden bg-bg text-text"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            borderRadius: 28 / scale,
          }}
        >
          {sideways ? (
            <div className="flex h-full">
              <div className="flex min-w-0 flex-1 items-center justify-center py-2 pl-3">
                {grid}
              </div>
              <aside className="flex w-12 shrink-0 flex-col items-center justify-between py-3">
                <span className="text-muted">⋯</span>
                {dots}
                {statusDot}
              </aside>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {settings.header && (
                <header className="flex h-14 shrink-0 items-center gap-2 px-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] leading-6 font-medium">{page.name}</p>
                    <p className="truncate text-[13px] leading-4 text-muted">{profile.name}</p>
                  </div>
                  {statusDot}
                  <span className="px-2 text-muted">⋯</span>
                </header>
              )}
              <div
                className={cn(
                  'flex min-h-0 flex-1 items-center justify-center px-4 pb-3',
                  settings.header ? 'pt-1' : 'pt-4',
                )}
              >
                {grid}
              </div>
              {pages.length > 1 && (
                <footer className="flex h-10 shrink-0 items-center justify-center">{dots}</footer>
              )}
            </div>
          )}
        </div>
        {selectedId && (
          <style>{`.phone-preview [data-tile-id="${CSS.escape(selectedId)}"] { outline: ${2 / scale}px solid var(--glaze); outline-offset: ${2 / scale}px; }`}</style>
        )}
      </div>
    </div>
  )
}
