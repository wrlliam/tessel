import type { DesktopState } from '../../shared/api.ts'
import { ActivityLog } from './ActivityLog.tsx'
import { ConnectPanel } from './ConnectPanel.tsx'
import { DevicesPanel } from './DevicesPanel.tsx'

export function PhonesView({ state }: { state: DesktopState }) {
  return (
    <>
      {state.serverError && (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-lg border border-signal/50 px-4 py-2 text-sm text-signal"
        >
          {state.serverError}
        </p>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 overflow-auto p-4">
        <ConnectPanel state={state} />
        <DevicesPanel state={state} />
      </main>
      <ActivityLog entries={state.log} />
    </>
  )
}
