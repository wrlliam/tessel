import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from '@dnd-kit/core'
import type { Appearance, Page, Tile } from '@tessel/core'
import {
  Copy,
  FileInput,
  Link,
  Folder,
  LayoutTemplate,
  Plus,
  Share,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { openTel, shareTiles } from './share.ts'
import { ShortcutDialog } from './ShortcutDialog.tsx'
import { saveNow } from './sync.ts'
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx'
import { fits, freeCells, type Cell } from './layout.ts'
import { useEditor } from './store.ts'
import { KeyFace, keyVars, type KeyStyle } from '@tessel/brand/key'

const CELL = 64
const GAP = 8
const STEP = CELL + GAP

const place = (col: number, row: number, w = 1, h = 1) => ({
  left: col * STEP,
  top: row * STEP,
  width: w * STEP - GAP,
  height: h * STEP - GAP,
  borderRadius: Math.min(w, h) * CELL * 0.2,
})

interface Props {
  page: Page
  live: Record<string, Appearance>
  keyStyle: KeyStyle
  onTemplates: (cell: Cell) => void
}

/** Phone-shaped preview of a page. Drag tiles to move them; drag the corner of the selected tile to resize. */
export function TileGrid({ page, live, keyStyle, onTemplates }: Props) {
  const selected = useEditor((s) => s.selectedTileId)
  const running = useEditor((s) => s.runningTiles)
  const { moveTile, resizeTile, addTile, addFolder, addSlider, duplicateTile, deleteTile } =
    useEditor.getState()
  const [shortcut, setShortcut] = useState<{
    label: string
    link: { urls: string[]; qr: string }
  }>()
  const [tileMenu, setTileMenu] = useState<{ tileId: string; x: number; y: number }>()
  const tileAnchor = useRef({
    getBoundingClientRect: () =>
      new DOMRect(tileMenuRef.current?.x ?? 0, tileMenuRef.current?.y ?? 0, 0, 0),
  })
  const tileMenuRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [ghost, setGhost] = useState<{
    col: number
    row: number
    w: number
    h: number
    ok: boolean
  }>()
  const [menu, setMenu] = useState<Cell>()
  const grid = useRef<HTMLDivElement>(null)
  // Anchors the slot menu to the clicked cell.
  const anchor = useRef({
    getBoundingClientRect: () => {
      const box = grid.current?.getBoundingClientRect()
      const cell = menuRef.current
      if (!box || !cell) return new DOMRect()
      return new DOMRect(box.left + cell.col * STEP, box.top + cell.row * STEP, CELL, CELL)
    },
  })
  const menuRef = useRef<Cell | undefined>(undefined)
  const openMenu = (cell: Cell) => {
    menuRef.current = cell
    setMenu(cell)
  }

  const target = (tile: Tile, dx: number, dy: number) => ({
    col: tile.position.col + Math.round(dx / STEP),
    row: tile.position.row + Math.round(dy / STEP),
  })

  function onDragMove(e: DragMoveEvent) {
    const tile = page.tiles.find((t) => t.id === e.active.id)
    if (!tile) return
    const to = target(tile, e.delta.x, e.delta.y)
    setGhost({ ...to, w: tile.span.w, h: tile.span.h, ok: fits(page, to, tile.span, tile.id) })
  }

  return (
    <div className="mx-auto w-fit rounded-[32px] border border-line bg-bg p-4">
      <DndContext
        sensors={sensors}
        // The column scrolling under a drag would add to the drop distance.
        autoScroll={false}
        onDragMove={onDragMove}
        onDragCancel={() => setGhost(undefined)}
        onDragEnd={(e) => {
          setGhost(undefined)
          const tile = page.tiles.find((t) => t.id === e.active.id)
          if (!tile) return
          const to = target(tile, e.delta.x, e.delta.y)
          if (to.col !== tile.position.col || to.row !== tile.position.row) moveTile(tile.id, to)
        }}
      >
        <div
          ref={grid}
          className="relative"
          style={{ width: page.cols * STEP - GAP, height: page.rows * STEP - GAP }}
        >
          {freeCells(page).map(({ col, row }) => (
            <button
              key={`${col},${row}`}
              type="button"
              aria-label={`Add something in row ${row + 1}, column ${col + 1}`}
              onClick={() => openMenu({ col, row })}
              className="absolute flex items-center justify-center border border-dashed border-line text-muted/0 hover:border-muted hover:text-muted focus-visible:text-muted"
              style={place(col, row)}
            >
              <Plus className="size-4" />
            </button>
          ))}
          {page.kind === 'folder' && (
            <div
              aria-label="Back tile, added by the phone"
              className="absolute flex flex-col justify-between bg-line p-2 text-[11px] font-semibold text-muted"
              style={place(0, 0)}
            >
              <span aria-hidden>←</span>
              Back
            </div>
          )}
          {ghost && (
            <div
              aria-hidden
              className={cn(
                'absolute border-2 border-dashed',
                ghost.ok ? 'border-glaze' : 'border-signal',
              )}
              style={place(ghost.col, ghost.row, ghost.w, ghost.h)}
            />
          )}
          {page.tiles.map((t) => (
            <GridTile
              key={t.id}
              page={page}
              tile={t}
              look={live[t.id] ?? { label: t.label, colour: t.colour, icon: t.icon ?? '' }}
              selected={t.id === selected}
              running={running[t.id] === true}
              keyStyle={keyStyle}
              onResize={(span) => resizeTile(t.id, span)}
              onMenu={(x, y) => {
                tileMenuRef.current = { x, y }
                setTileMenu({ tileId: t.id, x, y })
              }}
              onDelete={() => deleteTile(t.id)}
            />
          ))}
        </div>
      </DndContext>
      <Popover open={menu !== undefined} onOpenChange={(open) => !open && setMenu(undefined)}>
        <PopoverAnchor virtualRef={anchor} />
        <PopoverContent className="w-48 p-1" aria-label="Add to this slot">
          {menu && (
            <>
              <MenuItem
                onClick={() => {
                  addTile(menu)
                  setMenu(undefined)
                }}
              >
                <Plus /> Blank tile
              </MenuItem>
              {page.kind === 'page' && (
                <MenuItem
                  onClick={() => {
                    addFolder(menu)
                    setMenu(undefined)
                  }}
                >
                  <Folder /> Folder
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  addSlider(menu)
                  setMenu(undefined)
                }}
              >
                <SlidersHorizontal /> Slider
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onTemplates(menu)
                  setMenu(undefined)
                }}
              >
                <LayoutTemplate /> From a template…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(undefined)
                  void openTel()
                }}
              >
                <FileInput /> From a .tel file…
              </MenuItem>
            </>
          )}
        </PopoverContent>
      </Popover>
      {shortcut && (
        <ShortcutDialog
          label={shortcut.label}
          link={shortcut.link}
          onClose={() => setShortcut(undefined)}
        />
      )}
      <Popover
        open={tileMenu !== undefined}
        onOpenChange={(open) => !open && setTileMenu(undefined)}
      >
        <PopoverAnchor virtualRef={tileAnchor} />
        <PopoverContent className="w-44 p-1" align="start" aria-label="Tile actions">
          {tileMenu && (
            <>
              <MenuItem
                onClick={() => {
                  duplicateTile(tileMenu.tileId)
                  setTileMenu(undefined)
                }}
              >
                <Copy /> Duplicate
              </MenuItem>
              <MenuItem
                onClick={() => {
                  const tile = page.tiles.find((t) => t.id === tileMenu.tileId)
                  if (tile) void shareTiles(tile.label || 'Tile', [tile])
                  setTileMenu(undefined)
                }}
              >
                <Share /> Share as .tel…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  const tile = page.tiles.find((t) => t.id === tileMenu.tileId)
                  const profileId = useEditor.getState().profile?.id
                  setTileMenu(undefined)
                  if (!tile || !profileId) return
                  void saveNow()
                    .then(() => window.tessel.createShortcut(profileId, tile.id))
                    .then((link) => {
                      if (link) setShortcut({ label: tile.label || 'Tile', link })
                      else useEditor.setState({ notice: 'Turn on Allow phones to make a link.' })
                    })
                }}
              >
                <Link /> Shortcut link…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  deleteTile(tileMenu.tileId)
                  setTileMenu(undefined)
                }}
              >
                <Trash2 /> Delete
              </MenuItem>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-line [&_svg]:size-4"
    >
      {children}
    </button>
  )
}

