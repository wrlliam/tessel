import { useState } from 'react'
import type { DesktopState } from '../../shared/api.ts'
import { timeAgo } from './format.ts'
import { Panel } from './Panel.tsx'
import { useNow } from './useDesktopState.ts'

export function DevicesPanel({ state }: { state: DesktopState }) {
  const now = useNow(30_000)
  const [confirming, setConfirming] = useState<string>()

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Paired phones">
        {state.devices.length === 0 ? (
          <p className="text-sm text-muted">No phones yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {state.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`size-2 shrink-0 rounded-full ${d.online ? 'bg-glaze' : 'bg-line'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{d.name}</p>
                  <p className="text-xs text-muted">
                    {d.online
                      ? 'Connected'
                      : d.lastSeenAt
                        ? `Last seen ${timeAgo(d.lastSeenAt, now)}`
                        : 'Never connected'}
                  </p>
                </div>
                {confirming === d.id ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg bg-signal px-3 py-1 text-sm text-ink-900"
                      onClick={() => {
                        setConfirming(undefined)
                        void window.tessel.revokeDevice(d.id)
                      }}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 text-sm text-muted hover:text-text"
                      onClick={() => setConfirming(undefined)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    className="rounded-lg border border-line px-3 py-1 text-sm text-muted hover:text-text"
                    onClick={() => setConfirming(d.id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Phone can't connect?">
        <Troubleshooting platform={state.platform} port={state.port} />
      </Panel>
    </div>
  )
}

function Troubleshooting({ platform, port }: { platform: NodeJS.Platform; port: number }) {
  const tips: string[] = [
    'Put the phone and computer on the same Wi-Fi. Guest networks often block devices from seeing each other.',
  ]
  if (platform === 'darwin') {
    tips.push(
      'System Settings › Privacy & Security › Local Network: turn Tessel on.',
      'System Settings › Network › Firewall › Options: allow incoming connections for Tessel.',
    )
  } else if (platform === 'win32') {
    tips.push(
      'If Windows asked about the firewall, allow Tessel on private networks.',
      'Missed it? Windows Security › Firewall & network protection › Allow an app through firewall.',
      'Set your Wi-Fi to a Private network in Settings › Network & internet.',
    )
  } else {
    tips.push(`If a firewall is on, open the port, e.g. sudo ufw allow ${port}/tcp`)
  }
  tips.push('On the phone, check the address matches one shown here, including :' + port + '.')
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
      {tips.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  )
}
