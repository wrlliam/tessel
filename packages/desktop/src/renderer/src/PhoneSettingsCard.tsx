import { ICON_SCALE, KeyFace, keyRadius, keyVars } from '@tessel/brand/key'
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
export function PhoneSettingsCard({
  settings,
  location,
}: {
  settings: PhoneSettings
  location?: { at: number } | undefined
}) {
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
            className="key size-16"
            style={{
              borderRadius: keyRadius(settings.keyShape, 64, 64),
              ...keyVars(k.colour, settings.keyStyle),
            }}
          >
            <KeyFace
              look={k}
              size={64}
              labels={settings.labels}
              labelSize={settings.labelSize}
              iconScale={ICON_SCALE[settings.iconSize]}
              lights={settings.lights}
              shape={settings.keyShape}
            />
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
        <Row label="Key style" help="Tiles can override this in the editor">
          <Segmented
            label="Key style"
            value={settings.keyStyle}
            onChange={(keyStyle) => set({ keyStyle })}
            options={[
              { value: 'tinted', label: 'Tinted' },
              { value: 'solid', label: 'Solid' },
              { value: 'outline', label: 'Outline' },
              { value: 'glass', label: 'Glass' },
            ]}
          />
        </Row>
        <Row label="Key shape">
          <Segmented
            label="Key shape"
            value={settings.keyShape}
            onChange={(keyShape) => set({ keyShape })}
            options={[
              { value: 'rounded', label: 'Rounded' },
              { value: 'square', label: 'Square' },
              { value: 'round', label: 'Round' },
            ]}
          />
        </Row>
        <Row label="Icons">
          <div className="flex items-center gap-3">
            <Segmented
              label="Icon size"
              value={settings.iconSize}
              onChange={(iconSize) => set({ iconSize })}
              options={[
                { value: 'small', label: 'S' },
                { value: 'regular', label: 'M' },
                { value: 'large', label: 'L' },
              ]}
            />
          </div>
        </Row>
        <Row label="Indicator lights" help="The small dot in each key's corner">
          <Switch
            label="Indicator lights"
            hideLabel
            checked={settings.lights}
            onChange={(lights) => set({ lights })}
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
        <Row label="Held sideways" help="Reflow lays keys out again in wide rows, so they stay big">
          <Segmented
            label="Held sideways"
            value={settings.landscape}
            onChange={(landscape) => set({ landscape })}
            options={[
              { value: 'reflow', label: 'Reflow' },
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
        <Row
          label="Share location"
          help={
            settings.shareLocation
              ? location
                ? `For weather tiles. Last shared ${new Date(location.at).toLocaleString()}`
                : 'For weather tiles. Phones ask once; browsers need Secure connection'
              : 'Lets weather tiles use where your phone is'
          }
        >
          <Switch
            label="Share location"
            hideLabel
            checked={settings.shareLocation}
            onChange={(shareLocation) => set({ shareLocation })}
          />
        </Row>
        <Row
          label="Keep the screen on"
          help="Over plain http, Safari needs one tap before it stays on"
        >
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
