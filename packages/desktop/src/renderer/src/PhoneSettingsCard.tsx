import { KeyFace, keyVars } from '@tessel/brand/key'
import type { PhoneSettings } from '@tessel/core'
import type { ReactNode } from 'react'
import { Panel } from './Panel.tsx'
import { Switch } from './Switch.tsx'
import { Segmented } from './ui/segmented.tsx'

const SAMPLE = [
  { label: 'Mic', icon: 'mic', colour: '#F25C6E' },
  { label: 'Scene', icon: 'monitor', colour: '#22D3C5' },
  { label: 'Play', icon: 'play', colour: '#212833' },
]
const GAP = { compact: 6, regular: 8, roomy: 12 }

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm">{label}</p>
        {help && <p className="text-xs text-muted">{help}</p>}
      </div>
      {children}
    </div>
  )
}

/** How every connected phone looks and behaves. Changes reach phones straight away. */
export function PhoneSettingsCard({ settings }: { settings: PhoneSettings }) {
  const set = (patch: Partial<PhoneSettings>) => void window.tessel.updatePhoneSettings(patch)
  const previewTheme = settings.theme === 'system' ? undefined : settings.theme

  return (
    <Panel title="On the phone">
      <div
        data-theme={previewTheme}
        className="mb-4 flex justify-center rounded-xl bg-bg py-5 shadow-[inset_0_0_0_1px_var(--line)]"
        style={{ gap: GAP[settings.spacing] }}
        aria-hidden
      >
        {SAMPLE.map((k) => (
          <div
            key={k.label}
            className="key size-16 rounded-[13px]"
            style={keyVars(k.colour, settings.keyStyle)}
          >
            <KeyFace look={k} size={64} labels={settings.labels} labelSize={settings.labelSize} />
          </div>
        ))}
      </div>
      <div className="divide-y divide-line">
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'system', label: 'Phone' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </Row>
        <Row label="Key colour" help="Tinted keeps keys dark with a coloured light">
          <Segmented
            label="Key colour"
            value={settings.keyStyle}
            onChange={(keyStyle) => set({ keyStyle })}
            options={[
              { value: 'tinted', label: 'Tinted' },
              { value: 'solid', label: 'Solid' },
            ]}
          />
        </Row>
        <Row label="Labels">
          <div className="flex items-center gap-3">
            {settings.labels && (
              <Segmented
                label="Label size"
                value={settings.labelSize}
                onChange={(labelSize) => set({ labelSize })}
                options={[
                  { value: 'small', label: 'S' },
                  { value: 'regular', label: 'M' },
                  { value: 'large', label: 'L' },
                ]}
              />
            )}
            <Switch
              label="Show labels"
              hideLabel
              checked={settings.labels}
              onChange={(labels) => set({ labels })}
            />
          </div>
        </Row>
        <Row label="Spacing">
          <Segmented
            label="Spacing"
            value={settings.spacing}
            onChange={(spacing) => set({ spacing })}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'regular', label: 'Regular' },
              { value: 'roomy', label: 'Roomy' },
            ]}
          />
        </Row>
        <Row label="Held sideways" help="Fill stretches keys across the whole screen">
          <Segmented
            label="Held sideways"
            value={settings.landscape}
            onChange={(landscape) => set({ landscape })}
            options={[
              { value: 'fill', label: 'Fill' },
              { value: 'fit', label: 'Fit' },
              { value: 'rotate', label: 'Rotate' },
            ]}
          />
        </Row>
        <Row label="Page name and status bar">
          <Switch
            label="Show header"
            hideLabel
            checked={settings.header}
            onChange={(header) => set({ header })}
          />
        </Row>
        <Row label="Vibrate on press" help="Android, and the Tessel iPhone app">
          <Switch
            label="Vibrate on press"
            hideLabel
            checked={settings.haptics}
            onChange={(haptics) => set({ haptics })}
          />
        </Row>
        <Row label="Keep the screen on">
          <Switch
            label="Keep the screen on"
            hideLabel
            checked={settings.keepAwake}
            onChange={(keepAwake) => set({ keepAwake })}
          />
        </Row>
        <Row label="Dim screen strength" help="When Dim screen is on in the phone's menu">
          <label className="flex items-center gap-3">
            <span className="sr-only">Dim screen strength</span>
            <input
              type="range"
              min={20}
              max={90}
              step={10}
              value={settings.dimLevel}
              onChange={(e) => set({ dimLevel: Number(e.target.value) })}
              className="w-32 accent-[var(--glaze)]"
            />
            <span className="w-10 text-right font-mono text-sm text-muted tabular-nums">
              {settings.dimLevel}%
            </span>
          </label>
        </Row>
      </div>
    </Panel>
  )
}
