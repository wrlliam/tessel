import type { DesktopState } from '../../shared/api.ts'
import { ActivityLog } from './ActivityLog.tsx'
import { ConnectPanel } from './ConnectPanel.tsx'
import { DevicesPanel } from './DevicesPanel.tsx'
import { PhoneSettingsCard } from './PhoneSettingsCard.tsx'

export function PhonesView({ state }: { state: DesktopState }) {
  return (
    <>
      {state.serverError && (
        <p
          role="alert"
          className="mx-6 mt-4 rounded-lg border border-signal/50 px-4 py-2 text-sm text-signal"
        >
          {state.serverError}
        </p>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-6">
          <div className="space-y-6">
            <ConnectPanel state={state} />
            <DevicesPanel state={state} />
          </div>
          <PhoneSettingsCard settings={state.phoneSettings} location={state.location} />
        </div>
      </main>
      <ActivityLog entries={state.log} />
    </>
  )
}
