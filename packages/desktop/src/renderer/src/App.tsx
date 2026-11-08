import logoUrl from '@tessel/brand/logo-mark.svg'
import type { DesktopState } from '../../shared/api.ts'
import { ActivityLog } from './ActivityLog.tsx'
import { ConnectPanel } from './ConnectPanel.tsx'
import { DevicesPanel } from './DevicesPanel.tsx'
import { Switch } from './Switch.tsx'
import { useDesktopState } from './useDesktopState.ts'

export function App() {
  const state = useDesktopState()
  if (!state) return null

  return (
    <div className="flex h-full flex-col">
      <header
        className={`drag flex items-center gap-4 border-b border-line px-6 py-3 ${state.platform === 'darwin' ? 'pl-24' : ''}`}
      >
        <img src={logoUrl} alt="" className="size-6" />
        <h1 className="font-display text-lg font-semibold tracking-tight">Tessel</h1>
        <span className="text-sm text-muted">Tap. Build. Done.</span>
        <div className="ml-auto flex items-center gap-6">
          <Switch
            label="Pause tiles"
            checked={state.paused}
            onChange={(on) => void window.tessel.setPaused(on)}
          />
          <Switch
            label="Allow phones"
            checked={state.allowPhones}
            onChange={(on) => void window.tessel.setAllowPhones(on)}
          />
        </div>
      </header>

      <StatusBar state={state} />

      <main className="grid min-h-0 flex-1 items-start grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 overflow-auto p-4">
        <ConnectPanel state={state} />
        <DevicesPanel state={state} />
      </main>

      <ActivityLog entries={state.log} />
    </div>
  )
}

function StatusBar({ state }: { state: DesktopState }) {
  const online = state.devices.filter((d) => d.online).length
  let dot = 'bg-muted'
  let text = 'Phones off. Turn on Allow phones to connect one.'
  if (state.serverError) {
    dot = 'bg-signal'
    text = state.serverError
  } else if (state.listening) {
    dot = online > 0 ? 'bg-glaze' : 'bg-cat-trigger'
    text =
      online > 0
        ? `${online} ${online === 1 ? 'phone' : 'phones'} connected`
        : `Sharing on port ${state.port}. Waiting for a phone.`
  }
  return (
    <div role="status" className="flex items-center gap-2 px-6 py-2 text-sm text-muted">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      <span className={state.serverError ? 'text-signal' : ''}>{text}</span>
    </div>
  )
}
