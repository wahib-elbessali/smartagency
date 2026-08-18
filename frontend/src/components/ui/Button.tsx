import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'
type Shape = 'control' | 'pill'

/**
 * Primary is a filled violet block with white text. On a dark surface a filled
 * saturated button is the only thing that reads as "press this" from across a
 * room - an outlined one disappears into the panel it sits on.
 *
 * The label is white rather than the near-black it used to be. That is not a
 * style preference: the accent moved from amber to violet, and amber is light
 * enough to carry dark text while this violet is not. Leaving it dark would
 * have left the primary action as the least readable text on the screen.
 *
 * The fill is a shallow gradient rather than a flat colour, and it is the ONLY
 * gradient in the system. That restraint is the point: one gradient reads as
 * the primary action having been given special treatment, while a screen of
 * them reads as a theme applied to everything. The two stops are close enough
 * together that it registers as a lit surface rather than as a colour ramp.
 *
 * Secondary carries no fill and no border, only a faint ring. Two visually
 * competing button styles side by side is the most common way a toolbar ends
 * up looking generated: everything shouts, so nothing leads.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent bg-accent-gradient text-ink font-medium shadow-[0_1px_0_rgb(255_255_255/0.22)_inset] hover:brightness-112 active:brightness-95',
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
  /** `pill` for filter and range controls, which read as settings not actions. */
  shape?: Shape
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  shape = 'control',
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
        'ease-soft inline-flex items-center justify-center gap-2 transition-all duration-150',
        shape === 'pill' ? 'rounded-pill' : 'rounded-control',
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

/**
 * The small round control in a panel header - "there is more behind this card".
 *
 * Square-ish would be wrong here. A circle at this size reads as a marker
 * rather than as a miniature button, which is what keeps eight of them across a
 * dashboard from looking like a toolbar that escaped.
 *
 * `label` is required rather than optional because this never contains text,
 * and an icon-only control with no accessible name is invisible to anyone not
 * looking at it.
 */
export function IconButton({
  label,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'text-ink-3 ring-line/70 hover:text-ink hover:bg-panel-2 hover:ring-line-strong ease-soft grid size-7 place-items-center rounded-full ring-1 transition-all duration-150 active:scale-95',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
