import { useState, type FormEvent } from 'react'
import type { Agency } from '@/api/types'
import { ApiError, describeApiError } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Register a walk-in visitor and issue their ticket, in one step.
 *
 * The API separates these - POST /api/visitors then POST /api/tickets - but at
 * a reception desk they are never separate. Nobody registers someone and then
 * declines to give them a place in the queue. Two requests behind one button is
 * the honest mapping; the screen sequences them and says so if the second one
 * fails.
 */

export interface VisitorFormValues {
  full_name: string
  phone: string
  identity_reference: string
  service_type: string
  agency_id: string
}

/** Matches Field(min_length=2) on full_name. */
const MIN_NAME = 2

function nameError(value: string, touched: boolean): string | undefined {
  if (!touched) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return 'Required.'
  if (trimmed.length < MIN_NAME) return `At least ${MIN_NAME} characters.`
  return undefined
}

/**
 * Refusals verified in backend/app/api/visitors.py and tickets.py:
 *   422 "agency_id est obligatoire"  - an admin sent no agency
 *   404 "Agence introuvable"
 *   404 "Visiteur introuvable"       - only if the visitor vanished mid-flow
 */
function saveErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'Could not register this visitor.'

  switch (error.status) {
    case 422:
      return 'Choose which branch this visitor is at.'
    case 404:
      return 'That branch no longer exists. Pick another one.'
    case 403:
      return 'Your role cannot register visitors here.'
    default:
      return describeApiError(error)
  }
}

export function VisitorForm({
  agencies,
  defaultAgencyId,
  canChooseAgency,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  agencies: Agency[]
  defaultAgencyId: string | null
  /** Only an ADMIN picks. Everyone else has their agency forced server-side. */
  canChooseAgency: boolean
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (values: VisitorFormValues) => void
}) {
  const [values, setValues] = useState<VisitorFormValues>({
    full_name: '',
    phone: '',
    identity_reference: '',
    service_type: '',
    agency_id: defaultAgencyId ?? '',
  })
  const [touched, setTouched] = useState(false)

  const fullNameError = nameError(values.full_name, touched)
  const agencyError =
    touched && canChooseAgency && values.agency_id === '' ? 'Required.' : undefined
  const invalid =
    nameError(values.full_name, true) !== undefined || (canChooseAgency && values.agency_id === '')

  const set = <K extends keyof VisitorFormValues>(key: K, value: VisitorFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    onSubmit(values)
  }

  const serverMessage = saveErrorMessage(error)

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="full_name" label="Full name" required error={fullNameError}>
        {(props) => (
          <input
            {...props}
            value={values.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            autoFocus
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label="Phone" hint="Optional.">
          {(props) => (
            <input {...props} value={values.phone} onChange={(e) => set('phone', e.target.value)} />
          )}
        </Field>

        {/* Free text on purpose. The backend takes any string up to 100
            characters and defines no format, so offering a fixed list of
            document types here would invent a rule the API does not have. */}
        <Field id="identity_reference" label="ID reference" hint="Optional. CIN, passport, etc.">
          {(props) => (
            <input
              {...props}
              value={values.identity_reference}
              onChange={(e) => set('identity_reference', e.target.value)}
              placeholder="CIN AB123456"
            />
          )}
        </Field>
      </div>

      <Field
        id="service_type"
        label="What they need"
        hint="Optional. Shown on the ticket so whoever calls them knows what to expect."
      >
        {(props) => (
          <input
            {...props}
            value={values.service_type}
            onChange={(e) => set('service_type', e.target.value)}
            placeholder="Retrait, ouverture de compte…"
          />
        )}
      </Field>

      {canChooseAgency && (
        <Field id="agency_id" label="Branch" required error={agencyError}>
          {(props) => (
            <select
              {...props}
              value={values.agency_id}
              onChange={(e) => set('agency_id', e.target.value)}
            >
              <option value="">Select a branch…</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

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
          {pending ? 'Registering…' : 'Register and issue ticket'}
        </Button>
      </div>
    </form>
  )
}
