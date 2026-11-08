import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx'
import { groupBlocks } from './blocks-list.ts'
import { blockScore } from './search.ts'
import { useEditor } from './store.ts'
import { CATEGORY } from './theme.ts'

interface Props {
  /** Client coordinates to open at, or null when closed. */
  at: { x: number; y: number } | null
  onPick: (type: string) => void
  onClose: () => void
}

export function AddBlockMenu({ at, onPick, onClose }: Props) {
  const blocks = useEditor((s) => s.blocks)
  return (
    <Popover open={at !== null} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <div
          className="pointer-events-none fixed size-0"
          style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </PopoverAnchor>
      <PopoverContent className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
        <Command
          label="Add block"
          filter={(value, search) => {
            const block = blocks.get(value)
            return block ? blockScore(block.name, block.description, search) : 0
          }}
        >
          <CommandInput placeholder="Add a block…" autoFocus />
          <CommandList>
            <CommandEmpty>No blocks match.</CommandEmpty>
            {groupBlocks(blocks.values()).map(([category, list]) => (
              <CommandGroup key={category} heading={CATEGORY[category].label}>
                {list.map((b) => (
                  <CommandItem key={b.id} value={b.id} onSelect={() => onPick(b.id)}>
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ background: CATEGORY[category].colour }}
                    />
                    <span>{b.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
