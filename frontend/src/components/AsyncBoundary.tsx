import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ApiError, describeApiError } from '@/api/errors'

/**
 * Loading / empty / error, in one place.
 *
 * Playbook 2 and 9: every screen needs all three, and hand-rolling them six
 * times is where the bugs live. Empty is a real answer and is styled like one -
 * it must not look like a screen that failed to load.
 */

interface AsyncBoundaryProps {
  isPending: boolean
  error: unknown
  /** True when the request succeeded but there is nothing to show. */
  isEmpty?: boolean
  /** What "nothing" means here, e.g. "No visitors waiting". */
  emptyMessage?: string
  onRetry?: () => void
  children: ReactNode
}

export function AsyncBoundary({
  isPending,
  error,
  isEmpty = false,
  emptyMessage = 'Nothing to show.',
  onRetry,
  children,
}: AsyncBoundaryProps) {
  if (isPending) {
    return (
      <div className="flex items-center gap-3 p-8 text-slate-400" role="status" aria-live="polite">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span>Loading…</span>
      </div>
    )
  }

  if (error) {
    const message =
      error instanceof ApiError ? describeApiError(error) : 'Something went wrong loading this.'

    return (
      <div
        className="flex flex-col items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-6"
        role="alert"
      >
        <div className="flex items-center gap-2 font-medium text-amber-200">
          <AlertTriangle className="size-5" aria-hidden />
          <span>Could not load this panel</span>
        </div>
        <p className="text-sm text-amber-100/80">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-amber-400/50 px-3 py-1.5 text-sm text-amber-100 transition-colors hover:bg-amber-400/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  if (isEmpty) {
    return <p className="p-8 text-slate-400">{emptyMessage}</p>
  }

  return <>{children}</>
}
