import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

/**
 * Primary is a solid amber block with near-black text. On a dark surface a
 * filled warm button is the only thing that reads as "press this" from across
 * a room - an outlined one disappears into the panel it sits on.
 *
 * Secondary carries no fill and no border, only a faint ring. Two visually
 * competing button styles side by side is the most common way a toolbar ends
 * up looking generated: everything shouts, so nothing leads.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-canvas font-medium shadow-[0_1px_0_rgb(255_255_255/0.18)_inset] hover:brightness-108 active:brightness-95',
  secondary: 'text-ink ring-line-strong hover:bg-panel-2 hover:ring-accent/40 ring-1',
  ghost: 'text-ink-2 hover:bg-panel-2 hover:text-ink',
  danger: 'text-danger ring-danger/40 hover:bg-danger/12 ring-1',
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
        'rounded-control ease-soft inline-flex items-center justify-center gap-2 transition-all duration-150',
        /* A press should be felt. One frame of scale is below the threshold of
           looking like an animation and above the threshold of feeling dead. */
        'active:scale-[0.985]',
        'disabled:pointer-events-none disabled:opacity-40',
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
