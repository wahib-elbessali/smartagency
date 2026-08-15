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
      {/* Small, tracked, quiet. A label the same size as its input competes
          with the value the person is trying to read back. */}
      <label htmlFor={id} className="text-ink-3 tracked mb-2 block text-[11px] font-medium">
        {label}
        {required && (
          <span className="text-accent/70 ml-1" aria-hidden>
            *
          </span>
        )}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        className: cn(
          /* Inset rather than outlined: the field is a well cut into the
             surface, which is why it reads as somewhere to type. The inner
             shadow is doing the work a border used to. */
          'rounded-control bg-canvas/60 text-ink placeholder:text-ink-3 ease-soft w-full px-3 py-2.5 text-sm ring-1 transition-all duration-150',
          'shadow-[0_1px_2px_rgb(0_0_0/0.25)_inset]',
          error
            ? 'ring-danger/50 focus:ring-danger'
            : 'ring-line focus:ring-accent/70 focus:bg-canvas/80',
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
