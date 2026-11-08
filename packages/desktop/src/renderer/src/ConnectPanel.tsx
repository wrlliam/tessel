import { useState } from 'react'
import type { DesktopState } from '../../shared/api.ts'
import { formatCode } from './format.ts'
import { Panel } from './Panel.tsx'
import { Switch } from './Switch.tsx'
import { useNow } from './useDesktopState.ts'

export function ConnectPanel({ state }: { state: DesktopState }) {
  const [picked, setPicked] = useState<string>()
  const now = useNow()
  const url = picked && state.urls.includes(picked) ? picked : state.urls[0]

  if (!state.listening || !url) {
    return (
      <Panel title="Connect a phone">
        <p className="text-muted">
          {state.serverError
            ? 'Sharing stopped. Fix the problem shown above, then turn Allow phones off and on.'
            : state.listening
              ? 'No network found. Join a Wi-Fi network your phone also uses.'
              : 'Turn on Allow phones. Your phone and computer need to be on the same Wi-Fi.'}
        </p>
      </Panel>
    )
  }

  const { code, expiresAt } = state.pairing
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000))

  return (
    <Panel title="Connect a phone">
      <div className="flex flex-wrap gap-6">
        <img
          src={state.qrCodes[url]}
          alt={`QR code for ${url}`}
          className="size-56 shrink-0 rounded-xl"
        />
        <ol className="min-w-56 flex-1 space-y-5 text-sm">
          <li>
            <p className="text-muted">
              1. Scan with your phone's camera. It pairs by itself. Or open
            </p>
            <p className="mt-1 font-mono text-text select-all">{url}</p>
          </li>
          <li>
            <p className="text-muted">2. If you typed the address, enter this code</p>
            <div className="mt-1 flex items-center gap-4">
              <span
                className="font-mono text-4xl font-semibold tracking-wider text-glaze"
                aria-live="polite"
              >
                {formatCode(code)}
              </span>
              <button
                type="button"
                onClick={() => void window.tessel.newPairingCode()}
                className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-text"
              >
                New code
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Changes in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </p>
          </li>
          <li>
            <p className="text-muted">
              3. On iPhone, tap Share, then Add to Home Screen. Open it from there and pair once
              more. Home Screen apps keep their own storage.
            </p>
          </li>
        </ol>
      </div>

      {state.urls.length > 1 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-xs text-muted">
            Wrong network? Pick another address for the QR code.
          </p>
          <div className="flex flex-wrap gap-2">
            {state.urls.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={u === url}
                onClick={() => setPicked(u)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-xs ${u === url ? 'border-glaze text-text' : 'border-line text-muted hover:text-text'}`}
              >
                {u.replace(/^https?:\/\/|\/$/g, '')}
              </button>
            ))}
          </div>
        </div>
      )}

      <SecureConnection state={state} />
    </Panel>
  )
}

function SecureConnection({ state }: { state: DesktopState }) {
  const on = state.settings.https
  return (
    <div className="mt-5 border-t border-line pt-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p>Secure connection</p>
          <p className="text-xs text-muted">
            Uses https://, so Safari can keep the screen on. Each phone installs Tessel's
            certificate once.
          </p>
        </div>
        <Switch
          label="Secure connection"
          hideLabel
          checked={on}
          onChange={(https) => void window.tessel.updateSettings({ https })}
        />
      </div>
      {on && state.caUrl && (
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-muted">
          <li>
            On the phone, open <span className="font-mono text-text select-all">{state.caUrl}</span>{' '}
            and allow the download.
          </li>
          <li>
            iPhone: Settings › Profile Downloaded › Install. Then Settings › General › About ›
            Certificate Trust Settings, and turn on Tessel.
          </li>
          <li>
            Android: Settings › Security › Encryption › Install a certificate › CA certificate.
          </li>
          <li>Scan the QR code above and pair again; https:// is a new address to the phone.</li>
        </ol>
      )}
    </div>
  )
}
