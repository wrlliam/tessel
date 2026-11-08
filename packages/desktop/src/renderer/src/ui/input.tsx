import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

const field =
  'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none placeholder:text-muted/60 focus:border-glaze aria-invalid:border-signal'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-20 resize-y', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, 'pr-7', className)} {...props} />
}
