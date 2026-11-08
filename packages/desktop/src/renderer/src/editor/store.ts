import type {
  JsonValue,
  BlockDescriptor,
  Graph,
  GraphIssue,
  NodeStatus,
  Page,
  Profile,
  Tile,
  TileTemplate,
} from '@tessel/core'
import { buildPage, type PageTemplate } from '@tessel/core'
import { create } from 'zustand'
import type { ProfileEngineEvent } from '../../../shared/api.ts'
import { copyNodes, pasteNodes, uid, type Clip, type PortRef } from './graph-utils.ts'
import { fits, foldersUnder, freeCells, type Cell } from './layout.ts'

const HISTORY_LIMIT = 100
/** Edits with the same key inside this window (typing, dragging) undo as one step. */
const COALESCE_MS = 800
const RUN_LOG_LIMIT = 50

export interface NodeRunState {
  status: NodeStatus
  error?: string
  ms?: number
}

export interface RunEntry {
  runId: string
  tileId: string
  at: number
  status?: 'ok' | 'error' | 'cancelled' | 'timeout'
  error?: string
  failedNodeId?: string
  ms?: number
}

export type SaveState = { kind: 'saved' } | { kind: 'pending' } | { kind: 'error'; message: string }

interface EditorState {
  profile: Profile | null
  blocks: Map<string, BlockDescriptor>
  selectedPageId: string | null
  selectedTileId: string | null
  selectedNodeIds: string[]
  issues: GraphIssue[]
  past: Profile[]
  future: Profile[]
  lastEdit?: { key: string; at: number }
  clip: Clip | null
  save: SaveState
  nodeRuns: Record<string, Record<string, NodeRunState>>
  runs: RunEntry[]
  runningTiles: Record<string, true>
  /** A short message about the last edit that couldn't be made. */
  notice?: string
}

interface EditorActions {
  setBlocks(blocks: BlockDescriptor[]): void
  open(profile: Profile): void
  selectPage(id: string): void
  selectTile(id: string | null): void
  selectNodes(ids: string[]): void
  setIssues(issues: GraphIssue[]): void
  setNotice(notice?: string): void
  renameProfile(name: string): void
  /** A blank page, or one filled from a page template. */
  addPage(template?: PageTemplate): void
  updatePage(
    pageId: string,
    patch: Partial<Pick<Page, 'name' | 'cols' | 'rows'>>,
    coalesceKey?: string,
  ): void
  movePage(pageId: string, by: -1 | 1): void
  deletePage(pageId: string): void
  updateTile(tileId: string, patch: Partial<Tile>, coalesceKey?: string): void
  moveTile(tileId: string, to: Cell): void
  resizeTile(tileId: string, span: { w: number; h: number }): void
  updateGraph(tileId: string, change: (graph: Graph) => Graph, coalesceKey?: string): void
  addTile(cell: Cell): void
  addFolder(cell: Cell): void
  /** A slider tile, wired from On slide. */
  addSlider(cell: Cell): void
  /** Adds tiles from a .tel: as a new page, or into free slots on the selected page. */
  addShared(shared: {
    name: string
    page?: { name: string; cols: number; rows: number }
    tiles: Tile[]
    variables: Record<string, JsonValue>
  }): void
  insertTemplate(template: TileTemplate, cell?: Cell): boolean
  duplicateTile(tileId: string): void
  deleteTile(tileId: string): void
  addNode(type: string, position: { x: number; y: number }): void
  setParam(nodeId: string, key: string, value: unknown): void
  connect(from: PortRef, to: PortRef): void
  copy(): void
  paste(): void
  undo(): void
  redo(): void
  setSave(state: SaveState): void
  applyEngineEvent(event: ProfileEngineEvent): void
}

export type Editor = EditorState & EditorActions

const allTiles = (p: Profile) => p.pages.flatMap((pg) => pg.tiles)
export const pageOfTile = (p: Profile, tileId: string) =>
  p.pages.find((pg) => pg.tiles.some((t) => t.id === tileId))
export const findTile = (p: Profile | null, tileId: string | null) =>
  p ? allTiles(p).find((t) => t.id === tileId) : undefined
export const findPage = (p: Profile | null, pageId: string | null) =>
  p?.pages.find((pg) => pg.id === pageId)

