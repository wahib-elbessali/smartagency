import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * The single card surface. Every boxed region on every screen is one of these,
 * so panels can't drift into slightly different greys and radii.
 */
export function Panel({
  children,
  className,
  tone = 'neutral',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  /** `alert` is for the one loud thing on screen, not for every warning. */
  tone?: 'neutral' | 'alert'
  as?: 'div' | 'section' | 'article'
}) {
  return (
    <Tag
      className={cn(
        'rounded-panel border shadow-panel',
        tone === 'alert'
          ? 'border-warn/35 bg-warn/8'
          : 'border-line bg-panel hover:border-line-strong transition-colors duration-200 ease-soft',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export function PanelHeader({ children }: { children: ReactNode }) {
  return <div className="border-line border-b px-5 py-3.5">{children}</div>
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
