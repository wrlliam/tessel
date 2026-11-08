import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'

export interface WireData extends Record<string, unknown> {
  colour: string
  kind: 'flow' | 'value'
  label: string | undefined
  problem: boolean
}

export type WireEdgeType = Edge<WireData, 'wire'>

export function WireEdge(props: EdgeProps<WireEdgeType>) {
  const { id, data, selected } = props
  const [path, labelX, labelY] = getBezierPath(props)
  const colour = data?.problem ? 'var(--signal)' : (data?.colour ?? 'var(--muted)')
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: colour,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: data?.kind === 'value' ? '6 4' : undefined,
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] text-text"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
