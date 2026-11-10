import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry } from '../../shared/api.ts'
import { clock } from './format.ts'

const levelColour = { info: 'text-muted', warn: 'text-cat-trigger', error: 'text-signal' } as const
const RANK = { info: 0, warn: 1, error: 2 } as const
type Show = 'all' | 'warn' | 'error'

/** Splits a message around what was searched, so matches stand out. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-glaze/25 text-text">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLOListElement>(null)
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [tall, setTall] = useState(false)
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      entries.filter(
        (e) =>
          (show === 'all' || RANK[e.level] >= RANK[show]) &&
          (!q || e.message.toLowerCase().includes(q)),
      ),
    [entries, show, q],
  )
  const filtering = q !== '' || show !== 'all'

  // Follow new entries, but not while you're looking through a search.
  useEffect(() => {
    if (!filtering) ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [shown, filtering])

  return (
    <section aria-label="Activity" className="border-t border-line">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-2">
        <h2 className="mr-auto text-xs text-muted">
          Activity
          {filtering && (
            <span className="ml-2 font-mono">
              {shown.length} of {entries.length}
            </span>
          )}
        </h2>
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search the activity log"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            className="h-7 w-48 rounded-md border border-line bg-bg pr-6 pl-7 text-xs outline-none focus:border-glaze"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1.5 text-muted hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <div
          role="radiogroup"
          aria-label="Show"
          className="flex rounded-md border border-line text-xs"
        >
          {(
            [
              ['all', 'All'],
              ['warn', 'Warnings'],
              ['error', 'Errors'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={show === value}
              onClick={() => setShow(value)}
              className="px-2 py-1 text-muted first:rounded-l-md last:rounded-r-md aria-checked:bg-line aria-checked:text-text"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={tall ? 'Make the log smaller' : 'Make the log bigger'}
          onClick={() => setTall(!tall)}
          className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-line hover:text-text"
        >
          {tall ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>
      <ol
        ref={ref}
        tabIndex={0}
        className={`${tall ? 'h-80' : 'h-32'} overflow-y-auto px-6 pb-2 font-mono text-xs`}
      >
        {shown.length === 0 && (
          <li className="text-muted">
            {entries.length === 0 ? 'Nothing yet.' : 'Nothing matches.'}
          </li>
        )}
        {shown.map((e) => (
          <li key={e.id} className="flex gap-3 py-0.5">
            <span className="text-muted/60">{clock(e.at)}</span>
            <span className={levelColour[e.level]}>
              <Highlight text={e.message} query={query.trim()} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
