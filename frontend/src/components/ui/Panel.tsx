import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * The single card surface. Every boxed region on every screen is one of these,
 * so panels can't drift into slightly different greys and radii.
 *
 * A panel is defined by its FILL and its SHADOW, not by a drawn border. The
 * difference is what separates a designed interface from a wireframe: an
 * outline on every box makes a screen read as a set of containers, while a
 * lifted surface makes it read as one plane with things resting on it. The
 * hairline that remains is barely visible and exists only to keep the top edge
 * from disappearing into the canvas on a dim display.
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
        'rounded-panel shadow-panel',
        tone === 'alert'
          ? /* An alert panel earns a real border. It is the one case where the
               outline is the point rather than decoration. */
            'border-warn/30 bg-warn/6 border'
          : 'bg-panel ring-line/60 ease-soft ring-1 transition-shadow duration-300 hover:shadow-raised',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

/**
 * A panel header, separated by space rather than a rule.
 *
 * The old version drew a line under every header. Removing it and letting the
 * padding do the separating is most of why this now reads as quieter - a rule
 * is a strong signal, and spending one on "here is a title" leaves nothing
 * left for the divisions that actually matter.
 */
export function PanelHeader({ children }: { children: ReactNode }) {
  return <div className="px-5 pt-4 pb-1">{children}</div>
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
