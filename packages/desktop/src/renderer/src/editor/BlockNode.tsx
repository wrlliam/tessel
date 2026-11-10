import type { BlockDescriptor, PortDef } from '@tessel/core'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { cn } from '../lib/cn.ts'
import type { NodeRunState } from './store.ts'
import { CATEGORY, VALUE_COLOUR } from './theme.ts'

export interface BlockNodeData extends Record<string, unknown> {
  type: string
  block: BlockDescriptor | undefined
  summary: string
  run: NodeRunState | undefined
  issue: string | undefined
}

export type BlockNodeType = Node<BlockNodeData, 'block'>

const STATUS_TEXT = { running: 'running', error: 'failed', skipped: 'skipped', idle: '' } as const

function statusText(run: NodeRunState | undefined) {
  if (!run) return ''
  if (run.status === 'ok') return run.ms === undefined ? 'done' : `${run.ms} ms`
  return STATUS_TEXT[run.status]
}

function Port({ port, side }: { port: PortDef; side: 'in' | 'out' }) {
  const flow = port.kind === 'flow'
  return (
    <div
      className={cn(
        'relative flex h-4 items-center px-3 leading-4 text-muted',
        side === 'out' && 'justify-end',
      )}
    >
      {port.label ?? port.id}
      <Handle
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        id={port.id}
        className={flow ? 'port-flow' : 'port-value'}
        style={flow ? undefined : { background: VALUE_COLOUR[port.type ?? 'any'] }}
        aria-label={`${side === 'in' ? 'Input' : 'Output'} ${port.label ?? port.id}${port.type ? ` (${port.type})` : ''}`}
      />
    </div>
  )
}

export function BlockNode({ data, selected }: NodeProps<BlockNodeType>) {
  const { block, run, issue, summary } = data
  if (!block) {
    return (
      <div className="w-56 rounded-xl border border-signal bg-surface p-3 text-xs">
        <p className="font-medium">Unknown block</p>
        <p className="mt-1 font-mono text-muted">{data.type}</p>
      </div>
    )
  }

  const flowIn = block.inputs.find((p) => p.kind === 'flow')
  const valueIns = block.inputs.filter((p) => p.kind === 'value')
  // A single unnamed 'out' sits on the header; named branches (yes / no) get labelled rows.
  const headerOut =
    block.outputs.length > 0 &&
    block.outputs.every((p) => p.kind === 'value' || (p.id === 'out' && !p.label))
      ? block.outputs.find((p) => p.kind === 'flow')
      : undefined
  const outs = block.outputs.filter((p) => p !== headerOut)
  const error = run?.status === 'error' ? run.error : undefined
  const message = error ?? issue

  return (
    <div
      className={cn(
        'w-56 rounded-xl border bg-surface text-xs shadow-sm transition-opacity',
        message ? 'border-signal' : 'border-line',
        selected && 'ring-2 ring-text/70',
        run?.status === 'running' && 'ring-2 ring-glaze',
        run?.status === 'skipped' && 'opacity-45',
      )}
    >
      <div
        className="relative flex items-center gap-2 rounded-t-[11px] px-3 py-1.5 font-medium text-ink-900"
        style={{ background: CATEGORY[block.category].colour }}
      >
        {flowIn && (
          <Handle
            type="target"
            position={Position.Left}
            id={flowIn.id}
            className="port-flow"
            aria-label="Flow input"
          />
        )}
        <span className="truncate">{block.name}</span>
        <span className="ml-auto shrink-0 font-normal">{statusText(run)}</span>
        {headerOut && (
          <Handle
            type="source"
            position={Position.Right}
            id={headerOut.id}
            className="port-flow"
            aria-label="Flow output"
          />
        )}
      </div>
      {summary && <p className="truncate px-3 pt-2 font-mono text-text">{summary}</p>}
      {message && <p className="line-clamp-3 px-3 pt-1.5 text-signal">{message}</p>}
      {(valueIns.length > 0 || outs.length > 0) && (
        <div className="flex justify-between gap-2 py-2">
          <div className="space-y-1.5">
            {valueIns.map((p) => (
              <Port key={p.id} port={p} side="in" />
            ))}
          </div>
          <div className="space-y-1.5">
            {outs.map((p) => (
              <Port key={p.id} port={p} side="out" />
            ))}
          </div>
        </div>
      )}
      {valueIns.length === 0 && outs.length === 0 && !summary && !message && (
        <div className="h-2" />
      )}
    </div>
  )
}
