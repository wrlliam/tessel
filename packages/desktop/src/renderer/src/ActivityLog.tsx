import { useEffect, useRef } from 'react'
import type { LogEntry } from '../../shared/api.ts'
import { clock } from './format.ts'

const levelColour = { info: 'text-muted', warn: 'text-cat-trigger', error: 'text-signal' } as const

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [entries])

  return (
    <section aria-label="Activity" className="border-t border-line">
      <h2 className="px-6 pt-2 text-xs text-muted">Activity</h2>
      <ol ref={ref} tabIndex={0} className="h-32 overflow-y-auto px-6 pb-2 font-mono text-xs">
        {entries.length === 0 && <li className="text-muted">Nothing yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex gap-3 py-0.5">
            <span className="text-muted/60">{clock(e.at)}</span>
            <span className={levelColour[e.level]}>{e.message}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
