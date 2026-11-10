import { ChevronDown, ChevronUp, Eraser } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { clock } from '../format.ts'
import { cn } from '../lib/cn.ts'
import { findTile, useEditor, type RunEntry } from './store.ts'

const STATUS = { ok: 'ran', error: 'failed', cancelled: 'stopped', timeout: 'timed out' } as const
type Scope = 'tile' | 'all'

const dot = (r: RunEntry) =>
  !r.status
    ? 'bg-glaze animate-pulse'
    : r.status === 'ok'
      ? 'bg-glaze'
      : r.status === 'cancelled'
        ? 'bg-muted'
        : 'bg-signal'

/** How long a run took, as a bar against the slowest run shown, so slow runs stand out. */
function Took({ ms, slowest }: { ms: number | undefined; slowest: number }) {
  if (ms === undefined) return <span className="w-24" />
  return (
    <span className="flex w-24 items-center justify-end gap-2" title={`${ms} ms`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-line" aria-hidden>
        <span
          className="block h-full rounded-full bg-muted"
          style={{ width: `${Math.max(6, (ms / slowest) * 100)}%` }}
        />
      </span>
      <span className="w-12 text-right tabular-nums">
        {ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`}
      </span>
    </span>
  )
}

export function RunLog() {
  const runs = useEditor((s) => s.runs)
  const profile = useEditor((s) => s.profile)
  const blocks = useEditor((s) => s.blocks)
  const selected = useEditor((s) => s.selectedTileId)
  const { selectTile, selectNodes } = useEditor.getState()
  const list = useRef<HTMLOListElement>(null)
  const [scope, setScope] = useState<Scope>('all')
  const [clearedAt, setClearedAt] = useState(0)
  const [tall, setTall] = useState(false)

  const shown = useMemo(
    () =>
      runs.filter(
        (r) => r.at > clearedAt && (scope === 'all' || !selected || r.tileId === selected),
      ),
    [runs, clearedAt, scope, selected],
  )
  const failed = shown.filter((r) => r.status === 'error' || r.status === 'timeout').length
  const slowest = Math.max(1, ...shown.map((r) => r.ms ?? 0))

  useEffect(() => {
    // Not an expression body: Chromium's scrollTo returns a promise, which React would treat as a cleanup.
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [shown])

  return (
    <section aria-label="Run log" className="border-t border-line">
      <div className="flex items-center gap-3 px-4 pt-2">
        <h2 className="text-xs text-muted">Run log</h2>
        {shown.length > 0 && (
          <span className="font-mono text-xs text-muted tabular-nums">
            {shown.length} {shown.length === 1 ? 'run' : 'runs'}
            {failed > 0 && <span className="text-signal"> · {failed} failed</span>}
          </span>
        )}
        <div
          role="radiogroup"
          aria-label="Show runs of"
          className="ml-auto flex rounded-md border border-line text-xs"
        >
          {(
            [
              ['all', 'All tiles'],
              ['tile', 'This tile'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              disabled={value === 'tile' && !selected}
              onClick={() => setScope(value)}
              className="px-2 py-0.5 text-muted first:rounded-l-md last:rounded-r-md disabled:opacity-40 aria-checked:bg-line aria-checked:text-text"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Clear the run log"
          title="Clear"
          disabled={shown.length === 0}
          onClick={() => setClearedAt(Date.now())}
          className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-line hover:text-text disabled:opacity-40"
        >
          <Eraser className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={tall ? 'Make the run log smaller' : 'Make the run log bigger'}
          onClick={() => setTall(!tall)}
          className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-line hover:text-text"
        >
          {tall ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>
      <ol
        ref={list}
        tabIndex={0}
        className={cn(tall ? 'h-72' : 'h-28', 'overflow-y-auto px-2 pt-1 pb-2 font-mono text-xs')}
      >
        {shown.length === 0 && (
          <li className="px-2 py-1 text-muted">
            {runs.length && scope === 'tile'
              ? 'This tile has not run yet.'
              : 'Press Test run, or a tile on your phone.'}
          </li>
        )}
        {shown.map((r) => {
          const tile = findTile(profile, r.tileId)
          const node = tile?.graph.nodes.find((n) => n.id === r.failedNodeId)
          const blockName = node && blocks.get(node.type)?.name
          const bad = r.status === 'error' || r.status === 'timeout'
          return (
            <li
              key={r.runId}
              className={cn(
                'flex items-center gap-3 rounded-md px-2 py-1',
                bad ? 'bg-signal/8' : 'hover:bg-line/50',
              )}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', dot(r))} aria-hidden />
              <span className="text-muted/70 tabular-nums">{clock(r.at)}</span>
              <button
                type="button"
                className="max-w-40 truncate text-left text-text hover:underline"
                onClick={() => tile && selectTile(r.tileId)}
                disabled={!tile}
              >
                {tile?.label || 'Deleted tile'}
              </button>
              <span className={bad ? 'text-signal' : 'text-muted'}>
                {r.status ? STATUS[r.status] : 'running…'}
              </span>
              {r.error ? (
                <button
                  type="button"
                  title="Show the block that failed"
                  className="min-w-0 flex-1 truncate text-left text-signal underline-offset-2 hover:underline"
                  onClick={() => {
                    selectTile(r.tileId)
                    if (node) selectNodes([node.id])
                  }}
                >
                  {blockName ? `${blockName}: ` : ''}
                  {r.error}
                </button>
              ) : (
                <span className="flex-1" />
              )}
              <span className="text-muted">
                <Took ms={r.ms} slowest={slowest} />
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
