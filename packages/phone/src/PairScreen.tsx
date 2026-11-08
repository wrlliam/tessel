import type { PairResponse } from '@tessel/core'
import { useRef, useState, type FormEvent } from 'react'
import { chooseAnotherComputer, guessDeviceName, inNativeApp, isStandalone } from './device.ts'
import { Wordmark } from './Logo.tsx'

interface Props {
  notice?: string | undefined
  onPaired: (token: string) => void
}

export function PairScreen({ notice, onPaired }: Props) {
  const [code, setCode] = useState('')
  const [name, setName] = useState(guessDeviceName)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(true)
  const input = useRef<HTMLInputElement>(null)

  async function pair(value: string) {
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: value, deviceName: name.trim() || guessDeviceName() }),
      })
      const body = (await res.json()) as Partial<PairResponse> & { error?: string }
      if (!res.ok || !body.token) {
        setError(body.error ?? 'Pairing failed. Try again.')
        setCode('')
        input.current?.focus()
        return
      }
      onPaired(body.token)
    } catch {
      setError("Can't reach your computer. Check Tessel is open and Allow phones is on.")
    } finally {
      setBusy(false)
    }
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    setError(undefined)
    if (digits.length === 6 && !busy) void pair(digits)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length === 6) void pair(code)
  }

  return (
    <main className="flex h-full flex-col px-6 pt-[calc(env(safe-area-inset-top)+24px)] pb-[calc(env(safe-area-inset-bottom)+16px)]">
      <Wordmark />
      <h1 className="mt-12 text-[28px] leading-9 font-medium">Pair this phone</h1>
      <p className="mt-2 text-muted">Enter the code shown in Tessel on your computer</p>

      <form onSubmit={onSubmit} className="mt-8">
        <label className="relative block" onClick={() => input.current?.focus()}>
          <span className="sr-only">Pairing code</span>
          <input
            ref={input}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            aria-invalid={error ? true : undefined}
            disabled={busy}
            autoFocus
            className="absolute inset-0 z-10 w-full opacity-0"
          />
          <span className="grid grid-cols-6 gap-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => {
              const active = focused && i === Math.min(code.length, 5) && !busy
              return (
                <span
                  key={i}
                  className={`flex h-14 items-center justify-center rounded-xl bg-surface font-mono text-2xl tabular-nums shadow-[inset_0_0_0_1px_var(--key-line)] transition-shadow ${
                    error
                      ? 'shadow-[inset_0_0_0_1.5px_var(--signal)]'
                      : active
                        ? 'shadow-[inset_0_0_0_1.5px_var(--glaze)]'
                        : ''
                  }`}
                >
                  {code[i] ?? ''}
                </span>
              )
            })}
          </span>
        </label>
        <p role="status" className="mt-3 min-h-5 text-sm text-signal">
          {error ?? (busy ? <span className="text-muted">Pairing…</span> : null)}
        </p>
      </form>

      <label className="mt-6 block">
        <span className="text-sm text-muted">Name for this phone</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          className="mt-2 h-12 w-full rounded-xl bg-surface px-4 text-[15px] shadow-[inset_0_0_0_1px_var(--key-line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--glaze)]"
        />
      </label>

      <div className="mt-auto space-y-3 pt-8 text-sm text-muted">
        {notice && <p className="text-text">{notice}</p>}
        {isStandalone() && !inNativeApp() && (
          <p>Home Screen apps keep their own storage on iOS, so this one needs pairing too.</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs">{location.host}</span>
          {inNativeApp() && (
            <button type="button" className="min-h-11 text-glaze" onClick={chooseAnotherComputer}>
              Choose another computer
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
