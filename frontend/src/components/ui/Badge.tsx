import type { ReactNode } from 'react'
import { cn } from './cn'

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'border-line-strong text-ink-2',
  ok: 'border-ok/40 text-ok',
  warn: 'border-warn/40 text-warn',
  danger: 'border-danger/45 text-danger',
  info: 'border-accent/40 text-accent-ink',
}

/**
 * Status pill. Always takes an icon or a word as well as a tone - colour alone
 * never carries meaning, since a chunk of people can't separate these hues.
 */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