interface TileProps {
  page: Page
  tile: Tile
  look: Appearance
  selected: boolean
  running: boolean
  keyStyle: KeyStyle
  onResize: (span: { w: number; h: number }) => void
  onMenu: (x: number, y: number) => void
  onDelete: () => void
}

function GridTile({
  page,
  tile,
  look,
  selected,
  running,
  keyStyle,
  onResize,
  onMenu,
  onDelete,
}: TileProps) {
  const { selectTile } = useEditor.getState()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: tile.id })
  const [resize, setResize] = useState<{
    x: number
    y: number
    span: { w: number; h: number }
  } | null>(null)
  const shown = resize ? resize.span : tile.span

  function startResize(e: ReactPointerEvent) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResize({ x: e.clientX, y: e.clientY, span: tile.span })
  }

  function moveResize(e: ReactPointerEvent) {
    if (!resize) return
    const w = Math.max(1, tile.span.w + Math.round((e.clientX - resize.x) / STEP))
    const h = Math.max(1, tile.span.h + Math.round((e.clientY - resize.y) / STEP))
    if (
      (w !== resize.span.w || h !== resize.span.h) &&
      fits(page, tile.position, { w, h }, tile.id)
    ) {
      setResize({ ...resize, span: { w, h } })
    }
  }

  function endResize() {
    if (!resize) return
    setResize(null)
    onResize(resize.span)
  }

  return (
    <div
      ref={setNodeRef}
      className={cn('absolute', isDragging && 'z-10 opacity-80')}
      style={{
        ...place(tile.position.col, tile.position.row, shown.w, shown.h),
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
      }}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        role="button"
        aria-pressed={selected}
        aria-label={`${tile.kind === 'folder' ? 'Folder' : 'Tile'} ${look.label || 'Untitled'}`}
        onClick={() => selectTile(tile.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          selectTile(tile.id)
          onMenu(e.clientX, e.clientY)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            onDelete()
          }
        }}
        data-pressed={running}
        className={cn('key size-full', selected && 'outline-2 outline-offset-2 outline-glaze')}
        style={{ borderRadius: 'inherit', ...keyVars(look.colour, tile.style ?? keyStyle) }}
      >
        <KeyFace
          look={look}
          size={Math.min(shown.w, shown.h) * CELL}
          labelSize="small"
          folder={tile.kind === 'folder'}
        />
      </button>
      {selected && (
        <div
          role="presentation"
          title="Drag to resize"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border-2 border-bg bg-glaze"
        />
      )}
    </div>
  )
}
