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
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '../lib/cn.ts'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx'
import { fits, freeCells, pushAside, type Cell } from './layout.ts'
import { useEditor } from './store.ts'
import { KeyFace, keyVars, type KeyStyle } from '@tessel/brand/key'

const GAP = 8
/** Frame padding and border around the keys. */
const FRAME = 16 * 2 + 2

/** Key size and placement; keys grow or shrink so the page fits the column. */
function geometry(cell: number) {
  const step = cell + GAP
  return {
    CELL: cell,
    STEP: step,
    place: (col: number, row: number, w = 1, h = 1) => ({
      left: col * step,
      top: row * step,
      width: w * step - GAP,
      height: h * step - GAP,
      borderRadius: Math.min(w, h) * cell * 0.2,
    }),
  }
}
const Geometry = createContext(geometry(64))

function fitCell(room: number, cols: number) {
  return Math.max(40, Math.min(76, Math.floor((room - FRAME - GAP * (cols - 1)) / cols)))
}

interface Props {
  page: Page
  live: Record<string, Appearance>
  /** Chart tiles: recent values. */
  series?: Record<string, number[]>
  keyStyle: KeyStyle
  onTemplates: (cell: Cell) => void
  /** Try mode: clicks press tiles like the phone does, instead of selecting them. */
  trying?: boolean
}

/** Phone-shaped preview of a page. Drag tiles to move them; drag the corner of the selected tile to resize. */
export function TileGrid({
  page,
  live,
  series = {},
  keyStyle,
  onTemplates,
  trying = false,
}: Props) {
  const problems = usePageProblems(page)
  const outer = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(288)
  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom(el.clientWidth))
    ro.observe(el)
    setRoom(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const geo = useMemo(() => geometry(fitCell(room, page.cols)), [room, page.cols])
  const { STEP, place } = geo
  const geoRef = useRef(geo)
  useEffect(() => {
    geoRef.current = geo
  }, [geo])
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
  // While a corner is dragged: where the tiles it pushes would go.
  const [pushed, setPushed] = useState<Map<string, Cell>>()
  const grid = useRef<HTMLDivElement>(null)
  // Anchors the slot menu to the clicked cell.
  const anchor = useRef({
    getBoundingClientRect: () => {
      const box = grid.current?.getBoundingClientRect()
      const cell = menuRef.current
      if (!box || !cell) return new DOMRect()
      const g = geoRef.current
      return new DOMRect(box.left + cell.col * g.STEP, box.top + cell.row * g.STEP, g.CELL, g.CELL)
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
    <div ref={outer} className="w-full">
      <Geometry value={geo}>
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
              if (to.col !== tile.position.col || to.row !== tile.position.row)
                moveTile(tile.id, to)
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
                  className="absolute flex flex-col justify-between bg-line p-2 text-[11px] font-medium text-muted"
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
                  tile={t}
                  look={previewLook(t, live[t.id])}
                  problem={problems[t.id]}
                  trying={trying}
                  selected={t.id === selected}
                  running={running[t.id] === true}
                  keyStyle={keyStyle}
                  at={pushed?.get(t.id)}
                  points={series[t.id]}
                  onResizing={(span) => {
                    const moved = pushAside(page, t.id, span)
                    if (moved) setPushed(moved)
                    return moved !== undefined
                  }}
                  onResize={(span) => {
                    setPushed(undefined)
                    resizeTile(t.id, span)
                  }}
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
                          else
                            useEditor.setState({ notice: 'Turn on Allow phones to make a link.' })
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
      </Geometry>
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
  tile: Tile
  look: Appearance
  selected: boolean
  running: boolean
  keyStyle: KeyStyle
  /** Where the tile shows while another tile's resize pushes it. */
  at?: Cell | undefined
  points?: number[] | undefined
  /** A resize in progress; false when that size can't fit, even by pushing tiles aside. */
  onResizing: (span: { w: number; h: number }) => boolean
  onResize: (span: { w: number; h: number }) => void
  onMenu: (x: number, y: number) => void
  onDelete: () => void
  /** Why the tile won't run, if it won't. */
  problem?: string | undefined
  trying?: boolean
}

function GridTile({
  tile,
  look,
  selected,
  running,
  keyStyle,
  at,
  points,
  onResizing,
  onResize,
  onMenu,
  onDelete,
  problem,
  trying = false,
}: TileProps) {
  const { selectTile } = useEditor.getState()
  const { CELL, STEP, place } = useContext(Geometry)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: tile.id })
  const [resize, setResize] = useState<{
    x: number
    y: number
    span: { w: number; h: number }
  } | null>(null)
  const shown = resize ? resize.span : tile.span
  const pos = at ?? tile.position
  const [blocked, setBlocked] = useState(false)

  function startResize(e: ReactPointerEvent) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResize({ x: e.clientX, y: e.clientY, span: tile.span })
  }

  function moveResize(e: ReactPointerEvent) {
    if (!resize) return
    const w = Math.max(1, tile.span.w + Math.round((e.clientX - resize.x) / STEP))
    const h = Math.max(1, tile.span.h + Math.round((e.clientY - resize.y) / STEP))
    if (w === resize.span.w && h === resize.span.h) return
    // Too big even after pushing tiles aside: keep the last size that fit and show a no-entry cursor.
    const ok = onResizing({ w, h })
    setBlocked(!ok)
    if (ok) setResize({ ...resize, span: { w, h } })
  }

  function endResize() {
    if (!resize) return
    setResize(null)
    setBlocked(false)
    onResize(resize.span)
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute',
        isDragging && 'z-10 opacity-80',
        at && 'transition-[left,top] duration-150',
      )}
      style={{
        ...place(pos.col, pos.row, shown.w, shown.h),
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
      }}
    >
      <button
        type="button"
        {...(trying ? {} : listeners)}
        {...attributes}
        role="button"
        aria-pressed={selected}
        aria-label={`${tile.kind === 'folder' ? 'Folder' : 'Tile'} ${look.label || 'Untitled'}${problem ? `, needs fixing: ${problem}` : ''}`}
        onClick={(e) => (trying ? void tryTile(tile, e) : selectTile(tile.id))}
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
          display={tile.display}
          points={points}
        />
      </button>
      {problem && (
        <span
          title={problem}
          aria-hidden
          className="pointer-events-auto absolute -top-1.5 -left-1.5 flex size-4 items-center justify-center rounded-full border-2 border-bg bg-signal text-[10px] leading-none font-semibold text-white"
        >
          !
        </span>
      )}
      {selected && !trying && (
        <div
          role="presentation"
          title="Drag to resize"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className={cn(
            'absolute -right-1.5 -bottom-1.5 size-3.5 rounded-sm border-2 border-bg',
            blocked ? 'cursor-not-allowed bg-signal' : 'cursor-nwse-resize bg-glaze',
          )}
        />
      )}
    </div>
  )
}