function mapTile(p: Profile, tileId: string, change: (t: Tile) => Tile): Profile {
  return {
    ...p,
    pages: p.pages.map((pg) => ({
      ...pg,
      tiles: pg.tiles.map((t) => (t.id === tileId ? change(t) : t)),
    })),
  }
}

function mapPage(p: Profile, pageId: string, change: (pg: Page) => Page): Profile {
  return { ...p, pages: p.pages.map((pg) => (pg.id === pageId ? change(pg) : pg)) }
}

function newTile(cell: Cell, patch: Partial<Tile> = {}): Tile {
  return {
    id: uid('t'),
    label: 'New tile',
    colour: '#212833',
    position: cell,
    span: { w: 1, h: 1 },
    kind: 'action',
    concurrency: 'queue',
    appearanceBindings: [],
    // Every action tile starts with a trigger so there's something to wire from.
    graph: {
      nodes: [{ id: uid('n'), type: 'trigger.press', params: {}, position: { x: 0, y: 0 } }],
      edges: [],
    },
    ...patch,
  }
}

export const useEditor = create<Editor>()((set, get) => {
  /** Applies a change to the profile and records it for undo. */
  function commit(next: Profile, coalesceKey?: string) {
    const { profile, past, lastEdit } = get()
    if (!profile) return
    const now = Date.now()
    const coalesce =
      coalesceKey !== undefined && lastEdit?.key === coalesceKey && now - lastEdit.at < COALESCE_MS
    set({
      profile: next,
      past: coalesce ? past : [...past.slice(-HISTORY_LIMIT + 1), profile],
      future: [],
      lastEdit: coalesceKey === undefined ? undefined : { key: coalesceKey, at: now },
      save: { kind: 'pending' },
      notice: undefined,
    })
  }

  const selectedPage = () => findPage(get().profile, get().selectedPageId)
  const selectedGraph = () => findTile(get().profile, get().selectedTileId)?.graph

  function placeOnSelectedPage(tile: Tile) {
    const p = get().profile
    const page = selectedPage()
    if (!p || !page) return
    commit(mapPage(p, page.id, (pg) => ({ ...pg, tiles: [...pg.tiles, tile] })))
    set({ selectedTileId: tile.id, selectedNodeIds: [] })
  }

  function keepSelectionValid() {
    const { profile, selectedPageId, selectedTileId, selectedNodeIds } = get()
    if (!profile) return
    const page = findPage(profile, selectedPageId) ?? profile.pages[0]
    const tile = page?.tiles.find((t) => t.id === selectedTileId)
    const ids = new Set(tile?.graph.nodes.map((n) => n.id))
    set({
      selectedPageId: page?.id ?? null,
      selectedTileId: tile?.id ?? null,
      selectedNodeIds: selectedNodeIds.filter((id) => ids.has(id)),
    })
  }

  return {
    profile: null,
    blocks: new Map(),
    selectedPageId: null,
    selectedTileId: null,
    selectedNodeIds: [],
    issues: [],
    past: [],
    future: [],
    clip: null,
    save: { kind: 'saved' },
    nodeRuns: {},
    runs: [],
    runningTiles: {},

    setBlocks: (blocks) => set({ blocks: new Map(blocks.map((b) => [b.id, b])) }),

    open: (profile) => {
      const page = profile.pages.find((p) => p.kind === 'page') ?? profile.pages[0]
      set({
        profile,
        selectedPageId: page?.id ?? null,
        selectedTileId: page?.tiles[0]?.id ?? null,
        selectedNodeIds: [],
        issues: [],
        past: [],
        future: [],
        lastEdit: undefined,
        save: { kind: 'saved' },
        nodeRuns: {},
        runningTiles: {},
        notice: undefined,
      })
    },

    selectPage: (id) =>
      set({ selectedPageId: id, selectedTileId: null, selectedNodeIds: [], issues: [] }),
    selectTile: (id) => {
      const page = id && get().profile ? pageOfTile(get().profile as Profile, id) : undefined
      set({
        selectedTileId: id,
        selectedNodeIds: [],
        issues: [],
        ...(page && { selectedPageId: page.id }),
      })
    },
    selectNodes: (ids) => {
      const current = get().selectedNodeIds
      if (ids.length !== current.length || ids.some((id, i) => id !== current[i]))
        set({ selectedNodeIds: ids })
    },
    setIssues: (issues) => set({ issues }),
    setNotice: (notice) => set({ notice }),

    renameProfile: (name) => {
      const p = get().profile
      if (p) commit({ ...p, name }, 'profile-name')
    },

    addPage: (template) => {
      const p = get().profile
      if (!p) return
      const count = p.pages.filter((pg) => pg.kind === 'page').length
      const like = selectedPage()
      const built = template && buildPage(template, uid)
      const page: Page = {
        id: uid('pg'),
        name: template?.name ?? `Page ${count + 1}`,
        kind: 'page',
        cols: template?.cols ?? like?.cols ?? 3,
        rows: template?.rows ?? like?.rows ?? 5,
        tiles: built?.tiles ?? [],
      }
      const variables = { ...built?.variables, ...p.variables }
      commit({ ...p, variables, pages: [...p.pages, page] })
      set({ selectedPageId: page.id, selectedTileId: null, selectedNodeIds: [] })
    },

    updatePage: (pageId, patch, key) => {
      const p = get().profile
      const page = findPage(p, pageId)
      if (!p || !page) return
      const next = { ...page, ...patch }
      if (
        (patch.cols !== undefined || patch.rows !== undefined) &&
        !next.tiles.every((t) => fits({ ...next, tiles: [] }, t.position, t.span))
      ) {
        set({ notice: 'Move or shrink tiles first: some would fall off the grid.' })
        return
      }
      if (
        next.kind === 'folder' &&
        next.tiles.some((t) => t.position.col === 0 && t.position.row === 0)
      )
        return
      commit(
        mapPage(p, pageId, () => next),
        key && `page:${pageId}:${key}`,
      )
    },

    movePage: (pageId, by) => {
      const p = get().profile
      if (!p) return
      const order = p.pages.filter((pg) => pg.kind === 'page')
      const i = order.findIndex((pg) => pg.id === pageId)
      const j = i + by
      if (i < 0 || j < 0 || j >= order.length) return
      ;[order[i], order[j]] = [order[j] as Page, order[i] as Page]
      commit({ ...p, pages: [...order, ...p.pages.filter((pg) => pg.kind === 'folder')] })
    },

    deletePage: (pageId) => {
      const p = get().profile
      const page = findPage(p, pageId)
      if (!p || !page) return
      if (page.kind === 'page' && p.pages.filter((pg) => pg.kind === 'page').length === 1) {
        set({ notice: 'A profile needs at least one page.' })
        return
      }
      const gone = new Set([pageId, ...foldersUnder(p, pageId)])
      commit({
        ...p,
        pages: p.pages
          .filter((pg) => !gone.has(pg.id))
          // Folder tiles that opened a removed folder go too.
          .map((pg) => ({
            ...pg,
            tiles: pg.tiles.filter(
              (t) => !(t.kind === 'folder' && t.targetPageId && gone.has(t.targetPageId)),
            ),
          })),
      })
      set({ selectedPageId: null })
      keepSelectionValid()
    },

    updateTile: (tileId, patch, key) => {
      const p = get().profile
      if (p)
        commit(
          mapTile(p, tileId, (t) => ({ ...t, ...patch })),
          key && `${tileId}:${key}`,
        )
    },

    moveTile: (tileId, to) => {
      const p = get().profile
      const page = p && pageOfTile(p, tileId)
      const tile = findTile(p, tileId)
      if (!p || !page || !tile) return
      if (!fits(page, to, tile.span, tileId)) {
        set({ notice: "That spot isn't free." })
        return
      }
      commit(mapTile(p, tileId, (t) => ({ ...t, position: to })))
    },

    resizeTile: (tileId, span) => {
      const p = get().profile
      const page = p && pageOfTile(p, tileId)
      const tile = findTile(p, tileId)
      if (!p || !page || !tile || (span.w === tile.span.w && span.h === tile.span.h)) return
      if (!fits(page, tile.position, span, tileId)) {
        set({ notice: 'Not enough room to make it that size.' })
        return
      }
      commit(mapTile(p, tileId, (t) => ({ ...t, span })))
    },

    updateGraph: (tileId, change, key) => {
      const p = get().profile
      if (p)
        commit(
          mapTile(p, tileId, (t) => ({ ...t, graph: change(t.graph) })),
          key && `${tileId}:${key}`,
        )
    },

    addTile: (cell) => placeOnSelectedPage(newTile(cell)),

    addShared: (shared) => {
      const p = get().profile
      if (!p) return
      const fresh = shared.tiles.map((t) => ({ ...structuredClone(t), id: uid('t') }))
      const variables = { ...shared.variables, ...p.variables }
      if (shared.page) {
        const page: Page = {
          id: uid('pg'),
          name: shared.page.name,
          kind: 'page',
          cols: shared.page.cols,
          rows: shared.page.rows,
          tiles: [],
        }
        // Keep the shared layout where it fits; anything else goes in the next free slot.
        for (const t of fresh) {
          if (fits(page, t.position, t.span)) page.tiles.push(t)
          else {
            const cell = freeCells(page)[0]
            if (cell) page.tiles.push({ ...t, position: cell, span: { w: 1, h: 1 } })
          }
        }
        commit({ ...p, variables, pages: [...p.pages, page] })
        set({
          selectedPageId: page.id,
          selectedTileId: page.tiles[0]?.id ?? null,
          selectedNodeIds: [],
        })
        return
      }
      const target = selectedPage()
      if (!target) return
      const placed: Tile[] = []
      const page = { ...target, tiles: [...target.tiles] }
      for (const t of fresh) {
        const cell = freeCells(page).find((c) => fits(page, c, t.span)) ?? freeCells(page)[0]
        if (!cell) break
        const span = fits(page, cell, t.span) ? t.span : { w: 1, h: 1 }
        const tile = { ...t, position: cell, span }
        page.tiles.push(tile)
        placed.push(tile)
      }
      if (placed.length < fresh.length)
        set({ notice: `Only ${placed.length} of ${fresh.length} tiles fit on this page.` })
      if (placed.length === 0) return
      commit({ ...mapPage(p, target.id, () => page), variables })
      set({ selectedTileId: placed[0]?.id ?? null, selectedNodeIds: [] })
    },

    addSlider: (cell) =>
      placeOnSelectedPage(
        newTile(cell, {
          label: 'Slider',
          icon: 'sliders-horizontal',
          kind: 'slider',
          concurrency: 'restart',
          graph: {
            nodes: [
              {
                id: uid('n'),
                type: 'trigger.slide',
                params: { min: 0, max: 100, step: 1 },
                position: { x: 0, y: 0 },
              },
            ],
            edges: [],
          },
        }),
      ),

    addFolder: (cell) => {
      const p = get().profile
      const page = selectedPage()
      if (!p || !page) return
      const folder: Page = {
        id: uid('pg'),
        name: 'Folder',
        kind: 'folder',
        cols: page.cols,
        rows: page.rows,
        tiles: [],
      }
      const tile = newTile(cell, {
        label: 'Folder',
        icon: 'folder',
        kind: 'folder',
        targetPageId: folder.id,
        graph: { nodes: [], edges: [] },
      })
      const withTile = mapPage(p, page.id, (pg) => ({ ...pg, tiles: [...pg.tiles, tile] }))
      commit({ ...withTile, pages: [...withTile.pages, folder] })
      set({ selectedTileId: tile.id, selectedNodeIds: [] })
    },

    insertTemplate: (template, cell) => {
      const page = selectedPage()
      const at = cell ?? (page && freeCells(page)[0])
      if (!page || !at) {
        set({ notice: 'This page is full. Free a slot first.' })
        return false
      }
      placeOnSelectedPage(newTile(at, structuredClone(template.tile)))
      return true
    },

    duplicateTile: (tileId) => {
      const p = get().profile
      const page = p && pageOfTile(p, tileId)
      const source = findTile(p, tileId)
      if (!p || !page || !source) return
      if (source.kind === 'folder') {
        set({ notice: "Folders can't be duplicated yet." })
        return
      }
      const cell = freeCells(page)[0]
      if (!cell) {
        set({ notice: 'This page is full. Free a slot first.' })
        return
      }
      const copy: Tile = {
        ...structuredClone(source),
        id: uid('t'),
        label: `${source.label} copy`.slice(0, 40),
        position: cell,
        span: { w: 1, h: 1 },
        graph: pasteNodes(
          copyNodes(
            source.graph,
            source.graph.nodes.map((n) => n.id),
          ),
          0,
        ),
      }
      commit(mapPage(p, page.id, (pg) => ({ ...pg, tiles: [...pg.tiles, copy] })))
      set({ selectedTileId: copy.id, selectedNodeIds: [] })
    },

    deleteTile: (tileId) => {
      const p = get().profile
      const tile = findTile(p, tileId)
      if (!p || !tile) return
      const gone = new Set(
        tile.kind === 'folder' && tile.targetPageId
          ? [tile.targetPageId, ...foldersUnder(p, tile.targetPageId)]
          : [],
      )
      commit({
        ...p,
        pages: p.pages
          .filter((pg) => !gone.has(pg.id))
          .map((pg) => ({ ...pg, tiles: pg.tiles.filter((t) => t.id !== tileId) })),
      })
      set({ selectedTileId: null, selectedNodeIds: [] })
    },

    addNode: (type, position) => {
      const { selectedTileId, blocks } = get()
      if (!selectedTileId) return
      const id = uid('n')
      const params = structuredClone(blocks.get(type)?.defaults ?? {})
      get().updateGraph(selectedTileId, (g) => ({
        ...g,
        nodes: [...g.nodes, { id, type, params, position }],
      }))
      set({ selectedNodeIds: [id] })
    },

    setParam: (nodeId, key, value) => {
      const { selectedTileId } = get()
      if (!selectedTileId) return
      get().updateGraph(
        selectedTileId,
        (g) => ({
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n,
          ),
        }),
        `param:${nodeId}:${key}`,
      )
    },

    connect: (from, to) => {
      const { selectedTileId } = get()
      if (selectedTileId)
        get().updateGraph(selectedTileId, (g) => ({
          ...g,
          edges: [...g.edges, { id: uid('e'), from, to }],
        }))
    },

    copy: () => {
      const graph = selectedGraph()
      const ids = get().selectedNodeIds
      if (graph && ids.length) set({ clip: copyNodes(graph, ids) })
    },

    paste: () => {
      const { clip, selectedTileId } = get()
      if (!clip || !selectedTileId) return
      const pasted = pasteNodes(clip)
      get().updateGraph(selectedTileId, (g) => ({
        nodes: [...g.nodes, ...pasted.nodes],
        edges: [...g.edges, ...pasted.edges],
      }))
      // Paste again offsets further from the last copy.
      set({ clip: pasted, selectedNodeIds: pasted.nodes.map((n) => n.id) })
    },

    undo: () => {
      const { past, profile, future } = get()
      const prev = past.at(-1)
      if (!prev || !profile) return
      set({
        profile: prev,
        past: past.slice(0, -1),
        future: [profile, ...future],
        lastEdit: undefined,
        save: { kind: 'pending' },
      })
      keepSelectionValid()
    },

    redo: () => {
      const { past, profile, future } = get()
      const [next, ...rest] = future
      if (!next || !profile) return
      set({
        profile: next,
        past: [...past, profile],
        future: rest,
        lastEdit: undefined,
        save: { kind: 'pending' },
      })
      keepSelectionValid()
    },

    setSave: (save) => set({ save }),

    applyEngineEvent: ({ profileId, event: e }) => {
      const { nodeRuns, runs, runningTiles, profile } = get()
      if (profileId !== profile?.id) return
      switch (e.type) {
        case 'run:start':
          set({
            nodeRuns: { ...nodeRuns, [e.tileId]: {} },
            runs: [
              ...runs.slice(-RUN_LOG_LIMIT + 1),
              { runId: e.runId, tileId: e.tileId, at: Date.now() },
            ],
            runningTiles: { ...runningTiles, [e.tileId]: true },
          })
          return
        case 'node': {
          const state: NodeRunState = { status: e.status }
          if (e.error !== undefined) state.error = e.error
          if (e.ms !== undefined) state.ms = e.ms
          set({
            nodeRuns: { ...nodeRuns, [e.tileId]: { ...nodeRuns[e.tileId], [e.nodeId]: state } },
          })
          return
        }
        case 'run:end': {
          const { [e.tileId]: _, ...stillRunning } = runningTiles
          set({
            runningTiles: stillRunning,
            runs: runs.map((r) =>
              r.runId === e.runId
                ? {
                    ...r,
                    status: e.status,
                    ms: e.ms,
                    ...(e.error !== undefined && { error: e.error }),
                    ...(e.failedNodeId !== undefined && { failedNodeId: e.failedNodeId }),
                  }
                : r,
            ),
          })
        }
      }
    },
  }
})

export const useSelectedTile = () => useEditor((s) => findTile(s.profile, s.selectedTileId))
export const useSelectedPage = () => useEditor((s) => findPage(s.profile, s.selectedPageId))
