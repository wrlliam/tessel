import { Popover as P } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

export const Popover = P.Root
export const PopoverAnchor = P.Anchor
export const PopoverTrigger = P.Trigger

export function PopoverContent({ className, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align="start"
        sideOffset={4}
        className={cn(
          'z-50 rounded-xl border border-line bg-surface shadow-lg outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  )
}
