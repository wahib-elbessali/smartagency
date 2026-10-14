import { useEffect, useState } from 'react'
import { Field } from './ui/Field'

/* Both photo routes refuse more with a 413 (MAX_WANTED_IMAGE_BYTES and
   MAX_FACE_IMAGE_BYTES in backend/app/api). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

/** What the backend would refuse, said before the upload rather than after. */
export function photoError(file: File | null): string | undefined {
  if (!file) return undefined
  if (!file.type.startsWith('image/')) return 'Choose an image file.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_PHOTO_BYTES) return 'The photo must be 10 MB or smaller.'
  return undefined
}

/**
 * One photo of one face, for the two enrollment flows - employee face
 * recognition and the wanted watchlist. They are separate galleries on
 * purpose, but picking the photo is the same act, so it is one control.
 *
 * The preview is local only (an object URL, revoked when replaced) - the
 * photo leaves the browser only with the form's submit, and nothing on the
 * backend ever sends it back.
 */
export function PhotoField({
  id,
  label,
  file,
  onChange,
  hint,
  required,
}: {
  id: string
  label: string
  file: File | null
  onChange: (file: File | null) => void
  hint: string
  required?: boolean
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file || photoError(file)) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const error = photoError(file)

  return (
    <div>
      <Field id={id} label={label} hint={hint} error={error} required={required}>
        {(props) => (
          <input
            {...props}
            type="file"
            accept="image/*"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        )}
      </Field>
      {preview && (
        <img
          src={preview}
          alt="The photo you chose"
          className="border-line mt-3 h-32 w-32 rounded-lg border object-cover"
        />
      )}
    </div>
  )
}
