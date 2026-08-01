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
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-ink text-[1.35rem] font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-ink-3 mt-1 text-sm">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}
