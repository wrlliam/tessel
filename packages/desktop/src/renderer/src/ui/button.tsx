import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-glaze font-medium text-ink-900 hover:bg-glaze/90',
        outline: 'border border-line text-text hover:bg-line/50',
        ghost: 'text-muted hover:bg-line/50 hover:text-text',
        danger: 'bg-signal font-medium text-ink-900 hover:bg-signal/90',
      },
      size: { sm: 'h-7 px-2.5', md: 'h-8 px-3', icon: 'size-8' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
)

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button type={type} className={cn(button({ variant, size }), className)} {...props} />
}
