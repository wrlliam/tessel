import type { Graph } from '../model.ts'
import { type BlockRegistry, type PortDef } from './block.ts'
import { hasTemplate } from './expression.ts'

export interface GraphIssue {
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
}

const containsTemplate = (v: unknown): boolean =>
  typeof v === 'string'
    ? hasTemplate(v)
    : Array.isArray(v)
      ? v.some(containsTemplate)
      : v !== null && typeof v === 'object'
        ? Object.values(v).some(containsTemplate)
        : false

function typesFit(from: PortDef, to: PortDef): boolean {
  const a = from.type ?? 'any'
  const b = to.type ?? 'any'
  return a === b || a === 'any' || b === 'any' || b === 'string'
}

/** Checks a graph at edit time. The engine refuses to run graphs with errors. */
export function validateGraph(graph: Graph, registry: BlockRegistry): GraphIssue[] {
  const issues: GraphIssue[] = []
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  if (nodes.size !== graph.nodes.length)
    issues.push({ severity: 'error', message: 'Two blocks share an id' })

  // Params fed by a value wire are only known at run time.
  const wired = new Set(graph.edges.map((e) => `${e.to.nodeId}:${e.to.port}`))

  for (const node of graph.nodes) {
    const def = registry.get(node.type)
    if (!def) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        message: `Unknown block "${node.type}". Is its plugin installed?`,
      })
      continue
    }
    if (!containsTemplate(node.params)) {
      const parsed = def.paramsSchema.safeParse(node.params)
      const issue = parsed.error?.issues.find((i) => !wired.has(`${node.id}:${String(i.path[0])}`))
      if (issue) {
        const field = issue?.path.join('.')
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `${def.name}: ${field ? `${field}: ` : ''}${issue?.message ?? 'invalid settings'}`,
        })
      }
    }
  }

  const valueTargets = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from.nodeId)
    const to = nodes.get(edge.to.nodeId)
    if (!from || !to) {
      issues.push({
        severity: 'error',
        edgeId: edge.id,
        message: 'A wire points at a block that no longer exists',
      })
      continue
    }
    const out = registry.get(from.type)?.outputs.find((p) => p.id === edge.from.port)
    const inp = registry.get(to.type)?.inputs.find((p) => p.id === edge.to.port)
    if (!registry.get(from.type) || !registry.get(to.type)) continue
    if (!out || !inp) {
      issues.push({
        severity: 'error',
        edgeId: edge.id,
        message: 'A wire is connected to a port that does not exist',
      })
      continue
    }
    if (out.kind !== inp.kind) {
      issues.push({
        severity: 'error',
        edgeId: edge.id,
        message: 'Flow wires and value wires cannot be mixed',
      })
      continue
    }
    if (inp.kind === 'value') {
      const key = `${to.id}:${inp.id}`
      if (valueTargets.has(key)) {
        issues.push({
          severity: 'error',
          edgeId: edge.id,
          message: 'A value input can only take one wire',
        })
      }
      valueTargets.add(key)
      if (!typesFit(out, inp)) {
        issues.push({
          severity: 'error',
          edgeId: edge.id,
          message: `Can't connect ${out.type} to ${inp.type}`,
        })
      }
    }
    adjacency.set(from.id, [...(adjacency.get(from.id) ?? []), to.id])
  }

  const cycleAt = findCycle(
    graph.nodes.map((n) => n.id),
    adjacency,
  )
  if (cycleAt) {
    issues.push({
      severity: 'error',
      nodeId: cycleAt,
      message: 'Wires form a loop. Use a Repeat block to run something more than once.',
    })
  }

  const hasTrigger = graph.nodes.some((n) => registry.get(n.type)?.trigger)
  if (graph.nodes.length > 0 && !hasTrigger) {
    issues.push({
      severity: 'warning',
      message: 'Add a trigger such as On press, or this tile does nothing',
    })
  }
  return issues
}

function findCycle(ids: string[], adjacency: Map<string, string[]>): string | undefined {
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): string | undefined => {
    const s = state.get(id)
    if (s === 'visiting') return id
    if (s === 'done') return undefined
    state.set(id, 'visiting')
    for (const next of adjacency.get(id) ?? []) {
      const found = visit(next)
      if (found) return found
    }
    state.set(id, 'done')
    return undefined
  }
  for (const id of ids) {
    const found = visit(id)
    if (found) return found
  }
  return undefined
}
