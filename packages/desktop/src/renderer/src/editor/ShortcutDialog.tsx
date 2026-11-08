import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button.tsx'

/** Shows a new shortcut link for a tile, with how to put it on a lock screen or button. */
export function ShortcutDialog({
  label,
  link,
  onClose,
}: {
  label: string
  link: { urls: string[]; qr: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState(link.urls[0] ?? '')
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.focus(), [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl outline-none"
      >
        <h2 id="shortcut-title" className="font-display text-lg font-semibold">
          Shortcut link for “{label}”
        </h2>
        <p className="mt-1 text-sm text-muted">
          Sending a POST to this link runs the tile, from the Lock Screen, the Action button, Back
          Tap or Siri. Anyone with the link on your network can run it; remove it in Settings when
          you're done with it. It's shown only now.
        </p>
        <div className="mt-4 flex gap-4">
          {link.qr && (
            <img src={link.qr} alt="QR code of the link" className="size-32 shrink-0 rounded-lg" />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-mono text-xs break-all select-all">{url}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(url)
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
              </Button>
              {link.urls.length > 1 && (
                <select
                  aria-label="Address"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="rounded-lg border border-line bg-bg px-2 text-xs"
                >
                  {link.urls.map((u) => (
                    <option key={u} value={u}>
                      {new URL(u).host}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        <ol className="mt-4 list-decimal space-y-1 pl-4 text-sm text-muted">
          <li>
            On iPhone, open <b className="text-text">Shortcuts</b>, make a new shortcut and add{' '}
            <b className="text-text">Get Contents of URL</b>. Paste the link and set Method to{' '}
            <b className="text-text">POST</b>.
          </li>
          <li>
            Name it, then add it where you want it: a Lock Screen widget, Settings › Action Button ›
            Shortcut, Settings › Accessibility › Touch › Back Tap, or ask Siri by its name.
          </li>
          <li>On Android, an app like HTTP Shortcuts does the same from the home screen.</li>
          <li>The phone must be on the same network as this computer.</li>
        </ol>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
