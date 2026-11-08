import type {
  BlockDescriptor,
  EngineEvent,
  Graph,
  GraphIssue,
  NodeStatus,
  Profile,
  Tile,
} from '@tessel/core'
import { create } from 'zustand'
import { copyNodes, freeCells, pasteNodes, uid, type Clip, type PortRef } from './graph-utils.ts'

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
}

interface EditorActions {
  load(profile: Profile, blocks: BlockDescriptor[]): void
  selectTile(id: string | null): void
  selectNodes(ids: string[]): void
  setIssues(issues: GraphIssue[]): void
  updateTile(tileId: string, patch: Partial<Tile>, coalesceKey?: string): void
  updateGraph(tileId: string, change: (graph: Graph) => Graph, coalesceKey?: string): void
  addTile(cell: { col: number; row: number }): void
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
  applyEngineEvent(event: EngineEvent): void
}

export type Editor = EditorState & EditorActions

const pageOf = (p: Profile, tileId: string) =>
  p.pages.find((pg) => pg.tiles.some((t) => t.id === tileId))

export const findTile = (p: Profile | null, tileId: string | null) =>
  p?.pages.flatMap((pg) => pg.tiles).find((t) => t.id === tileId)

function mapTile(p: Profile, tileId: string, change: (t: Tile) => Tile): Profile {
  return {
    ...p,
    pages: p.pages.map((pg) => ({
      ...pg,
      tiles: pg.tiles.map((t) => (t.id === tileId ? change(t) : t)),
    })),
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
    })
  }

  const selectedGraph = () => findTile(get().profile, get().selectedTileId)?.graph

  return {
    profile: null,
    blocks: new Map(),
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

    load: (profile, blocks) =>
      set({
        profile,
        blocks: new Map(blocks.map((b) => [b.id, b])),
        selectedTileId: profile.pages[0]?.tiles[0]?.id ?? null,
        past: [],
        future: [],
      }),

    selectTile: (id) => set({ selectedTileId: id, selectedNodeIds: [], issues: [] }),
    selectNodes: (ids) => {
      const current = get().selectedNodeIds
      if (ids.length !== current.length || ids.some((id, i) => id !== current[i]))
        set({ selectedNodeIds: ids })
    },
    setIssues: (issues) => set({ issues }),

    updateTile: (tileId, patch, key) => {
      const p = get().profile
      if (p)
        commit(
          mapTile(p, tileId, (t) => ({ ...t, ...patch })),
          key && `${tileId}:${key}`,
        )
    },

    updateGraph: (tileId, change, key) => {
      const p = get().profile
      if (p)
        commit(
          mapTile(p, tileId, (t) => ({ ...t, graph: change(t.graph) })),
          key && `${tileId}:${key}`,
        )
    },

    addTile: (cell) => {
      const p = get().profile
      const page = p?.pages[0]
      if (!p || !page) return
      const id = uid('t')
      const tile: Tile = {
        id,
        label: 'New tile',
        colour: '#212833',
        position: cell,
        span: { w: 1, h: 1 },
        kind: 'action',
        concurrency: 'queue',
        appearanceBindings: [],
        // Every tile starts with a trigger so there's something to wire from.
        graph: {
          nodes: [{ id: uid('n'), type: 'trigger.press', params: {}, position: { x: 0, y: 0 } }],
          edges: [],
        },
      }
      commit({
        ...p,
        pages: p.pages.map((pg) => (pg === page ? { ...pg, tiles: [...pg.tiles, tile] } : pg)),
      })
      set({ selectedTileId: id, selectedNodeIds: [] })
    },

    duplicateTile: (tileId) => {
      const p = get().profile
      const page = p && pageOf(p, tileId)
      const source = findTile(p, tileId)
      const cell = page && freeCells(page)[0]
      if (!p || !page || !source || !cell) return
      const pasted = pasteNodes(
        copyNodes(
          source.graph,
          source.graph.nodes.map((n) => n.id),
        ),
        0,
      )
      const copy: Tile = {
        ...structuredClone(source),
        id: uid('t'),
        label: `${source.label} copy`.slice(0, 40),
        position: cell,
        span: { w: 1, h: 1 },
        graph: pasted,
      }
      commit({
        ...p,
        pages: p.pages.map((pg) => (pg === page ? { ...pg, tiles: [...pg.tiles, copy] } : pg)),
      })
      set({ selectedTileId: copy.id, selectedNodeIds: [] })
    },

    deleteTile: (tileId) => {
      const p = get().profile
      if (!p) return
      commit({
        ...p,
        pages: p.pages.map((pg) => ({ ...pg, tiles: pg.tiles.filter((t) => t.id !== tileId) })),
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

    applyEngineEvent: (e) => {
      const { nodeRuns, runs, runningTiles } = get()
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

  function keepSelectionValid() {
    const { profile, selectedTileId, selectedNodeIds } = get()
    const tile = findTile(profile, selectedTileId)
    if (!tile) return set({ selectedTileId: null, selectedNodeIds: [] })
    const ids = new Set(tile.graph.nodes.map((n) => n.id))
    set({ selectedNodeIds: selectedNodeIds.filter((id) => ids.has(id)) })
  }
})

export const useSelectedTile = () => useEditor((s) => findTile(s.profile, s.selectedTileId))
