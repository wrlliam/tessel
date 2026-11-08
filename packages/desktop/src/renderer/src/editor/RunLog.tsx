import { useEffect, useRef } from 'react'
import { clock } from '../format.ts'
import { findTile, useEditor } from './store.ts'

const STATUS = { ok: 'ran', error: 'failed', cancelled: 'stopped', timeout: 'timed out' } as const

export function RunLog() {
  const runs = useEditor((s) => s.runs)
  const profile = useEditor((s) => s.profile)
  const blocks = useEditor((s) => s.blocks)
  const { selectTile, selectNodes } = useEditor.getState()
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    // Not an expression body: Chromium's scrollTo returns a promise, which React would treat as a cleanup.
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [runs])

  return (
    <section aria-label="Run log" className="border-t border-line">
      <h2 className="px-4 pt-2 text-xs text-muted">Run log</h2>
      <ol ref={list} tabIndex={0} className="h-28 overflow-y-auto px-4 pb-2 font-mono text-xs">
        {runs.length === 0 && (
          <li className="text-muted">Press Test run, or a tile on your phone.</li>
        )}
        {runs.map((r) => {
          const tile = findTile(profile, r.tileId)
          const node = tile?.graph.nodes.find((n) => n.id === r.failedNodeId)
          const blockName = node && blocks.get(node.type)?.name
          return (
            <li key={r.runId} className="flex gap-3 py-0.5">
              <span className="text-muted/60">{clock(r.at)}</span>
              <span>{tile?.label || 'Deleted tile'}</span>
              <span
                className={
                  r.status === 'error' || r.status === 'timeout' ? 'text-signal' : 'text-muted'
                }
              >
                {r.status ? STATUS[r.status] : 'running…'}
                {r.ms !== undefined && ` in ${r.ms} ms`}
              </span>
              {r.error && (
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-signal underline-offset-2 hover:underline"
                  onClick={() => {
                    selectTile(r.tileId)
                    if (node) selectNodes([node.id])
                  }}
                >
                  {blockName ? `${blockName}: ` : ''}
                  {r.error}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
