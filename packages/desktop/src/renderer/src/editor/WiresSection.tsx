import type { BlockDescriptor, GraphNode, PortDef, Tile } from '@tessel/core'
import { X } from 'lucide-react'
import { Button } from '../ui/button.tsx'
import { Select } from '../ui/input.tsx'
import { connectionProblem, removeNodes } from './graph-utils.ts'
import { useEditor } from './store.ts'

/** Keyboard-friendly wiring: everything you can do by dragging between ports. */
export function WiresSection({
  tile,
  node,
  block,
}: {
  tile: Tile
  node: GraphNode
  block: BlockDescriptor
}) {
  const blocks = useEditor((s) => s.blocks)
  const { connect, updateGraph } = useEditor.getState()
  const graph = tile.graph
  const nameOf = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    const b = n && blocks.get(n.type)
    const same = graph.nodes.filter((x) => x.type === n?.type)
    return `${b?.name ?? n?.type ?? id}${same.length > 1 ? ` ${same.indexOf(n as GraphNode) + 1}` : ''}`
  }
  const portLabel = (p: PortDef) => p.label ?? p.id

  if (block.outputs.length === 0) return null
  return (
    <section aria-label="Wires" className="space-y-3">
      <h3 className="text-xs text-muted">Wires out</h3>
      {block.outputs.map((out) => {
        const wires = graph.edges.filter((e) => e.from.nodeId === node.id && e.from.port === out.id)
        const targets = graph.nodes.flatMap((n) =>
          (blocks.get(n.type)?.inputs ?? []).flatMap((inp) =>
            connectionProblem(
              graph,
              blocks,
              { nodeId: node.id, port: out.id },
              { nodeId: n.id, port: inp.id },
            ) === null
              ? [{ value: `${n.id}|${inp.id}`, label: `${nameOf(n.id)} › ${portLabel(inp)}` }]
              : [],
          ),
        )
        return (
          <div key={out.id} className="space-y-1.5">
            <p className="text-sm">{portLabel(out)}</p>
            {wires.map((w) => (
              <div key={w.id} className="flex items-center gap-2 text-sm text-muted">
                <span className="min-w-0 flex-1 truncate">
                  → {nameOf(w.to.nodeId)} ›{' '}
                  {blocks
                    .get(graph.nodes.find((n) => n.id === w.to.nodeId)?.type ?? '')
                    ?.inputs.find((p) => p.id === w.to.port)?.label ?? w.to.port}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Remove wire to ${nameOf(w.to.nodeId)}`}
                  onClick={() => updateGraph(tile.id, (g) => removeNodes(g, [], [w.id]))}
                >
                  <X />
                </Button>
              </div>
            ))}
            {targets.length > 0 && (
              <Select
                aria-label={`Connect ${portLabel(out)} to`}
                value=""
                onChange={(e) => {
                  const [nodeId = '', port = ''] = e.target.value.split('|')
                  connect({ nodeId: node.id, port: out.id }, { nodeId, port })
                }}
              >
                <option value="">Connect to…</option>
                {targets.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )
      })}
    </section>
  )
}
