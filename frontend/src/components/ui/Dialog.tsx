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
 *
 * The enter and exit animation lives in index.css, on the element itself.
 *
 * WHAT THIS COMPONENT HAS TO DO FOR THAT ANIMATION TO LOOK RIGHT: hold on to
 * the last content it was given while it closes. Callers render the form
 * conditionally - `{formOpen && <SomeForm />}` - which is correct, since it is
 * how the form resets between opens. But it means that at the moment of
 * closing, the children become null on the very first frame, and without this
 * the dialog would spend its 200ms exit fading out an empty box with a header
 * over it. Freezing the last frame is invisible when it works and glaring when
 * it is missing.
 *
 * Title and description are frozen for the same reason: a caller that derives
 * them from the same state ("Edit employee" vs "Add employee") would otherwise
 * flip the heading mid-exit.
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

  /* The last content shown, kept so the exit animation has something to fade.
     Written during render rather than in an effect because an effect runs a
     frame too late - the empty frame would already have been painted. Writing
     the same value twice under StrictMode's double render is harmless. */
  const shown = useRef<{ title: string; description?: string; children: ReactNode }>({
    title,
    description,
    children,
  })
  if (open) shown.current = { title, description, children }

  const visible = open ? { title, description, children } : shown.current

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    /* close() immediately: the CSS keeps the element displayed until its exit
       transition finishes, so there is nothing to wait for here. */
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
            {visible.title}
          </h2>
          {visible.description && <p className="text-ink-3 mt-1 text-sm">{visible.description}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="px-5 py-4">{visible.children}</div>
    </dialog>
  )
}
