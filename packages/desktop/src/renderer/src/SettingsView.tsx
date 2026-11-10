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

        {state.inputNote && (
          <p role="note" className="rounded-xl border border-cat-trigger/50 px-4 py-3 text-sm">
            {state.inputNote}
          </p>
        )}

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
        <section aria-labelledby="charts">
          <h2 id="charts" className="font-display text-lg font-semibold">
            Charts
          </h2>
          <Row
            label="Remember"
            help="How far back chart tiles keep their values, to scroll through on the phone. The oldest go first."
          >
            <Select
              aria-label="Chart history"
              value={state.settings.historyMinutes}
              onChange={(e) => void update({ historyMinutes: Number(e.target.value) })}
            >
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={60}>1 hour</option>
              <option value={360}>6 hours</option>
              <option value={1440}>24 hours</option>
              <option value={10080}>7 days</option>
            </Select>
          </Row>
        </section>
        <section aria-labelledby="shortcuts">
          <h2 id="shortcuts" className="font-display text-lg font-semibold">
            Shortcut links
          </h2>
          <p className="mt-1 text-sm text-muted">
            Links that run a tile from the Shortcuts app, a Lock Screen widget or the Action button.
            Make one from a tile's right-click menu.
          </p>
          {state.shortcuts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">None yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {state.shortcuts.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">
                    {s.label}
                    <span className="block text-xs text-muted">
                      {s.lastUsedAt
                        ? `Last used ${new Date(s.lastUsedAt).toLocaleString()}`
                        : `Made ${new Date(s.createdAt).toLocaleDateString()}`}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void window.tessel.deleteShortcut(s.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="updates">
          <h2 id="updates" className="font-display text-lg font-semibold">
            Updates
          </h2>
          <Row label={`Tessel ${state.version}`} help={updateText(state.update)}>
            <div className="flex items-center gap-2">
              {state.update.status === 'ready' ||
              (state.update.status === 'available' && !state.update.canInstall) ? (
                <Button variant="primary" onClick={() => void window.tessel.installUpdate()}>
                  {state.update.status === 'ready' ? 'Restart to update' : 'Download'}
                </Button>
              ) : (
                <Button
                  disabled={
                    state.update.status === 'checking' || state.update.status === 'downloading'
                  }
                  onClick={() => void window.tessel.checkForUpdate()}
                >
                  Check now
                </Button>
              )}
            </div>
          </Row>
          <Row
            label="Check automatically"
            help="Looks for a new release on GitHub every few hours."
          >
            <Switch
              label="Check for updates automatically"
              hideLabel
              checked={state.settings.autoUpdate}
              onChange={(autoUpdate) => void update({ autoUpdate })}
            />
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

function updateText(u: DesktopState['update']): string {
  switch (u.status) {
    case 'checking':
      return 'Checking…'
    case 'none':
      return `Up to date. Checked ${new Date(u.checkedAt).toLocaleTimeString()}`
    case 'available':
      return u.canInstall
        ? `Version ${u.version} is downloading`
        : `Version ${u.version} is out. Download it, then replace Tessel in Applications`
    case 'downloading':
      return `Downloading ${u.version}: ${u.percent}%`
    case 'ready':
      return `Version ${u.version} is ready`
    case 'error':
      return u.message
    default:
      return 'Updates come from GitHub releases'
  }
}
