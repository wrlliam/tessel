import type { BlockDescriptor, Graph, GraphEdge, GraphNode, PortDef } from '@tessel/core'

export const uid = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('')}`

export type BlockMap = ReadonlyMap<string, BlockDescriptor>

export interface PortRef {
  nodeId: string
  port: string
}

const portOf = (
  graph: Graph,
  blocks: BlockMap,
  ref: PortRef,
  side: 'inputs' | 'outputs',
): PortDef | undefined => {
  const node = graph.nodes.find((n) => n.id === ref.nodeId)
  return node && blocks.get(node.type)?.[side].find((p) => p.id === ref.port)
}

function reaches(graph: Graph, from: string, target: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of graph.edges) if (e.from.nodeId === id) stack.push(e.to.nodeId)
  }
  return false
}

/** Why a wire can't be made, or null when it can. Mirrors the checks in core's validateGraph. */
export function connectionProblem(
  graph: Graph,
  blocks: BlockMap,
  from: PortRef,
  to: PortRef,
): string | null {
  if (from.nodeId === to.nodeId) return "A block can't connect to itself"
  const out = portOf(graph, blocks, from, 'outputs')
  const inp = portOf(graph, blocks, to, 'inputs')
  if (!out || !inp) return 'Unknown port'
  if (out.kind !== inp.kind) return 'Flow wires and value wires cannot be mixed'
  if (inp.kind === 'value') {
    const a = out.type ?? 'any'
    const b = inp.type ?? 'any'
    if (!(a === b || a === 'any' || b === 'any' || b === 'string'))
      return `Can't connect ${a} to ${b}`
    if (graph.edges.some((e) => e.to.nodeId === to.nodeId && e.to.port === to.port)) {
      return 'That input already has a wire'
    }
  }
  if (graph.edges.some((e) => sameRef(e.from, from) && sameRef(e.to, to)))
    return 'Already connected'
  if (reaches(graph, to.nodeId, from.nodeId)) return 'That wire would make a loop'
  return null
}

const sameRef = (a: PortRef, b: PortRef) => a.nodeId === b.nodeId && a.port === b.port

export interface Clip {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Selected nodes plus the wires between them. */
export function copyNodes(graph: Graph, ids: readonly string[]): Clip {
  const set = new Set(ids)
  return structuredClone({
    nodes: graph.nodes.filter((n) => set.has(n.id)),
    edges: graph.edges.filter((e) => set.has(e.from.nodeId) && set.has(e.to.nodeId)),
  })
}

/** Gives pasted nodes fresh ids and nudges them so they don't sit on top of the originals. */
export function pasteNodes(clip: Clip, offset = 32): Clip {
  const ids = new Map(clip.nodes.map((n) => [n.id, uid('n')]))
  const remap = (ref: PortRef) => ({ nodeId: ids.get(ref.nodeId) ?? ref.nodeId, port: ref.port })
  return {
    nodes: clip.nodes.map((n) => ({
      ...structuredClone(n),
      id: ids.get(n.id) as string,
      position: { x: n.position.x + offset, y: n.position.y + offset },
    })),
    edges: clip.edges.map((e) => ({ id: uid('e'), from: remap(e.from), to: remap(e.to) })),
  }
}

export function removeNodes(
  graph: Graph,
  nodeIds: readonly string[],
  edgeIds: readonly string[] = [],
): Graph {
  const nodes = new Set(nodeIds)
  const edges = new Set(edgeIds)
  return {
    nodes: graph.nodes.filter((n) => !nodes.has(n.id)),
    edges: graph.edges.filter(
      (e) => !edges.has(e.id) && !nodes.has(e.from.nodeId) && !nodes.has(e.to.nodeId),
    ),
  }
}

/** One-line summary shown on a block, e.g. the app name. */
export function summarise(node: GraphNode, block: BlockDescriptor | undefined): string {
  if (!block?.fields) return ''
  const parts: string[] = []
  for (const field of block.fields) {
    const v = node.params[field.key]
    if (
      field.widget === 'condition' ||
      field.widget === 'tile' ||
      field.widget === 'page' ||
      v === undefined ||
      v === ''
    )
      continue
    if (field.when && !field.when.is.includes(String(node.params[field.when.key]))) continue
    if (field.widget === 'toggle') parts.push(`${field.label}: ${v ? 'on' : 'off'}`)
    else if (field.widget === 'select')
      parts.push(field.options?.find((o) => o.value === String(v))?.label ?? String(v))
    else parts.push(String(v))
  }
  return parts.join(' · ')
}
