import type { Appearance, OS, TileTemplate } from '@tessel/core'
import { LayoutTemplate } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../ui/button.tsx'
import { Canvas } from './Canvas.tsx'
import { Inspector } from './Inspector.tsx'
import type { Cell } from './layout.ts'
import { PagesPanel } from './PagesPanel.tsx'
import { ProfilePanel } from './ProfilePanel.tsx'
import { RunLog } from './RunLog.tsx'
import { findPage, useEditor, useSelectedPage, useSelectedTile } from './store.ts'
import { saveNow, useEditorSync } from './sync.ts'
import { TemplateGallery } from './TemplateGallery.tsx'
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
      else if (key === 'enter' && s.selectedTileId && s.profile) {
        const ids = [s.profile.id, s.selectedTileId] as const
        run(() => {
          void saveNow().then((ok) => {
            if (ok) return window.tessel.testRun(...ids)
          })
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [os])
}

interface Props {
  os: OS
  profiles: Array<{ id: string; name: string }>
  activeProfileId: string
  liveAppearance: Record<string, Appearance>
}

export function Editor({ os, profiles, activeProfileId, liveAppearance }: Props) {
  useEditorSync(activeProfileId)
  useShortcuts(os)
  const profile = useEditor((s) => s.profile)
  const save = useEditor((s) => s.save)
  const tile = useSelectedTile()
  const page = useSelectedPage()
  const [gallery, setGallery] = useState<{ cell?: Cell } | null>(null)
  if (!profile) return null
  const live = profile.id === activeProfileId ? liveAppearance : {}

  function pickTemplate(t: TileTemplate) {
    const { insertTemplate, profile: p } = useEditor.getState()
    if (insertTemplate(t, gallery?.cell) && t.variables && p)
      void window.tessel.addVariables(p.id, t.variables)
    setGallery(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Profile, pages and tiles"
          className="w-80 shrink-0 space-y-5 overflow-y-auto border-r border-line p-4"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-base font-semibold">Profile</h2>
            <SaveStatus state={save} />
          </div>
          <ProfilePanel profiles={profiles} activeId={activeProfileId} />
          <PagesPanel />
          {page && (
            <section aria-label={`Tiles on ${page.name}`} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs text-muted">Tiles on “{page.name}”</h3>
                <Button size="sm" variant="ghost" onClick={() => setGallery({})}>
                  <LayoutTemplate /> Templates
                </Button>
              </div>
              <TileGrid page={page} live={live} onTemplates={(cell) => setGallery({ cell })} />
              <Notice />
              <p className="text-xs text-muted">
                Drag tiles to move them. Drag the corner of the selected tile to resize.
              </p>
            </section>
          )}
        </aside>
        {tile && tile.kind === 'folder' ? (
          <FolderPanel folderId={tile.targetPageId} />
        ) : tile ? (
          <main aria-label="Blocks canvas" className="flex min-w-0 flex-1 flex-col">
            <Canvas tile={tile} />
          </main>
        ) : (
          <main className="flex flex-1 items-center justify-center text-sm text-muted">
            Pick a tile on the left, or add one.
          </main>
        )}
        {tile && <Inspector tile={tile} os={os} />}
      </div>
      <RunLog />
      <TemplateGallery
        open={gallery !== null}
        onOpenChange={(open) => !open && setGallery(null)}
        onPick={pickTemplate}
      />
    </div>
  )
}

function FolderPanel({ folderId }: { folderId: string | undefined }) {
  const folder = useEditor((s) => findPage(s.profile, folderId ?? null))
  const { selectPage } = useEditor.getState()
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted">
      <p>This tile opens the folder “{folder?.name}” on the phone.</p>
      {folder && (
        <Button variant="primary" onClick={() => selectPage(folder.id)}>
          Edit the folder’s tiles
        </Button>
      )}
    </main>
  )
}

function Notice() {
  const notice = useEditor((s) => s.notice)
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => useEditor.getState().setNotice(undefined), 4000)
    return () => clearTimeout(id)
  }, [notice])
  if (!notice) return null
  return (
    <p role="status" className="rounded-lg border border-line px-3 py-2 text-sm">
      {notice}
    </p>
  )
}

function SaveStatus({ state }: { state: ReturnType<typeof useEditor.getState>['save'] }) {
  if (state.kind === 'error') {
    return (
      <span role="status" className="text-xs text-signal" title={state.message}>
        Not saved: {state.message}
      </span>
    )
  }
  return (
    <span role="status" className="text-xs text-muted">
      {state.kind === 'pending' ? 'Saving…' : 'Saved'}
    </span>
  )
}
