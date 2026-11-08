import { TILE_ICON_NAMES, TileIcon } from '@tessel/brand/icons'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx'

export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (icon: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const names = TILE_ICON_NAMES.filter((n) => n.includes(query.trim().toLowerCase()))
  const pick = (icon: string) => {
    onChange(icon)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="w-full justify-start"
        >
          {value ? <TileIcon icon={value} size={16} /> : null}
          <span className={value ? '' : 'text-muted'}>{value || 'No icon'}</span>
        </Button>
      </PopoverAnchor>
      <PopoverContent className="w-72 space-y-2 p-2" aria-label="Choose an icon">
        <Input
          autoFocus
          placeholder="Find an icon, or type an emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              title={n}
              aria-label={n}
              aria-pressed={n === value}
              onClick={() => pick(n)}
              className={cn(
                'flex size-8 items-center justify-center rounded-md hover:bg-line',
                n === value && 'bg-line ring-1 ring-glaze',
              )}
            >
              <TileIcon icon={n} size={16} />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {query && names.length === 0 && [...query.trim()].length <= 2 && (
            <Button size="sm" onClick={() => pick(query.trim())}>
              Use “{query.trim()}”
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => pick('')}>
            No icon
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
