import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

/**
 * A modal dialog.
 *
 * Uses the native <dialog> element rather than a hand-built overlay, because it
 * brings the hard parts for free: focus is trapped inside, Escape closes it,
 * and the rest of the page is inert to assistive tech. Rebuilding those by hand
 * is where modals usually become unusable by keyboard.
 *
 * The only thing added back is closing on a backdrop click, which <dialog>
 * deliberately leaves to the caller.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        /* Escape fires cancel; let React own the open state rather than the
           DOM, or the two drift apart. */
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      className="border-line bg-panel text-ink shadow-panel m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border p-0 backdrop:bg-black/60"
    >
      <div className="border-line flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-ink text-sm font-semibold">
            {title}
          </h2>
          {description && <p className="text-ink-3 mt-1 text-sm">{description}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  )
}
