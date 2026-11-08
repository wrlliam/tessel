import { useState, type ReactNode } from 'react'
import type { AppSettings, DesktopState } from '../../shared/api.ts'
import { Switch } from './Switch.tsx'
import { Button } from './ui/button.tsx'
import { Input, Select } from './ui/input.tsx'

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-4 last:border-0">
      <div className="space-y-1">
        <p className="text-sm">{label}</p>
        {help && <p className="max-w-md text-xs text-muted">{help}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const SHELL: Array<{ value: AppSettings['shell']; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'confirm', label: 'Ask every time' },
  { value: 'on', label: 'Allowed' },
]

export function SettingsView({ state }: { state: DesktopState }) {
  const [port, setPort] = useState(String(state.port))
  const [message, setMessage] = useState<string>()
  const update = async (patch: Parameters<typeof window.tessel.updateSettings>[0]) => {
    const result = await window.tessel.updateSettings(patch)
    setMessage(result.ok ? undefined : result.error)
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <section aria-labelledby="sharing">
          <h2 id="sharing" className="font-display text-lg font-semibold">
            Sharing
          </h2>
          <Row
            label="Port"
            help="Phones connect to this port. Changing it restarts sharing, so phones reconnect on the new address."
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void update({ port: Number(port) })
              }}
            >
              <Input
                aria-label="Port"
                className="w-24 font-mono"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
              <Button type="submit" disabled={Number(port) === state.port}>
                Apply
              </Button>
            </form>
          </Row>
          {state.startOnLogin !== null && (
            <Row label="Start on login" help="Opens Tessel in the tray when you log in.">
              <Switch
                label={state.startOnLogin ? 'On' : 'Off'}
                checked={state.startOnLogin}
                onChange={(on) => void window.tessel.setStartOnLogin(on)}
              />
            </Row>
          )}
          <Row label="Paired phones" help="Pair and remove phones on the Phones tab.">
            <span className="text-sm text-muted">{state.devices.length}</span>
          </Row>
        </section>

        <section aria-labelledby="look">
          <h2 id="look" className="font-display text-lg font-semibold">
            Appearance
          </h2>
          <Row label="Theme" help="Phones follow their own system setting.">
            <Select
              aria-label="Theme"
              value={state.settings.theme}
              onChange={(e) => void update({ theme: e.target.value as AppSettings['theme'] })}
            >
              <option value="system">Match system</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          </Row>
        </section>

        <section aria-labelledby="safety">
          <h2 id="safety" className="font-display text-lg font-semibold">
            Safety
          </h2>
          <Row
            label="Shell commands"
            help="Run shell command blocks can do anything your user account can. Leave this off unless you wrote the tiles yourself. “Ask every time” shows each command before it runs."
          >
            <div role="radiogroup" aria-label="Shell commands" className="flex gap-1">
              {SHELL.map((o) => (
                <Button
                  key={o.value}
                  role="radio"
                  aria-checked={state.settings.shell === o.value}
                  variant={
                    state.settings.shell === o.value
                      ? o.value === 'on'
                        ? 'danger'
                        : 'primary'
                      : 'ghost'
                  }
                  size="sm"
                  onClick={() => void update({ shell: o.value })}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </Row>
        </section>

        <section aria-labelledby="log">
          <h2 id="log" className="font-display text-lg font-semibold">
            Activity log
          </h2>
          <Row label="Show" help="What the Phones tab's activity log keeps.">
            <Select
              aria-label="Log level"
              value={state.settings.logLevel}
              onChange={(e) => void update({ logLevel: e.target.value as AppSettings['logLevel'] })}
            >
              <option value="info">Everything</option>
              <option value="warn">Warnings and errors</option>
              <option value="error">Errors only</option>
            </Select>
          </Row>
        </section>
        {message && (
          <p role="alert" className="text-sm text-signal">
            {message}
          </p>
        )}
      </div>
    </main>
  )
}
