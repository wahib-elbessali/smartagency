import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * A single headline number.
 *
 * `tabular` on the value matters more than it looks: without it the digits are
 * proportionally spaced and the number visibly jitters every time it ticks,
 * which on a wall display reads as the panel flickering.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ReactNode
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  const accent = {
    neutral: 'text-ink-2',
    ok: 'text-ok',
    warn: 'text-warn',
  }[tone]

  return (
    /* No panel, no border, no shadow. A stat tile is a number with a caption,
       and boxing each one turns a row of three readings into a row of three
       containers - the containers become the pattern the eye follows instead
       of the numbers. The lighter fill is enough to group them. */
    <div className="rounded-panel bg-panel/60 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-3 tracked text-[11px] font-medium">{label}</span>
        {icon && <span className={cn('shrink-0', accent)}>{icon}</span>}
      </div>
      {/* Big, light, and tightly tracked. Weight is what usually gets reached
          for, but at this size a lighter weight with negative tracking reads
          as more deliberate and stays legible from further away. */}
      <div
        className={cn('tabular mt-2.5 text-[2rem] leading-none font-light tracking-tight', accent)}
      >
        {value}
      </div>
      {hint && <p className="text-ink-3 mt-2 text-xs">{hint}</p>}
    </div>
  )
}
