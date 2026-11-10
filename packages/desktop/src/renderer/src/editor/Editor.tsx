import type { KeyStyle } from '@tessel/brand/key'
import type { Appearance, OS, PhoneSettings, TileTemplate } from '@tessel/core'
import { LayoutTemplate, MousePointerClick, RotateCw, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openTel } from './share.ts'
import { Button } from '../ui/button.tsx'
import { Canvas } from './Canvas.tsx'
import { Inspector } from './Inspector.tsx'
import type { Cell } from './layout.ts'
import { PageSettings, PagesPanel } from './PagesPanel.tsx'
import { PhonePreview } from './PhonePreview.tsx'
import { ProfilePanel } from './ProfilePanel.tsx'
import { RunLog } from './RunLog.tsx'
import { findPage, useEditor, useSelectedPage, useSelectedTile } from './store.ts'
import { saveNow, useEditorSync } from './sync.ts'
import { TemplateGallery } from './TemplateGallery.tsx'
import { TileGrid } from './TileGrid.tsx'

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

/** .tel files opened from the system, or dropped on the window, are added after a check. */
function useTelFiles() {
  useEffect(() => {
    const off = window.tessel.onTelOpened((path) => void openTel(path))
    const over = (e: DragEvent) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) =>
        f.name.toLowerCase().endsWith('.tel'),
      )
      if (!file) return
      e.preventDefault()
      void openTel(window.tessel.pathForFile(file))
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      off()
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}

/** Plugins coming or going change the block list; fetch it again. */
function useBlockReload(version: number) {
  useEffect(() => {
    if (version === 0) return
    void window.tessel.getBlocks().then((blocks) => useEditor.getState().setBlocks(blocks))
  }, [version])
}

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

/** How Phone settings › Landscape lays keys out sideways, for the preview's caption. */
const LANDSCAPE: Record<PhoneSettings['landscape'], string> = {
  reflow: 'laid out again in rows to fill the screen',
  fill: 'stretched to fill the screen',
  fit: 'kept square and centred',
  rotate: 'turned so columns become rows',
}

interface Props {
  os: OS
  profiles: Array<{ id: string; name: string }>
  activeProfileId: string
  liveAppearance: Record<string, Appearance>
  liveSeries: Record<string, number[]>
  theme: 'system' | 'dark' | 'light'
  blocksVersion: number
  keyStyle: KeyStyle
  phoneSettings: PhoneSettings
}

export function Editor({
  os,
  profiles,
  activeProfileId,
  liveAppearance,
  liveSeries,
  theme,
  blocksVersion,
  keyStyle,
  phoneSettings,
}: Props) {
  useEditorSync(activeProfileId)
  useTelFiles()
  useBlockReload(blocksVersion)
  useShortcuts(os)
  const profile = useEditor((s) => s.profile)
  const save = useEditor((s) => s.save)
  const tile = useSelectedTile()
  const page = useSelectedPage()
  const [trying, setTrying] = useState(false)
  // 'grid' edits tiles; 'phone' shows the page exactly as the phone draws it, upright or sideways.
  const [view, setView] = useState<'grid' | 'phone'>('grid')
  const [sideways, setSideways] = useState(false)
  const selectedTileId = useEditor((s) => s.selectedTileId)
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
          className="w-[352px] shrink-0 space-y-6 overflow-y-auto border-r border-line p-4"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-base font-medium">Profile</h2>
            <SaveStatus state={save} />
          </div>
          <ProfilePanel profiles={profiles} activeId={activeProfileId} />
          <PagesPanel />
          {page && (
            <section aria-label={`Tiles on ${page.name}`} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3
                  className="min-w-0 truncate text-xs text-muted"
                  title={`Tiles on “${page.name}”`}
                >
                  Tiles
                </h3>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="toggle"
                    aria-pressed={view === 'phone'}
                    aria-label="See it as the phone shows it"
                    title="See it as the phone shows it"
                    onClick={() => setView(view === 'phone' ? 'grid' : 'phone')}
                  >
                    <Smartphone />
                  </Button>
                  <Button
                    size="icon"
                    variant="toggle"
                    aria-pressed={sideways}
                    aria-label="Turn the phone sideways"
                    title="Turn the phone sideways"
                    onClick={() => {
                      setSideways(!sideways)
                      if (!sideways) setView('phone')
                    }}
                  >
                    <RotateCw />
                  </Button>
                  <Button
                    size="sm"
                    variant="toggle"
                    aria-pressed={trying}
                    title="Click tiles to press them, like on the phone"
                    onClick={() => setTrying(!trying)}
                  >
                    <MousePointerClick /> Try
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setGallery({})}>
                    <LayoutTemplate /> Templates
                  </Button>
                </div>
              </div>
              {view === 'phone' ? (
                <>
                  <PhonePreview
                    profile={profile}
                    pageId={page.id}
                    live={live}
                    series={profile.id === activeProfileId ? liveSeries : {}}
                    settings={phoneSettings}
                    sideways={sideways}
                    selectedId={selectedTileId}
                    onSelect={(id) => useEditor.getState().selectTile(id)}
                  />
                  <p className="text-xs text-muted">
                    {sideways
                      ? `Sideways, keys are ${LANDSCAPE[phoneSettings.landscape]} (Phones › Phone settings › Landscape).`
                      : 'As the phone draws it, with its key style, shape and spacing.'}{' '}
                    Click a key to edit it.{' '}
                    <button
                      type="button"
                      className="text-glaze hover:underline"
                      onClick={() => {
                        setView('grid')
                        setSideways(false)
                      }}
                    >
                      Back to moving tiles
                    </button>
                  </p>
                </>
              ) : (
                <TileGrid
                  page={page}
                  live={live}
                  series={profile.id === activeProfileId ? liveSeries : {}}
                  keyStyle={keyStyle}
                  onTemplates={(cell) => setGallery({ cell })}
                  trying={trying}
                />
              )}
              {trying && (
                <p className="text-xs text-muted">
                  Click a tile to press it. Sliders take the spot you click; folders open.
                </p>
              )}
              <Notice />
              {view === 'grid' && (
                <p className="text-xs text-muted">
                  Drag tiles to move them. Drag the corner of the selected tile to resize.
                </p>
              )}
            </section>
          )}
          <PageSettings />
        </aside>
        {tile && tile.kind === 'folder' ? (
          <FolderPanel folderId={tile.targetPageId} />
        ) : tile ? (
          <main aria-label="Blocks canvas" className="flex min-w-0 flex-1 flex-col">
            <Canvas tile={tile} colorMode={theme} />
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
        keyStyle={keyStyle}
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
