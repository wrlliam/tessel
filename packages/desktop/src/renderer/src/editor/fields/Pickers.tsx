import { Select } from '../../ui/input.tsx'
import { useEditor } from '../store.ts'

interface PickerProps {
  id: string
  value: string
  onChange: (v: string) => void
  /** Label for the empty choice, e.g. "This tile". */
  placeholder?: string | undefined
}

export function PagePicker({ id, value, onChange, placeholder }: PickerProps) {
  const pages = useEditor((s) => s.profile?.pages ?? [])
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder ?? 'Choose…'}</option>
      {pages.map((p) => (
        <option key={p.id} value={p.id}>
          {p.kind === 'folder' ? `Folder: ${p.name}` : p.name}
        </option>
      ))}
    </Select>
  )
}

export function TilePicker({ id, value, onChange, placeholder }: PickerProps) {
  const profile = useEditor((s) => s.profile)
  const current = useEditor((s) => s.selectedTileId)
  const options = (profile?.pages ?? []).flatMap((p) =>
    p.tiles
      .filter((t) => t.kind === 'action' && t.id !== current)
      .map((t) => ({ id: t.id, label: `${p.name} › ${t.label || 'Untitled'}` })),
  )
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder ?? 'Choose…'}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}
