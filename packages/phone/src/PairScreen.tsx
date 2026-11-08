import type { PairResponse } from '@tessel/core'
import { useState, type FormEvent } from 'react'
import { guessDeviceName, isStandalone } from './device.ts'
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
        return
      }
      onPaired(body.token)
    } catch {
      setError("Can't reach your computer. Check Tessel is open and 'Allow phones' is on.")
    } finally {
      setBusy(false)
    }
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6 && !busy) void pair(digits)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length === 6) void pair(code)
  }

  return (
    <main className="flex h-full flex-col justify-center gap-10 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="space-y-2">
        <Wordmark />
        <p className="text-muted">Tap. Build. Done.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <label className="block space-y-2">
          <span className="text-sm text-muted">Code shown on your computer</span>
          <input
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            aria-invalid={error ? true : undefined}
            disabled={busy}
            autoFocus
            className="w-full rounded-2xl border border-line bg-surface px-4 py-4 text-center font-mono text-4xl tracking-[0.3em] outline-none placeholder:text-line focus:border-glaze"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm text-muted">This phone's name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 outline-none focus:border-glaze"
          />
        </label>
        <p role="status" className="min-h-6 text-sm text-signal">
          {error}
        </p>
      </form>

      <div className="space-y-2 text-sm text-muted">
        {notice && <p className="text-text">{notice}</p>}
        {isStandalone() && (
          <p>Home Screen apps keep their own storage on iOS, so this one needs pairing too.</p>
        )}
      </div>
    </main>
  )
}
