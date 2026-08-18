import type { ReactNode } from 'react'

/** Shared page frame, so every screen gets the same heading rhythm. */
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
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* Larger and lighter than before. Weight was carrying the hierarchy;
              size and tracking do it better, and a semibold heading over small
              grey text is the most template-looking pairing there is. */}
          <h1 className="text-ink text-[1.6rem] leading-none font-light">{title}</h1>
          {description && <p className="text-ink-3 mt-2.5 text-[0.8125rem]">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}
