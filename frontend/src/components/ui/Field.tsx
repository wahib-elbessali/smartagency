import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * One labelled form control.
 *
 * Exists so every form on the dashboard gets the same label/hint/error rhythm
 * and, more importantly, the same accessibility wiring: the label is bound with
 * htmlFor, the hint and error are referenced by aria-describedby, and an
 * invalid field carries aria-invalid. Hand-rolling that per form is where it
 * quietly stops being done.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
    className: string
  }) => ReactNode
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div>
      <label htmlFor={id} className="text-ink-2 mb-1.5 block text-sm">
        {label}
        {required && (
          <span className="text-ink-3 ml-1" aria-hidden>
            *
          </span>
        )}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        className: cn(
          'border-line bg-panel-2 text-ink placeholder:text-ink-3 ease-soft w-full rounded-lg border px-3 py-2 text-sm transition-colors duration-150',
          error ? 'border-danger/60' : 'focus:border-accent/60',
        ),
      })}

      {hint && !error && (
        <p id={hintId} className="text-ink-3 mt-1.5 text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger mt-1.5 text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
