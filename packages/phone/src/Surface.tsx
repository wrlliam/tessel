import { ChevronLeft, Ellipsis } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Connection, wsUrl } from './connection.ts'
import { guessDeviceName, keepAwake, watchLocation } from './device.ts'
import { HistoryView } from './HistoryView.tsx'
import { HomeScreenHint } from './HomeScreenHint.tsx'
import { StatusScreen } from './StatusScreen.tsx'
import { back, currentPage, reconcile, show, START, swipePages, type Nav } from './navigation.ts'
import { EditSheet } from './EditSheet.tsx'
import { Pager } from './Pager.tsx'
import { loadDim, PhoneMenu } from './PhoneMenu.tsx'
import { applyTheme } from './theme.ts'

interface Props {
  token: string
  onUnpaired: (reason?: string) => void
}

export function Surface({ token, onUnpaired }: Props) {
  const [connection] = useState(() => new Connection(token, guessDeviceName(), wsUrl(location)))
  const state = useSyncExternalStore(connection.subscribe, connection.getState)
  const [rawNav, setNav] = useState<Nav>(START)
  const [seenRequest, setSeenRequest] = useState(0)
  const [dim, setDim] = useState(loadDim)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTile, setEditTile] = useState<string>()
  const [swapFrom, setSwapFrom] = useState<string>()
  const [historyOf, setHistoryOf] = useState<string>()
  const { status, profile, overrides, requestedPage, settings, series } = state

  useEffect(() => {
    connection.start()
    return () => connection.stop()
  }, [connection])
  useEffect(() => (settings.keepAwake ? keepAwake() : undefined), [settings.keepAwake])
  const live0 = status.kind === 'live'
  useEffect(
    () =>
      settings.shareLocation && live0
        ? watchLocation((at) => connection.send({ type: 'location', ...at }))
        : undefined,
    [settings.shareLocation, live0, connection],
  )
  const sideways = useSideways()
  useEffect(() => applyTheme(settings.theme), [settings.theme])
  useEffect(() => {
    if (status.kind === 'unpaired') onUnpaired(status.reason)
  }, [status, onUnpaired])

  const nav = profile ? reconcile(profile, rawNav) : rawNav
  // The desktop asked for a page (Switch page block); follow it once per request.
  if (profile && requestedPage && requestedPage.seq !== seenRequest) {
    setSeenRequest(requestedPage.seq)
    setNav(show(profile, nav, requestedPage.pageId))
  }
  const page = profile && currentPage(profile, nav)
  const pageId = page?.id
  useEffect(() => {
    if (pageId) connection.send({ type: 'pageChange', pageId })
  }, [connection, pageId, status.kind])

  if (status.kind === 'mismatch')
    return <StatusScreen title="Update needed" tone="error" detail={status.message} />
  if (!profile || !page) {
    return (
      <StatusScreen
        title="Connecting"
        tone="waiting"
        detail="Keep Tessel open on your computer, on the same Wi-Fi."
      />
    )
  }

  const pages = swipePages(profile)
  const inFolder = nav.folders.length > 0
  const live = status.kind === 'live'
  const menuButton = (
    <button
      type="button"
      aria-label="Menu"
      onClick={() => setMenu(true)}
      className="-mr-2 flex size-11 items-center justify-center text-muted"
    >
      <Ellipsis className="size-5" />
    </button>
  )

  const statusDot = (
    <span
      role="status"
      aria-label={live ? 'Connected' : 'Not connected'}
      className={`size-2 shrink-0 rounded-full ${live ? 'bg-glaze' : 'bg-cat-trigger'}`}
    />
  )
  const backButton = inFolder && (
    <button
      type="button"
      aria-label="Back"
      onClick={() => setNav(back(nav))}
      className="-ml-2 flex size-11 items-center justify-center"
    >
      <ChevronLeft className="size-5" />
    </button>
  )
  const dots = !inFolder && pages.length > 1 && (
    <nav aria-label="Pages" className={`flex gap-1 ${sideways ? 'flex-col' : ''}`}>
      {pages.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-label={`${p.name}, page ${i + 1} of ${pages.length}`}
          aria-current={i === nav.index || undefined}
          onClick={() => setNav({ index: i, folders: [] })}
          className="flex size-6 items-center justify-center"
        >
          <span
            className={`rounded-full transition-[width,height,background-color] duration-300 ${
              i === nav.index
                ? `${sideways ? 'h-4 w-1.5' : 'h-1.5 w-4'} bg-text`
                : 'size-1.5 bg-line'
            }`}
          />
        </button>
      ))}
    </nav>
  )
  const pager = (
    <Pager
      profile={profile}
      nav={nav}
      overrides={overrides}
      series={series}
      disabled={!live}
      settings={settings}
      onNav={setNav}
      onPress={(tileId, phase) => {
        // Charts with nothing to do on a tap open their history instead.
        const tile = profile.pages.flatMap((p) => p.tiles).find((t) => t.id === tileId)
        if (tile?.opensHistory) {
          if (phase === 'up') setHistoryOf(tileId)
          return
        }
        connection.send({ type: 'press', tileId, phase })
      }}
      onSlide={(tileId, value) => connection.send({ type: 'slide', tileId, value })}
      editing={editing}
      onEditTap={(tileId) => {
        if (swapFrom) {
          if (swapFrom !== tileId)
            connection.send({ type: 'editTile', tileId: swapFrom, swapWith: tileId })
          setSwapFrom(undefined)
        } else setEditTile(tileId)
      }}
    />
  )
  const overlays = (
    <>
      {editing && (
        <div className="fixed inset-x-0 top-0 z-20 flex items-center gap-3 bg-surface/95 px-4 pt-[calc(env(safe-area-inset-top)+8px)] pb-2 shadow-[0_1px_0_var(--line)]">
          <p className="flex-1 text-[15px]">
            {swapFrom ? 'Tap the key to swap with' : 'Tap a key to change it'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (swapFrom) setSwapFrom(undefined)
              else setEditing(false)
            }}
            className="h-9 rounded-full bg-text px-4 text-sm font-medium text-bg"
          >
            {swapFrom ? 'Cancel' : 'Done'}
          </button>
        </div>
      )}
      {editTile &&
        (() => {
          const tile = profile.pages.flatMap((p) => p.tiles).find((t) => t.id === editTile)
          if (!tile) return null
          return (
            <EditSheet
              tile={tile}
              look={{ label: tile.label, colour: tile.colour, icon: tile.icon ?? '' }}
              onSave={(edit) => connection.send({ type: 'editTile', tileId: tile.id, ...edit })}
              onSwap={() => setSwapFrom(tile.id)}
              onClose={() => setEditTile(undefined)}
            />
          )
        })()}
      {historyOf &&
        (() => {
          const tile = profile.pages.flatMap((p) => p.tiles).find((t) => t.id === historyOf)
          if (!tile) return null
          return (
            <HistoryView
              tile={tile}
              look={{ label: tile.label, colour: tile.colour, ...overrides[tile.id] }}
              connection={connection}
              onClose={() => setHistoryOf(undefined)}
            />
          )
        })()}
      <HomeScreenHint />
      <PhoneMenu
        open={menu}
        onClose={() => setMenu(false)}
        dim={dim}
        onDim={setDim}
        onForget={() => onUnpaired('This phone forgot the computer. Pair again to reconnect.')}
        {...(settings.allowEdit && live && { onEdit: () => setEditing(true) })}
      />
      {dim && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20 bg-black"
          style={{ opacity: settings.dimLevel / 100 }}
        />
      )}
    </>
  )
  const safe =
    'pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]'

  // Sideways, every pixel of height goes to the keys: the page name, status and page dots move
  // into a narrow rail on the right.
  if (sideways) {
    return (
      <main className={`flex h-full ${safe}`}>
        <div className="flex min-w-0 flex-1 flex-col py-2 pl-3">{pager}</div>
        <aside
          aria-label={page.name}
          className="flex w-12 shrink-0 flex-col items-center justify-between py-2"
        >
          <div className="flex flex-col items-center">
            {menuButton}
            {inFolder && (
              <button
                type="button"
                aria-label="Back"
                onClick={() => setNav(back(nav))}
                className="flex size-11 items-center justify-center"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
          </div>
          {dots}
          <div className="flex h-11 items-center">{statusDot}</div>
        </aside>
        {overlays}
      </main>
    )
  }

  return (
    <main className={`flex h-full flex-col ${safe}`}>
      {settings.header && (
        <header className="flex h-14 shrink-0 items-center gap-2 px-4">
          {backButton}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] leading-6 font-medium">{page.name}</h1>
            <p
              className={`truncate text-[13px] leading-4 ${live ? 'text-muted' : 'text-cat-trigger'}`}
            >
              {live
                ? profile.name
                : status.kind === 'connecting' && status.attempt > 0
                  ? 'Reconnecting…'
                  : 'Connecting…'}
            </p>
          </div>
          {statusDot}
          {menuButton}
        </header>
      )}
      <div
        className={`flex min-h-0 flex-1 flex-col px-4 ${settings.header ? 'pt-1' : 'pt-4'} pb-3`}
      >
        {pager}
      </div>
      {(pages.length > 1 || !settings.header) && (
        <footer className="relative flex h-10 shrink-0 items-center justify-center px-4">
          {dots}
          {!settings.header && <div className="absolute right-4">{menuButton}</div>}
        </footer>
      )}
      {overlays}
    </main>
  )
}

/** True while the screen is wider than tall. */
function useSideways(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('resize', onChange)
      return () => window.removeEventListener('resize', onChange)
    },
    () => window.innerWidth > window.innerHeight,
  )
}
