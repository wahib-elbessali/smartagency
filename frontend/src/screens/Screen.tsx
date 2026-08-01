import type { ReactNode } from 'react'

/** Shared page frame so every screen gets the same heading treatment. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="mb-5 text-xl font-semibold text-slate-100">{title}</h1>
      {children}
    </section>
  )
}
