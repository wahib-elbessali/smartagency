import { useState, type FormEvent } from 'react'
import type { Camera, CameraCreate } from '@/api/types'
import { ApiError, describeApiError } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Create / edit form for one camera.
 *
 * Two fields, both required, same shape for POST and PUT - so like
 * ServiceForm there is no create-vs-edit split, only the submit label. The
 * name deserves the one hint on this form: it is not a label for people, it
 * is the identifier the AI service files detections under, and a camera the
 * detector knows by another name never appears on the Alerts screen.
 */

export type CameraFormValues = CameraCreate

function initialValues(camera: Camera | null): CameraFormValues {
  return {
    name: camera?.name ?? '',
    stream_url: camera?.stream_url ?? '',
  }
}

/** Matches Field(min_length=1, max_length=150) on name. */
function nameError(value: string, touched: boolean): string | undefined {
  if (!touched) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return 'Required.'
  if (trimmed.length > 150) return 'At most 150 characters.'
  return undefined
}

/** Matches Field(min_length=1, max_length=500) on stream_url. */
function streamUrlError(value: string, touched: boolean): string | undefined {
  if (!touched) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return 'Required.'
  if (trimmed.length > 500) return 'At most 500 characters.'
  return undefined
}

/**
 * Refusals verified against backend/app/api/cameras.py:
 *   409  name already used by a camera at any branch (unique site-wide)
 *   403  the camera or branch belongs to another agency
 *   404  the branch no longer exists
 */
function saveErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'Could not save.'

  switch (error.status) {
    case 409:
      return 'A camera with that name already exists, possibly at another branch. Names are unique across all branches because the detector knows cameras by name.'
    case 403:
      return 'That camera belongs to another branch.'
    case 404:
      return 'That branch no longer exists.'
    case 422:
      return 'The server rejected one of these values. Both fields are required and have a maximum length.'
    default:
      return describeApiError(error)
  }
}

export function CameraForm({
  camera,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  camera: Camera | null
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (values: CameraFormValues) => void
}) {
  const editing = camera !== null
  const [values, setValues] = useState(() => initialValues(camera))
  const [touched, setTouched] = useState(false)

  const set = <K extends keyof CameraFormValues>(key: K, value: CameraFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const invalid =
    nameError(values.name, true) !== undefined ||
    streamUrlError(values.stream_url, true) !== undefined

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (invalid) return

    onSubmit({
      name: values.name.trim(),
      stream_url: values.stream_url.trim(),
    })
  }

  const serverMessage = saveErrorMessage(error)

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field
        id="camera_name"
        label="Name"
        required
        error={nameError(values.name, touched)}
        hint="The source name the detector uses. Unique across every branch."
      >
        {(props) => (
          <input
            {...props}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="cam-lobby"
          />
        )}
      </Field>

      <Field
        id="camera_stream_url"
        label="Stream URL"
        required
        error={streamUrlError(values.stream_url, touched)}
        hint="Where the detector reads the feed from, usually an rtsp:// address."
      >
        {(props) => (
          <input
            {...props}
            value={values.stream_url}
            onChange={(e) => set('stream_url', e.target.value)}
            placeholder="rtsp://192.168.1.16:8554/stream"
          />
        )}
      </Field>

      {serverMessage && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn rounded-lg border p-3 text-sm"
        >
          {serverMessage}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Add camera'}
        </Button>
      </div>
    </form>
  )
}
