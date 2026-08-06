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
    <div className="rounded-panel border-line bg-panel shadow-panel ease-soft hover:border-line-strong border px-5 py-4 transition-colors duration-200">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-3 text-xs font-medium tracking-wide uppercase">{label}</span>
        {icon && <span className={cn('shrink-0', accent)}>{icon}</span>}
      </div>
      <div className={cn('tabular mt-2 text-3xl leading-none font-semibold', accent)}>{value}</div>
      {hint && <p className="text-ink-3 mt-1.5 text-xs">{hint}</p>}
    </div>
  )
}
