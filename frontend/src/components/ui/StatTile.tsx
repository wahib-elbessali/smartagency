import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * A single headline number.
 *
 * `tabular` on the value matters more than it looks: without it the digits are
 * proportionally spaced and the number visibly jitters every time it ticks,
 * which on a wall display reads as the panel flickering.
 *
 * LAYOUT IS TWO COLUMNS, not a stack, and that is taken from the design rather
 * than chosen. Label above value on the left, icon chip on the right, and the
 * whole tile only as tall as those two lines. Stacking the icon above the
 * number instead - which is the obvious arrangement - makes each tile twice as
 * tall, and a row of tall tiles pushes the actual content of the screen below
 * the fold on the display this runs on.
 *
 * The icon chip carries a gradient and the tile does not. That is the one
 * place colour is allowed to shout here: the chip is the only saturated thing
 * in the tile, so it reads as an emblem for the reading rather than competing
 * with the number.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ReactNode
  /**
   * Supporting detail under the value - a sparkline, a share, a trend chip.
   * Sits where the eye lands after the number rather than beside it, so the
   * figure is still the first thing read.
   */
  detail?: ReactNode
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  const valueTone = {
    neutral: 'text-ink',
    ok: 'text-ok',
    warn: 'text-warn',
  }[tone]

  /* The chip's gradient follows the reading's tone, so "late arrivals" is not
     wearing the same emblem as "in the building". Neutral gets the accent,
     which is the design's own default for these. */
  const chipGradient = {
    neutral: 'bg-accent-gradient',
    ok: 'bg-[image:var(--gradient-ok)]',
    warn: 'bg-[image:var(--gradient-danger)]',
  }[tone]

  return (
    <div className="rounded-panel surface-glass shadow-panel ease-soft hover:shadow-raised px-5 py-4 transition-[box-shadow,transform] duration-300 hover:-translate-y-px">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-ink-2 block truncate text-[0.8125rem]">{label}</span>
          {/* Big, bold and tight. The design sets these heavy rather than
              light - on a translucent surface a thin numeral loses its edges
              against whatever is showing through behind it. */}
          <div
            className={cn(
              'tabular mt-1 text-[1.75rem] leading-none font-bold tracking-tight',
              valueTone,
            )}
          >
            {value}
          </div>
        </div>

        {icon && (
          <span
            className={cn(
              'text-ink grid size-12 shrink-0 place-items-center rounded-[0.75rem]',
              chipGradient,
            )}
          >
            {icon}
          </span>
        )}
      </div>

      {detail && <div className="mt-3">{detail}</div>}
      {hint && <p className="text-ink-3 mt-2 text-xs">{hint}</p>}
    </div>
  )
}
