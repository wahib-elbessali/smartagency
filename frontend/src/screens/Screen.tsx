import type { ReactNode } from 'react'

/**
 * Shared page frame, so every screen gets the same heading rhythm.
 *
 * The page name is SMALL - 16px bold, not a display heading. A dashboard is
 * read for its numbers, and a large title at the top of every screen takes
 * vertical space from the thing the person actually came to look at while
 * telling them something they already know, since they clicked the nav item
 * themselves a moment ago.
 *
 * There used to be a breadcrumb above it, repeating the page name as the last
 * crumb. Removed on request: the navigation is one level deep and permanently
 * on screen, so a trail from Home to the item highlighted in the sidebar told
 * nobody anything they could not already see, and it cost a row at the top of
 * every page.
 */
export function Screen({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      {/* Baseline-aligned, not top-aligned: the action sitting on the same
          line as the title is what makes a header read as one row rather than
          two things that happen to be near each other. */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-ink text-base font-bold">{title}</h1>

          {description && <p className="text-ink-2 mt-2 text-[0.8125rem]">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}
