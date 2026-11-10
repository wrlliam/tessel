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
import { CronField } from './fields/CronField.tsx'
import { PagePicker, TilePicker } from './fields/Pickers.tsx'
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
      {(block.fields ?? [])
        .filter((f) => !f.when || f.when.is.includes(text(node.params[f.when.key])))
        .map((f) => (
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
    case 'cron':
      control = (
        <CronField id={id} value={text(value)} placeholder={field.placeholder} onChange={set} />
      )
      break
    case 'page':
      control = (
        <PagePicker id={id} value={text(value)} onChange={set} placeholder={field.placeholder} />
      )
      break
    case 'tile':
      control = (
        <TilePicker id={id} value={text(value)} onChange={set} placeholder={field.placeholder} />
      )
      break
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
      <Field label="Picture" help="Shown instead of the icon, shrunk for phones">
        <div className="flex items-center gap-2">
          {tile.image && (
            <img src={tile.image} alt="" className="size-10 rounded-md object-cover" />
          )}
          <Button
            size="sm"
            onClick={async () => {
              const image = await window.tessel.pickTileImage()
              if (image) updateTile(tile.id, { image })
            }}
          >
            {tile.image ? 'Change…' : 'Choose…'}
          </Button>
          {tile.image && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateTile(tile.id, { image: undefined })}
            >
              Remove
            </Button>
          )}
        </div>
      </Field>
      <Field
        label="Key style"
        htmlFor="tile-style"
        help="Overrides the phone's key style for this tile"
      >
        <Select
          id="tile-style"
          value={tile.style ?? ''}
          onChange={(e) => {
            const v = e.target.value
            updateTile(
              tile.id,
              v ? { style: v as NonNullable<typeof tile.style> } : { style: undefined },
            )
          }}
        >
          <option value="">Same as the phone</option>
          <option value="tinted">Tinted</option>
          <option value="solid">Solid</option>
          <option value="outline">Outline</option>
          <option value="glass">Glass</option>
        </Select>
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
          <DisplayEditor tile={tile} />
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

const DISPLAY_KINDS = [
  { value: '', label: 'Text and icon' },
  { value: 'ring', label: 'Ring gauge' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line chart' },
  { value: 'columns', label: 'Column chart' },
] as const

type Display = NonNullable<Tile['display']>

/** Green, then amber from 70% of the range, red from 90%. */
const trafficLights = (d: Display): Display['zones'] => {
  const at = (f: number) => Math.round((d.min + (d.max - d.min) * f) * 10) / 10
  return [
    { from: d.min, colour: '#1DB954' },
    { from: at(0.7), colour: '#F5B63D' },
    { from: at(0.9), colour: '#F25C6E' },
  ]
}

/** Draws the tile's number as a ring, bar or chart instead of plain text. */
function DisplayEditor({ tile }: { tile: Tile }) {
  const { updateTile } = useEditor.getState()
  const d = tile.display
  const set = (patch: Partial<Display> | undefined, key?: string) =>
    updateTile(
      tile.id,
      patch === undefined
        ? { display: undefined }
        : {
            display: {
              kind: 'ring',
              value: '{{state.reading}}',
              min: 0,
              max: 100,
              unit: '',
              decimals: 0,
              zones: [],
              ...d,
              ...patch,
            },
          },
      key,
    )
  const num = (v: string, fallback: number) =>
    v.trim() === '' || isNaN(Number(v)) ? fallback : Number(v)
  return (
    <Field
      label="Display"
      help={
        d
          ? 'Draws a number from tile state. Wire a value into Show a value, which keeps it as {{state.reading}}. Charts remember each value; tap one on the phone to scroll back.'
          : 'Show a number as a ring, bar or chart, e.g. CPU use or a mic level.'
      }
    >
      <div className="space-y-2">
        <Select
          aria-label="Display"
          value={d?.kind ?? ''}
          onChange={(e) => {
            const v = e.target.value as Display['kind'] | ''
            set(v ? { kind: v } : undefined)
          }}
        >
          {DISPLAY_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        {d && (
          <>
            <Input
              aria-label="Number"
              className="font-mono"
              value={d.value}
              placeholder="{{state.reading}}"
              onChange={(e) => set({ value: e.target.value }, 'display:value')}
            />
            <div className="grid grid-cols-4 gap-2">
              <Field label="Lowest" htmlFor="display-min">
                <Input
                  id="display-min"
                  inputMode="decimal"
                  defaultValue={d.min}
                  key={`min-${tile.id}-${d.min}`}
                  onBlur={(e) => set({ min: num(e.target.value, d.min) })}
                />
              </Field>
              <Field label="Highest" htmlFor="display-max">
                <Input
                  id="display-max"
                  inputMode="decimal"
                  defaultValue={d.max}
                  key={`max-${tile.id}-${d.max}`}
                  onBlur={(e) => set({ max: num(e.target.value, d.max) })}
                />
              </Field>
              <Field label="Unit" htmlFor="display-unit">
                <Input
                  id="display-unit"
                  maxLength={8}
                  value={d.unit}
                  placeholder="%"
                  onChange={(e) => set({ unit: e.target.value }, 'display:unit')}
                />
              </Field>
              <Field label="Decimals" htmlFor="display-decimals">
                <Select
                  id="display-decimals"
                  value={d.decimals}
                  onChange={(e) => set({ decimals: Number(e.target.value) })}
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </Select>
              </Field>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Colour zones, from a value upwards</p>
              {d.zones.map((z, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-xs text-muted">From</span>
                  <Input
                    aria-label="From"
                    inputMode="decimal"
                    className="w-20"
                    defaultValue={z.from}
                    key={`z-${i}-${z.from}`}
                    onBlur={(e) =>
                      set({
                        zones: d.zones.map((x, j) =>
                          j === i ? { ...x, from: num(e.target.value, x.from) } : x,
                        ),
                      })
                    }
                  />
                  <div className="flex gap-1">
                    {TILE_COLOURS.slice(0, 7).map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Colour ${c}`}
                        aria-pressed={z.colour.toLowerCase() === c.toLowerCase()}
                        onClick={() =>
                          set({
                            zones: d.zones.map((x, j) => (j === i ? { ...x, colour: c } : x)),
                          })
                        }
                        className="size-5 rounded-full aria-pressed:ring-2 aria-pressed:ring-text aria-pressed:ring-offset-1 aria-pressed:ring-offset-bg"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-7 shrink-0"
                    aria-label="Remove zone"
                    onClick={() => set({ zones: d.zones.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <div className="flex gap-1">
                {d.zones.length < 6 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      set({
                        zones: [
                          ...d.zones,
                          { from: d.zones.at(-1)?.from ?? d.min, colour: '#F5B63D' },
                        ],
                      })
                    }
                  >
                    <Plus /> Zone
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => set({ zones: trafficLights(d) })}>
                  Green, amber, red
                </Button>
              </div>
            </div>
          </>
        )}
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
