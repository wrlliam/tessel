import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Connection, wsUrl } from './connection.ts'
import { guessDeviceName, keepAwake } from './device.ts'
import { HomeScreenHint } from './HomeScreenHint.tsx'
import { Wordmark } from './Logo.tsx'
import { currentPage, reconcile, show, START, swipePages, type Nav } from './navigation.ts'
import { Pager } from './Pager.tsx'
import { loadDim, PhoneMenu } from './PhoneMenu.tsx'

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

  useEffect(() => {
    connection.start()
    const release = keepAwake()
    return () => {
      release()
      connection.stop()
    }
  }, [connection])

  const { status, profile, overrides, requestedPage } = state
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

  if (status.kind === 'mismatch') return <Message title="Update needed">{status.message}</Message>
  if (!profile || !page) {
    return (
      <Message title="Connecting to your computer">
        Keep Tessel open on your computer, on the same Wi-Fi.
      </Message>
    )
  }

  const pages = swipePages(profile)
  return (
    <main className="flex h-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      {status.kind === 'connecting' && (
        <div
          role="status"
          className="mx-3 mt-2 rounded-xl bg-surface px-4 py-2 text-center text-sm text-muted"
        >
          {status.attempt === 0 ? 'Connecting…' : 'Lost the computer. Reconnecting…'}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <Pager
          profile={profile}
          nav={nav}
          overrides={overrides}
          disabled={status.kind !== 'live'}
          onNav={setNav}
          onPress={(tileId, phase) => connection.send({ type: 'press', tileId, phase })}
        />
      </div>
      <footer className="flex h-12 items-center px-3">
        <div className="flex-1" />
        {nav.folders.length > 0 ? (
          <p className="text-sm text-muted">{page.name}</p>
        ) : (
          pages.length > 1 && (
            <nav aria-label="Pages" className="flex gap-1">
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
                    className={`size-2 rounded-full ${i === nav.index ? 'bg-text' : 'bg-line'}`}
                  />
                </button>
              ))}
            </nav>
          )
        )}
        <div className="flex flex-1 justify-end">
          <PhoneMenu
            dim={dim}
            onDim={setDim}
            onForget={() => onUnpaired('This phone forgot the computer. Pair again to reconnect.')}
          />
        </div>
      </footer>
      <HomeScreenHint />
      {dim && <div aria-hidden className="pointer-events-none fixed inset-0 z-20 bg-black/60" />}
    </main>
  )
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex h-full flex-col justify-center gap-6 px-6">
      <Wordmark />
      <div className="space-y-2">
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="text-muted">{children}</p>
      </div>
    </main>
  )
}
