import { Command as C } from 'cmdk'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn.ts'

export function Command({ className, ...props }: ComponentProps<typeof C>) {
  return <C className={cn('flex flex-col overflow-hidden', className)} {...props} />
}

export function CommandInput({ className, ...props }: ComponentProps<typeof C.Input>) {
  return (
    <C.Input
      className={cn(
        'border-b border-line bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted/60',
        className,
      )}
      {...props}
    />
  )
}

export function CommandList({ className, ...props }: ComponentProps<typeof C.List>) {
  return <C.List className={cn('max-h-80 overflow-y-auto p-1', className)} {...props} />
}

export function CommandEmpty(props: ComponentProps<typeof C.Empty>) {
  return <C.Empty className="px-3 py-6 text-center text-sm text-muted" {...props} />
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof C.Group>) {
  return (
    <C.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted',
        className,
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: ComponentProps<typeof C.Item>) {
  return (
    <C.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm data-[selected=true]:bg-line',
        className,
      )}
      {...props}
    />
  )
}
