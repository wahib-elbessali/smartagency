import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * A single headline number, with an optional change-since chip under it.
 *
 * `tabular` on the value matters more than it looks: without it the digits are
 * proportionally spaced and the number visibly jitters every time it ticks,
 * which on a wall display reads as the panel flickering.
 *
 * A NOTE ON THE BOX, because this reverses an earlier decision on purpose.
 * These used to be bare fills - no ring, no shadow - on the argument that
 * boxing each reading turns a row of three numbers into a row of three
 * containers. That argument is right in isolation and wrong in a grid: once
 * the tiles sit above real panels, three surfaces with no edge next to one
 * surface with an edge reads as two unrelated systems rather than one. They
 * are cards now, built from exactly the same fill, ring and lit edge as Panel,
 * so the whole screen is one family of objects. What keeps them from becoming
 * loud containers is that nothing inside them is boxed again.
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
  const accent = {
    neutral: 'text-ink',
    ok: 'text-ok',
    warn: 'text-warn',
  }[tone]

  const iconTone = {
    neutral: 'text-ink-3',
    ok: 'text-ok',
    warn: 'text-warn',
  }[tone]

  return (
    <div className="rounded-panel bg-panel surface-lit ring-line/60 ease-soft shadow-panel hover:shadow-raised px-5 py-4 ring-1 transition-[box-shadow,transform] duration-300 hover:-translate-y-px">
      <div className="flex items-start justify-between gap-3">
        <span className="text-ink-3 tracked text-[11px] font-medium">{label}</span>
        {icon && (
          /* The icon sits in its own recessed chip rather than floating on the
             card. Loose in the corner it reads as a stray glyph; given a
             surface it reads as a label for the number, which is what it is. */
          <span
            className={cn(
              'bg-panel-2 ring-line/50 grid size-7 shrink-0 place-items-center rounded-[0.5rem] ring-1',
              iconTone,
            )}
          >
            {icon}
          </span>
        )}
      </div>
      {/* Big, light, and tightly tracked. Weight is what usually gets reached
          for, but at this size a lighter weight with negative tracking reads
          as more deliberate and stays legible from further away. */}
      <div
        className={cn('tabular mt-3 text-[2.25rem] leading-none font-light tracking-tight', accent)}
      >
        {value}
      </div>
      {detail && <div className="mt-2.5">{detail}</div>}
      {hint && <p className="text-ink-3 mt-2 text-xs">{hint}</p>}
    </div>
  )
}
