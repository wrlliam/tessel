import { KeyFace, keyVars } from '@tessel/brand/key'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui/button.tsx'

export type TabName = 'editor' | 'phones' | 'plugins' | 'settings'

interface Step {
  title: string
  body: ReactNode
  /** Tab shown behind the card for this step. */
  tab: TabName
  /** Small picture of what the step talks about. */
  keys?: Array<{ label: string; icon: string; colour: string }>
}

const STEPS: Step[] = [
  {
    title: 'Your phone, as a deck of keys',
    tab: 'editor',
    body: 'Tessel runs on this computer and turns your phone into keys that open apps, mute calls, control music and more, over your Wi-Fi.',
    keys: [
      { label: 'Mute', icon: 'mic-off', colour: '#F25C6E' },
      { label: 'Play', icon: 'play', colour: '#22D3C5' },
      { label: 'Lock', icon: 'lock', colour: '#212833' },
    ],
  },
  {
    title: 'Connect your phone',
    tab: 'phones',
    body: 'On the Phones tab, scan the QR code with your phone and type the 6-digit code. Add the page to your Home Screen to open it like an app.',
  },
  {
    title: 'Add tiles',
    tab: 'editor',
    body: 'Each tile is a key on your phone. Click an empty slot for a blank tile, a slider or a ready-made one, or press + Page for a whole ready-made page. Right-click a tile to duplicate or delete it.',
    keys: [
      { label: 'Volume', icon: 'sliders-horizontal', colour: '#22D3C5' },
      { label: '12° Cloudy', icon: 'cloud', colour: '#4FA3F7' },
      { label: '4:59', icon: 'timer', colour: '#FF7A59' },
    ],
  },
  {
    title: 'Wire up what a tile does',
    tab: 'editor',
    body: 'Select a tile to see its blocks: a trigger like On press, then actions, joined by wires. Press Space on the canvas to add a block, drag on empty space to select several, and use Test run to try it.',
  },
  {
    title: 'Make it yours',
    tab: 'phones',
    body: 'Phones › On the phone sets the theme, key style, spacing and what happens when the phone is held sideways. Plugins add Voicemeeter, Soundpad, Ollama and more.',
  },
]

/** A short first-run walkthrough. Skippable; finishing or skipping saves that it was seen. */
export function Tour({ onTab, onDone }: { onTab: (tab: TabName) => void; onDone: () => void }) {
  const [i, setI] = useState(0)
  const step = STEPS[Math.min(i, STEPS.length - 1)] as Step
  const last = i === STEPS.length - 1
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => onTab(step.tab), [step.tab, onTab])
  useEffect(() => card.current?.focus(), [i])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-6 sm:items-center">
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
          if (e.key === 'ArrowRight' && !last) setI(i + 1)
          if (e.key === 'ArrowLeft' && i > 0) setI(i - 1)
        }}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl outline-none"
      >
        <p className="font-mono text-xs text-muted">
          {i + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 font-display text-xl font-semibold">
          {step.title}
        </h2>
        {step.keys && (
          <div className="mt-4 flex gap-3" aria-hidden>
            {step.keys.map((k) => (
              <span
                key={k.label}
                className="key size-16 rounded-[13px]"
                style={keyVars(k.colour, 'tinted')}
              >
                <KeyFace look={k} size={64} labelSize="small" />
              </span>
            ))}
          </div>
        )}
        <p className="mt-4 text-sm leading-6 text-muted">{step.body}</p>
        <div className="mt-6 flex items-center gap-2">
          <Button variant="ghost" onClick={onDone}>
            Skip
          </Button>
          <div className="ml-auto flex gap-2">
            {i > 0 && (
              <Button variant="ghost" onClick={() => setI(i - 1)}>
                Back
              </Button>
            )}
            <Button variant="primary" onClick={() => (last ? onDone() : setI(i + 1))}>
              {last ? 'Start' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
