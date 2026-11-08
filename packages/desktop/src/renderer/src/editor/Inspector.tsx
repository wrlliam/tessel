import {
  osName,
  type BlockDescriptor,
  type Condition,
  type FieldDef,
  type GraphNode,
  type OS,
  type Tile,
} from '@tessel/core'
import { Copy, FolderOpen, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Switch } from '../Switch.tsx'
import { Button } from '../ui/button.tsx'
import { Field } from '../ui/field.tsx'
import { Input, Select, Textarea } from '../ui/input.tsx'
import { ComboField } from './fields/ComboField.tsx'
import { ConditionField } from './fields/ConditionField.tsx'
import { IconPicker } from './IconPicker.tsx'
import { pageOfTile, useEditor } from './store.ts'
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

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

function TileSection({ tile }: { tile: Tile }) {
  const { updateTile, duplicateTile, deleteTile, moveTile, resizeTile, selectPage } =
    useEditor.getState()
  const profile = useEditor((s) => s.profile)
  const page = profile && pageOfTile(profile, tile.id)
  const [confirm, setConfirm] = useState(false)
  const folder =
    tile.kind === 'folder' ? profile?.pages.find((p) => p.id === tile.targetPageId) : undefined
  if (!page) return null

  return (
    <section
      aria-label="Tile"
      className="space-y-4 border-t border-line pt-4 first:border-t-0 first:pt-0"
    >
      <h2 className="font-display text-base font-semibold">{folder ? 'Folder tile' : 'Tile'}</h2>
      {folder && (
        <Button size="sm" variant="primary" onClick={() => selectPage(folder.id)}>
          <FolderOpen /> Open “{folder.name}”
        </Button>
      )}
      <Field label="Label" htmlFor="tile-label">
        <Input
          id="tile-label"
          value={tile.label}
          maxLength={40}
          onChange={(e) => updateTile(tile.id, { label: e.target.value }, 'label')}
        />
      </Field>
      <Field label="Icon">
        <IconPicker
          value={tile.icon ?? ''}
          onChange={(icon) => updateTile(tile.id, icon ? { icon } : { icon: undefined })}
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
      <div className="grid grid-cols-4 gap-2">
        <Field label="Column" htmlFor="tile-col">
          <Select
            id="tile-col"
            value={tile.position.col}
            onChange={(e) => moveTile(tile.id, { ...tile.position, col: Number(e.target.value) })}
          >
            {range(page.cols).map((i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Row" htmlFor="tile-row">
          <Select
            id="tile-row"
            value={tile.position.row}
            onChange={(e) => moveTile(tile.id, { ...tile.position, row: Number(e.target.value) })}
          >
            {range(page.rows).map((i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Wide" htmlFor="tile-w">
          <Select
            id="tile-w"
            value={tile.span.w}
            onChange={(e) => resizeTile(tile.id, { ...tile.span, w: Number(e.target.value) })}
          >
            {range(page.cols).map((i) => (
              <option key={i}>{i + 1}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tall" htmlFor="tile-h">
          <Select
            id="tile-h"
            value={tile.span.h}
            onChange={(e) => resizeTile(tile.id, { ...tile.span, h: Number(e.target.value) })}
          >
            {range(page.rows).map((i) => (
              <option key={i}>{i + 1}</option>
            ))}
          </Select>
        </Field>
      </div>
      {!folder && (
        <>
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
          <BindingsEditor tile={tile} />
        </>
      )}
      <div className="flex gap-2">
        {!folder && (
          <Button size="sm" onClick={() => duplicateTile(tile.id)}>
            <Copy /> Duplicate
          </Button>
        )}
        {confirm ? (
          <>
            <Button size="sm" variant="danger" onClick={() => deleteTile(tile.id)}>
              {folder ? 'Delete folder and its tiles' : 'Delete tile'}
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

const FIELDS = [
  { value: 'label', label: 'Label' },
  { value: 'colour', label: 'Colour' },
  { value: 'icon', label: 'Icon' },
] as const

/** Live appearance: label, colour or icon worked out from variables whenever they change. */
function BindingsEditor({ tile }: { tile: Tile }) {
  const { updateTile } = useEditor.getState()
  const bindings = tile.appearanceBindings
  const set = (next: Tile['appearanceBindings'], key?: string) =>
    updateTile(tile.id, { appearanceBindings: next }, key)
  return (
    <Field
      label="Live appearance"
      help="Shown on the phone instead of the settings above, e.g. Label: Count {{var.count}}. Colour must work out to a value like #F25C6E."
    >
      <div className="space-y-2">
        {bindings.map((b, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Select
              aria-label="Shows"
              className="w-24 shrink-0"
              value={b.field}
              onChange={(e) =>
                set(
                  bindings.map((x, j) =>
                    j === i ? { ...x, field: e.target.value as typeof b.field } : x,
                  ),
                )
              }
            >
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Template"
              className="font-mono"
              value={b.expression}
              placeholder="{{var.status}}"
              onChange={(e) =>
                set(
                  bindings.map((x, j) => (j === i ? { ...x, expression: e.target.value } : x)),
                  `binding:${i}`,
                )
              }
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label="Remove"
              onClick={() => set(bindings.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => set([...bindings, { field: 'label', expression: '' }])}
        >
          <Plus /> Add
        </Button>
      </div>
    </Field>
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
