import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Connection, wsUrl } from './connection.ts'
import { guessDeviceName, keepAwake } from './device.ts'
import { Grid } from './Grid.tsx'
import { HomeScreenHint } from './HomeScreenHint.tsx'
import { Wordmark } from './Logo.tsx'

interface Props {
  token: string
  onUnpaired: (reason?: string) => void
}

export function Surface({ token, onUnpaired }: Props) {
  const [connection] = useState(() => new Connection(token, guessDeviceName(), wsUrl(location)))
  const state = useSyncExternalStore(connection.subscribe, connection.getState)

  useEffect(() => {
    connection.start()
    const release = keepAwake()
    return () => {
      release()
      connection.stop()
    }
  }, [connection])

  const { status, profile, overrides } = state
  useEffect(() => {
    if (status.kind === 'unpaired') onUnpaired(status.reason)
  }, [status, onUnpaired])

  if (status.kind === 'mismatch') {
    return <Message title="Update needed">{status.message}</Message>
  }

  const page = profile?.pages[0]
  if (!page) {
    return (
      <Message title="Connecting to your computer">
        Keep Tessel open on your computer, on the same Wi-Fi.
      </Message>
    )
  }

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
      <Grid
        page={page}
        overrides={overrides}
        disabled={status.kind !== 'live'}
        onPress={(tileId, phase) => connection.send({ type: 'press', tileId, phase })}
      />
      <HomeScreenHint />
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
