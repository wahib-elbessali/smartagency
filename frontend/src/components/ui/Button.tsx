import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-canvas font-medium hover:brightness-110 active:brightness-95',
  secondary: 'border border-line-strong bg-panel-2 text-ink hover:border-accent/50 hover:bg-panel',
  ghost: 'text-ink-2 hover:bg-panel-2 hover:text-ink',
  danger: 'border border-danger/45 bg-danger/12 text-danger hover:bg-danger/20',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9.5 px-4 text-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // Default to "button": an unset type inside a form submits it, which on
      // this dashboard could mean firing a hardware command by accident.
      type={type}
      className={cn(
        'ease-soft inline-flex items-center justify-center gap-2 rounded-lg transition-all duration-150',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
