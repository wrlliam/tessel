import {
  osName,
  type BlockDescriptor,
  type Condition,
  type FieldDef,
  type GraphNode,
  type OS,
  type Tile,
} from '@tessel/core'
import { Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Switch } from '../Switch.tsx'
import { Button } from '../ui/button.tsx'
import { Field } from '../ui/field.tsx'
import { Input, Select, Textarea } from '../ui/input.tsx'
import { ComboField } from './fields/ComboField.tsx'
import { ConditionField } from './fields/ConditionField.tsx'
import { useEditor } from './store.ts'
import { WiresSection } from './WiresSection.tsx'
import { CATEGORY, TILE_COLOURS } from './theme.ts'

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v))

export function Inspector({ tile, os }: { tile: Tile; os: OS }) {
  const selected = useEditor((s) => s.selectedNodeIds)
  const blocks = useEditor((s) => s.blocks)
  const node =
    selected.length === 1 ? tile.graph.nodes.find((n) => n.id === selected[0]) : undefined
  const block = node && blocks.get(node.type)

  return (
    <aside
      aria-label="Inspector"
      className="w-80 shrink-0 space-y-6 overflow-y-auto border-l border-line p-4"
    >
      {node && block && (
        <>
          <BlockSection node={node} block={block} os={os} />
          <WiresSection tile={tile} node={node} block={block} />
        </>
      )}
      {selected.length > 1 && (
        <p className="text-sm text-muted">{selected.length} blocks selected.</p>
      )}
      <TileSection tile={tile} />
    </aside>
  )
}

function BlockSection({ node, block, os }: { node: GraphNode; block: BlockDescriptor; os: OS }) {
  const issue = useEditor((s) => s.issues.find((i) => i.nodeId === node.id))
  const unsupported = block.platforms && !block.platforms.includes(os)
  return (
    <section aria-label="Block" className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: CATEGORY[block.category].colour }}
          />
          <h2 className="font-display text-base font-semibold">{block.name}</h2>
        </div>
        <p className="text-sm text-muted">{block.description}</p>
      </header>
      {unsupported && (
        <p className="rounded-lg border border-signal/50 px-3 py-2 text-sm text-signal">
          Not available on {osName[os]}.
        </p>
      )}
      {issue && <p className="text-sm text-signal">{issue.message}</p>}
      {(block.fields ?? []).map((f) => (
        <ParamField key={f.key} field={f} node={node} os={os} />
      ))}
      {block.inputs.some((p) => p.kind === 'value') && (
        <p className="text-xs text-muted">
          A wire into a value input replaces the setting with the same name.
        </p>
      )}
    </section>
  )
}

function ParamField({ field, node, os }: { field: FieldDef; node: GraphNode; os: OS }) {
  const setParam = useEditor((s) => s.setParam)
  const id = `${node.id}-${field.key}`
  const value = node.params[field.key]
  const set = (v: unknown) => setParam(node.id, field.key, v)

  let control
  switch (field.widget) {
    case 'textarea':
      control = (
        <Textarea
          id={id}
          className="font-mono"
          value={text(value)}
          placeholder={field.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      )
      break
    case 'number':
      control = (
        <Input
          id={id}
          className="font-mono"
          inputMode="decimal"
          value={text(value)}
          placeholder={field.placeholder}
          // Numbers stay numbers; anything else (like a template) is kept as text.
          onChange={(e) =>
            set(
              e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value))
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )
      break
    case 'toggle':
      return <Switch label={field.label} checked={value === true} onChange={set} />
    case 'select':
      control = (
        <Select id={id} value={text(value)} onChange={(e) => set(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )
      break
    case 'combo':
      control = (
        <ComboField
          id={id}
          value={text(value)}
          os={os}
          placeholder={field.placeholder}
          onChange={set}
        />
      )
      break
    case 'condition':
      return (
        <Field label={field.label} help={field.help}>
          <ConditionField value={value as Condition} onChange={set} />
        </Field>
      )
    case 'text':
      control = (
        <Input
          id={id}
          className="font-mono"
          value={text(value)}
          placeholder={field.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      )
  }
  return (
    <Field label={field.label} help={field.help} htmlFor={id}>
      {control}
    </Field>
  )
}

const CONCURRENCY: Array<{ value: Tile['concurrency']; label: string }> = [
  { value: 'queue', label: 'Wait, then run again' },
  { value: 'ignore', label: 'Ignore the press' },
  { value: 'restart', label: 'Stop and start over' },
]

function TileSection({ tile }: { tile: Tile }) {
  const { updateTile, duplicateTile, deleteTile } = useEditor.getState()
  const [confirm, setConfirm] = useState(false)
  return (
    <section
      aria-label="Tile"
      className="space-y-4 border-t border-line pt-4 first:border-t-0 first:pt-0"
    >
      <h2 className="font-display text-base font-semibold">Tile</h2>
      <Field label="Label" htmlFor="tile-label">
        <Input
          id="tile-label"
          value={tile.label}
          maxLength={40}
          onChange={(e) => updateTile(tile.id, { label: e.target.value }, 'label')}
        />
      </Field>
      <Field label="Colour">
        <div className="flex flex-wrap items-center gap-1.5">
          {TILE_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={tile.colour.toLowerCase() === c.toLowerCase()}
              onClick={() => updateTile(tile.id, { colour: c })}
              className="size-6 rounded-md border border-line aria-pressed:ring-2 aria-pressed:ring-text"
              style={{ background: c }}
            />
          ))}
          <ColourInput
            value={tile.colour}
            onChange={(c) => updateTile(tile.id, { colour: c }, 'colour')}
          />
        </div>
      </Field>
      <Field label="Pressed while running" htmlFor="tile-concurrency">
        <Select
          id="tile-concurrency"
          value={tile.concurrency}
          onChange={(e) =>
            updateTile(tile.id, { concurrency: e.target.value as Tile['concurrency'] })
          }
        >
          {CONCURRENCY.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => duplicateTile(tile.id)}>
          <Copy /> Duplicate
        </Button>
        {confirm ? (
          <>
            <Button size="sm" variant="danger" onClick={() => deleteTile(tile.id)}>
              Delete tile
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </section>
  )
}

/** Hex field that only commits valid colours, so the tile never holds a broken value. */
function ColourInput({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setDraft(value)
  }
  return (
    <Input
      aria-label="Colour hex"
      className="w-24 font-mono"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value)
      }}
    />
  )
}
