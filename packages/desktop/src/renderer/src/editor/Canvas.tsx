import type { Tile } from '@tessel/core'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from '@xyflow/react'
import { Play, Redo2, Square, Undo2 } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { Button } from '../ui/button.tsx'
import { AddBlockMenu } from './AddBlockMenu.tsx'
import { BLOCK_MIME } from './blocks-list.ts'
import { BlockNode, type BlockNodeType } from './BlockNode.tsx'
import { connectionProblem, removeNodes, summarise } from './graph-utils.ts'
import { Palette } from './Palette.tsx'
import { useEditor } from './store.ts'
import { saveNow } from './sync.ts'
import { CATEGORY } from './theme.ts'
import { WireEdge, type WireEdgeType } from './WireEdge.tsx'

const nodeTypes = { block: BlockNode }
const edgeTypes = { wire: WireEdge }

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

type ColorMode = 'system' | 'dark' | 'light'

export function Canvas({ tile, colorMode }: { tile: Tile; colorMode: ColorMode }) {
  return (
    <ReactFlowProvider>
      <CanvasInner key={tile.id} tile={tile} colorMode={colorMode} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ tile, colorMode }: { tile: Tile; colorMode: ColorMode }) {
  const blocks = useEditor((s) => s.blocks)
  const selectedNodeIds = useEditor((s) => s.selectedNodeIds)
  const issues = useEditor((s) => s.issues)
  const runs = useEditor((s) => s.nodeRuns[tile.id])
  const running = useEditor((s) => s.runningTiles[tile.id] === true)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const { updateGraph, selectNodes, addNode, connect, undo, redo } = useEditor.getState()
  const flow = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [hint, setHint] = useState<string>()
  const graph = tile.graph
  const profileId = useEditor((s) => s.profile?.id ?? '')

  // Nodes are derived from the store; only the sizes React Flow measures are kept locally.
  const [measured, setMeasured] = useState<ReadonlyMap<string, { width: number; height: number }>>(
    new Map(),
  )
  const nodes = useMemo(() => {
    const nodeIssue = new Map(issues.filter((i) => i.nodeId).map((i) => [i.nodeId, i.message]))
    return graph.nodes.map((n): BlockNodeType => {
      const block = blocks.get(n.type)
      const size = measured.get(n.id)
      return {
        id: n.id,
        type: 'block',
        position: n.position,
        selected: selectedNodeIds.includes(n.id),
        ...(size && { measured: size }),
        data: {
          type: n.type,
          block,
          summary: summarise(n, block),
          run: runs?.[n.id],
          issue: nodeIssue.get(n.id),
        },
      }
    })
  }, [graph, blocks, selectedNodeIds, issues, runs, measured])

  const edges = useMemo((): WireEdgeType[] => {
    const badEdges = new Set(issues.flatMap((i) => (i.edgeId ? [i.edgeId] : [])))
    return graph.edges.map((e) => {
      const source = graph.nodes.find((n) => n.id === e.from.nodeId)
      const block = source && blocks.get(source.type)
      const port = block?.outputs.find((p) => p.id === e.from.port)
      return {
        id: e.id,
        type: 'wire',
        source: e.from.nodeId,
        sourceHandle: e.from.port,
        target: e.to.nodeId,
        targetHandle: e.to.port,
        selected: selectedEdges.includes(e.id),
        data: {
          colour: block ? CATEGORY[block.category].colour : '#A9B4C2',
          kind: port?.kind ?? 'flow',
          label: port?.kind === 'flow' && port.label ? port.label : undefined,
          problem: badEdges.has(e.id),
        },
      }
    })
  }, [graph, blocks, selectedEdges, issues])

  function onNodesChange(changes: NodeChange<BlockNodeType>[]) {
    const sizes = changes.flatMap((c) =>
      c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions] as const] : [],
    )
    if (sizes.length) setMeasured((m) => new Map([...m, ...sizes]))
    const selection = new Set(selectedNodeIds)
    let selectionChanged = false
    for (const c of changes) {
      if (c.type !== 'select') continue
      selectionChanged = true
      if (c.selected) selection.add(c.id)
      else selection.delete(c.id)
    }
    if (selectionChanged) selectNodes([...selection])
    const moved = new Map<string, { x: number; y: number }>()
    for (const c of changes) if (c.type === 'position' && c.position) moved.set(c.id, c.position)
    if (moved.size) {
      updateGraph(
        tile.id,
        (g) => ({
          ...g,
          nodes: g.nodes.map((n) => ({ ...n, position: moved.get(n.id) ?? n.position })),
        }),
        'move',
      )
    }
  }

  function onEdgesChange(changes: EdgeChange<WireEdgeType>[]) {
    const selection = new Set(selectedEdges)
    for (const c of changes) {
      if (c.type === 'select') {
        if (c.selected) selection.add(c.id)
        else selection.delete(c.id)
      }
    }
    setSelectedEdges([...selection])
  }

  const isValidConnection: IsValidConnection<Edge> = (c) =>
    connectionProblem(graph, blocks, ...refs(c)) === null

  function onConnect(c: Connection) {
    const [from, to] = refs(c)
    const problem = connectionProblem(graph, blocks, from, to)
    if (problem) setHint(problem)
    else connect(from, to)
  }

  function addAt(type: string, client: { x: number; y: number }) {
    addNode(type, flow.screenToFlowPosition(client))
    setMenuAt(null)
    wrapper.current?.focus()
  }

  function addInView(type: string) {
    const box = wrapper.current?.getBoundingClientRect()
    addAt(
      type,
      box ? { x: box.left + box.width / 2 - 112, y: box.top + box.height / 3 } : { x: 0, y: 0 },
    )
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ' && !isEditable(e.target)) {
      e.preventDefault()
      const box = wrapper.current?.getBoundingClientRect()
      setMenuAt(
        pointer.current ??
          (box ? { x: box.left + box.width / 2, y: box.top + box.height / 3 } : { x: 0, y: 0 }),
      )
    }
  }

  function onDrop(e: DragEvent) {
    const type = e.dataTransfer.getData(BLOCK_MIME)
    if (!type) return
    e.preventDefault()
    addAt(type, { x: e.clientX, y: e.clientY })
  }

  async function testRun() {
    if (await saveNow()) await window.tessel.testRun(profileId, tile.id)
  }

  useEffect(() => {
    if (!hint) return
    const id = setTimeout(() => setHint(undefined), 3000)
    return () => clearTimeout(id)
  }, [hint])

  return (
    <div className="flex min-h-0 flex-1">
      <Palette onAdd={addInView} />
      <div
        ref={wrapper}
        tabIndex={0}
        aria-label="Block canvas. Press Space to add a block."
        className="relative min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-glaze focus-visible:ring-inset"
        onKeyDown={onKeyDown}
        onMouseMove={(e: MouseEvent) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onMouseLeave={() => (pointer.current = null)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(BLOCK_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={onDrop}
      >
        <ReactFlow<BlockNodeType, WireEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onDelete={({ nodes: gone, edges: cut }) =>
            updateGraph(tile.id, (g) =>
              removeNodes(
                g,
                gone.map((n) => n.id),
                cut.map((e) => e.id),
              ),
            )
          }
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onPaneContextMenu={(e) => {
            e.preventDefault()
            setMenuAt({ x: e.clientX, y: e.clientY })
          }}
          deleteKeyCode={['Backspace', 'Delete']}
          snapToGrid
          snapGrid={[16, 16]}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
          colorMode={colorMode}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            'node.a11yDescription.default':
              'Press Enter to select, arrow keys to move, Delete to remove.',
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const block = blocks.get((n.data as { type: string }).type)
              return block ? CATEGORY[block.category].colour : '#A9B4C2'
            }}
          />
          <Controls showInteractive={false} />
          <Panel position="top-right" className="flex items-center gap-1.5">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Undo"
              title="Undo (⌘Z)"
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2 />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2 />
            </Button>
            {running ? (
              <Button onClick={() => void window.tessel.stopTile(profileId, tile.id)}>
                <Square /> Stop
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void testRun()} title="Test run (⌘↵)">
                <Play /> Test run
              </Button>
            )}
          </Panel>
          {graph.nodes.length <= 1 && (
            <Panel
              position="bottom-center"
              className="mb-6 rounded-lg bg-surface px-3 py-2 text-sm text-muted"
            >
              Press <kbd className="font-mono text-text">Space</kbd> or right-click to add a block,
              then drag from a port to wire it up.
            </Panel>
          )}
          {hint && (
            <Panel
              position="top-center"
              role="status"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
            >
              {hint}
            </Panel>
          )}
        </ReactFlow>
        <AddBlockMenu
          at={menuAt}
          onPick={(type) => menuAt && addAt(type, menuAt)}
          onClose={() => setMenuAt(null)}
        />
      </div>
    </div>
  )
}

function refs(c: Connection | Edge) {
  return [
    { nodeId: c.source, port: c.sourceHandle ?? '' },
    { nodeId: c.target, port: c.targetHandle ?? '' },
  ] as const
}
