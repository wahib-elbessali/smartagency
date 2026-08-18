import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * The single card surface. Every boxed region on every screen is one of these,
 * so panels can't drift into slightly different greys and radii.
 *
 * A panel is defined by its FILL, its LIT TOP EDGE, and its SHADOW - not by a
 * drawn border. The difference is what separates a designed interface from a
 * wireframe: an outline on every box makes a screen read as a set of
 * containers, while a lifted surface makes it read as one plane with things
 * resting on it. The hairline that remains is barely visible and exists only to
 * keep the top edge from disappearing into the canvas on a dim display.
 *
 * The highlight is the part that is easy to dismiss and worth keeping. A flat
 * fill under a shadow reads as a cut-out; the same fill a few percent brighter
 * along its top edge reads as a solid object under a light. It is the cheapest
 * depth cue available and it costs one gradient.
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
          : cn(
              'bg-panel surface-lit ring-line/60 ring-1',
              /* Lift on hover, don't just brighten. Two pixels of travel plus a
                 deeper shadow reads as the card coming toward you; a colour
                 change alone reads as a state toggle, which is the wrong
                 message for something that is merely being pointed at. */
              'ease-soft hover:shadow-raised transition-[box-shadow,transform] duration-300 hover:-translate-y-px',
            ),
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
 *
 * `action` is the slot on the right. It exists so the affordance for "there is
 * more behind this card" has one shape and one position on every panel instead
 * of each screen inventing its own.
 */
export function PanelHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