/**
 * What the grid shows: your latest edits straight away, with live values only for fields that
 * follow tile state (live appearance), so editing a label isn't hidden by an old live look.
 */
export function previewLook(tile: Tile, live: Appearance | undefined): Appearance {
  const base = {
    label: tile.label,
    colour: tile.colour,
    icon: tile.icon ?? '',
    image: tile.image ?? '',
  }
  if (!live) return base
  const bound = new Set(tile.appearanceBindings.map((b) => b.field))
  return {
    label: bound.has('label') ? live.label : base.label,
    colour: bound.has('colour') ? live.colour : base.colour,
    icon: bound.has('icon') ? live.icon : base.icon,
    // Pictures only change at run time (Set tile appearance), so the live one shows.
    image: live.image || base.image,
    ...(tile.display && live.meter ? { meter: live.meter } : {}),
  }
}

/** Checks every tile on the page in the background; tiles that can't run get a reason. */
function usePageProblems(page: Page): Record<string, string> {
  const [problems, setProblems] = useState<Record<string, string>>({})
  const blocksVersion = useEditor((s) => s.blocks)
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void Promise.all(
        page.tiles
          .filter((t) => t.kind !== 'folder' && t.graph.nodes.length > 0)
          .map(async (t) => {
            const issues = await window.tessel.validateGraph(t.graph)
            const error = issues.find((i) => i.severity === 'error')
            return [t.id, error?.message] as const
          }),
      ).then((found) => {
        if (!live) return
        setProblems(Object.fromEntries(found.filter(([, m]) => m)) as Record<string, string>)
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [page, blocksVersion])
  return problems
}

/** Presses a tile from the editor the way a phone would: folders open, sliders take the spot clicked. */
async function tryTile(
  tile: Tile,
  e: { clientX: number; clientY: number; currentTarget: Element },
) {
  const s = useEditor.getState()
  const profileId = s.profile?.id
  if (!profileId) return
  if (tile.kind === 'folder') {
    if (tile.targetPageId) s.selectPage(tile.targetPageId)
    return
  }
  await saveNow()
  if (tile.kind === 'slider') {
    const box = e.currentTarget.getBoundingClientRect()
    const vertical = box.height > box.width * 1.1
    const raw = vertical
      ? (box.bottom - e.clientY) / box.height
      : (e.clientX - box.left) / box.width
    await window.tessel.trySlide(
      profileId,
      tile.id,
      Math.round(Math.max(0, Math.min(1, raw)) * 100),
    )
    return
  }
  await window.tessel.testRun(profileId, tile.id)
}
