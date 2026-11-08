import type { OS } from '@tessel/core'
import { useEffect } from 'react'
import { Canvas } from './Canvas.tsx'
import { Inspector } from './Inspector.tsx'
import { RunLog } from './RunLog.tsx'
import { useEditor, useSelectedTile } from './store.ts'
import { saveNow, useEditorSync } from './sync.ts'
import { TileGrid } from './TileGrid.tsx'

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

function useShortcuts(os: OS) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = os === 'darwin' ? e.metaKey : e.ctrlKey
      if (!mod || isEditable(e.target)) return
      const s = useEditor.getState()
      const key = e.key.toLowerCase()
      const run = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      if (key === 'z' && e.shiftKey) run(s.redo)
      else if (key === 'z' || (key === 'y' && os !== 'darwin')) run(key === 'y' ? s.redo : s.undo)
      else if (key === 'c') run(s.copy)
      else if (key === 'v') run(s.paste)
      else if (key === 'd') run(() => (s.copy(), s.paste()))
      else if (key === 's') run(() => void saveNow())
      else if (key === 'enter' && s.selectedTileId) {
        const id = s.selectedTileId
        run(() => {
          void saveNow().then((ok) => {
            if (ok) return window.tessel.testRun(id)
          })
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [os])
}

export function Editor({ os }: { os: OS }) {
  useEditorSync()
  useShortcuts(os)
  const profile = useEditor((s) => s.profile)
  const save = useEditor((s) => s.save)
  const tile = useSelectedTile()
  const page = profile?.pages[0]
  if (!profile || !page) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Tiles"
          className="w-72 shrink-0 space-y-4 overflow-y-auto border-r border-line p-4"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-base font-semibold">
              {profile.name} <span className="font-sans font-normal text-muted">· {page.name}</span>
            </h2>
            <SaveStatus state={save} />
          </div>
          <TileGrid page={page} />
          <p className="text-xs text-muted">Click a tile to edit it. Empty slots add a new tile.</p>
        </aside>
        {tile ? (
          <>
            <main aria-label="Blocks canvas" className="flex min-w-0 flex-1 flex-col">
              <Canvas tile={tile} />
            </main>
            <Inspector tile={tile} os={os} />
          </>
        ) : (
          <main className="flex flex-1 items-center justify-center text-sm text-muted">
            Pick a tile on the left, or add one.
          </main>
        )}
      </div>
      <RunLog />
    </div>
  )
}

function SaveStatus({ state }: { state: ReturnType<typeof useEditor.getState>['save'] }) {
  if (state.kind === 'error') {
    return (
      <span role="status" className="text-xs text-signal" title={state.message}>
        Not saved
      </span>
    )
  }
  return (
    <span role="status" className="text-xs text-muted">
      {state.kind === 'pending' ? 'Saving…' : 'Saved'}
    </span>
  )
}
