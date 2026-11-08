import { TileIcon } from '@tessel/brand/icons'
import { osName, type OS } from '@tessel/core'
import { PERMISSION_TEXT, type SettingField } from '@tessel/plugin-sdk'
import { FolderOpen, FolderCode, Package, RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { DesktopState, PluginInfo } from '../../shared/api.ts'
import { cn } from './lib/cn.ts'
import { Switch } from './Switch.tsx'
import { Button } from './ui/button.tsx'
import { Field } from './ui/field.tsx'
import { Input, Select } from './ui/input.tsx'

const STATUS: Record<PluginInfo['status'], string> = {
  starting: 'Starting…',
  running: 'Running',
  stopped: 'Off',
  crashed: 'Crashed, restarting',
  failed: 'Stopped after repeated crashes',
}

export function PluginsView({ state }: { state: DesktopState }) {
  const [message, setMessage] = useState<string>()

  async function add(kind: 'folder' | 'zip' | 'dev') {
    setMessage(undefined)
    const result = await window.tessel.addPlugin(kind)
    if (!result.ok && 'error' in result) setMessage(result.error)
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-display text-lg font-semibold">Plugins</h2>
            <Button onClick={() => void add('folder')}>
              <FolderOpen /> Install from folder…
            </Button>
            <Button onClick={() => void add('zip')}>
              <Package /> Install from zip…
            </Button>
            <Button variant="ghost" onClick={() => void add('dev')}>
              <FolderCode /> Load for development…
            </Button>
          </div>
          <p className="text-sm text-muted">
            Plugins add blocks and triggers. Each runs in its own process, so a crash can't take
            Tessel down. They still run with your account's rights: Tessel shows the permissions a
            plugin declares before it starts, but can't fully sandbox it. Only install plugins you
            trust. Phones can never install or turn on plugins.
          </p>
          {message && (
            <p role="alert" className="text-sm text-signal">
              {message}
            </p>
          )}
        </header>
        {state.plugins.length === 0 && <p className="text-sm text-muted">No plugins yet.</p>}
        <ul className="space-y-3">
          {state.plugins.map((p) => (
            <PluginCard key={p.id} plugin={p} os={state.platform as OS} />
          ))}
        </ul>
      </div>
    </main>
  )
}

function PluginCard({ plugin: p, os }: { plugin: PluginInfo; os: OS }) {
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string>()
  const elsewhere = p.platforms && !p.platforms.includes(os)
  const problem = p.status === 'crashed' || p.status === 'failed'

  return (
    <li className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-line">
          <TileIcon icon={p.icon || 'zap'} size={20} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-medium">{p.name}</h3>
            <span className="font-mono text-xs text-muted">{p.version}</span>
            <span className="text-xs text-muted">
              ·{' '}
              {p.source === 'built-in'
                ? 'Built in'
                : p.source === 'dev'
                  ? 'Development, reloads on save'
                  : 'Installed'}
            </span>
          </div>
          <p className="text-sm text-muted">{p.description}</p>
          {elsewhere && (
            <p className="text-sm text-cat-trigger">
              Made for {p.platforms?.map((x) => osName[x]).join(', ')}. Its blocks will say so on{' '}
              {osName[os]}.
            </p>
          )}
          <p role="status" className={cn('text-sm', problem ? 'text-signal' : 'text-muted')}>
            {STATUS[p.status]}
            {p.status === 'running' &&
              ` · ${p.blockCount} ${p.blockCount === 1 ? 'block' : 'blocks'}`}
            {p.error && p.status !== 'running' && `: ${p.error}`}
          </p>
        </div>
        <Switch
          label={p.enabled ? 'On' : 'Off'}
          checked={p.enabled}
          onChange={(on) =>
            void window.tessel
              .setPluginEnabled(p.id, on)
              .then((r) => setError(r.ok ? undefined : r.error))
          }
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {p.permissions.length === 0 ? (
          <span className="rounded-md bg-line px-2 py-0.5 text-xs text-muted">
            No special permissions
          </span>
        ) : (
          p.permissions.map((perm) => (
            <span
              key={perm}
              className="rounded-md border border-cat-trigger/50 px-2 py-0.5 text-xs"
            >
              {PERMISSION_TEXT[perm]}
            </span>
          ))
        )}
      </div>
      {p.settingsSchema && Object.keys(p.settingsSchema.properties).length > 0 && (
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm">Settings</summary>
          <div className="mt-3 space-y-3">
            {Object.entries(p.settingsSchema.properties).map(([key, field]) => (
              <SettingInput
                key={key}
                id={`${p.id}-${key}`}
                field={field}
                value={p.settings[key]}
                onChange={(v) =>
                  void window.tessel.updatePluginSettings(p.id, { ...p.settings, [key]: v })
                }
              />
            ))}
          </div>
        </details>
      )}
      <div className="flex gap-2">
        {p.enabled && (
          <Button size="sm" variant="ghost" onClick={() => void window.tessel.restartPlugin(p.id)}>
            <RotateCw /> Restart
          </Button>
        )}
        {p.source !== 'built-in' &&
          (confirm ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => void window.tessel.removePlugin(p.id)}
            >
              {p.source === 'dev' ? 'Stop using it' : 'Remove it and its files'}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              Remove
            </Button>
          ))}
      </div>
      {error && <p className="text-sm text-signal">{error}</p>}
    </li>
  )
}

/** One field of a plugin's settings form, built from its settingsSchema. */
function SettingInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string
  field: SettingField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  if (field.type === 'boolean')
    return <Switch label={field.title} checked={value === true} onChange={onChange} />
  return (
    <Field label={field.title} help={field.description} htmlFor={id}>
      {field.enum ? (
        <Select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.enum.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          type={field.secret ? 'password' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          className={field.type === 'number' ? 'w-32 font-mono' : ''}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(field.type === 'number' ? Number(draft) : draft)}
        />
      )}
    </Field>
  )
}
