import { useState, type FormEvent } from 'react'
import { DEVICE_STATUSES, type Agency, type Device } from '@/api/types'
import { ApiError, describeApiError } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Create / edit form for one IoT device.
 *
 * `status` is edit-only, the same split AgencyForm makes for `is_active`: a
 * new device is always OFFLINE server-side (DeviceCreate has no such field),
 * and only starts reporting once it has actually connected over MQTT.
 */

export interface DeviceFormValues {
  name: string
  device_type: string
  mqtt_client_id: string
  mqtt_topic: string
  status: Device['status']
  agency_id: string
}

function initialValues(device: Device | null, agencyId: string | null): DeviceFormValues {
  return {
    name: device?.name ?? '',
    device_type: device?.device_type ?? '',
    mqtt_client_id: device?.mqtt_client_id ?? '',
    mqtt_topic: device?.mqtt_topic ?? '',
    status: device?.status ?? 'OFFLINE',
    agency_id: device?.agency_id ?? agencyId ?? '',
  }
}

/** Matches Field(min_length=2) on name and device_type. */
function shortTextError(value: string, touched: boolean, label: string): string | undefined {
  if (!touched) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return 'Required.'
  if (trimmed.length < 2) return `${label} needs at least 2 characters.`
  return undefined
}

/**
 * Refusals verified against backend/app/api/devices.py:
 *   409  mqtt_client_id already used, or the target agency is inactive
 *   404  the agency no longer exists
 */
function saveErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'Could not save.'

  switch (error.status) {
    case 409:
      return 'That MQTT client id is already used by another device.'
    case 404:
      return 'That branch no longer exists.'
    case 422:
      return 'The server rejected one of these values.'
    default:
      return describeApiError(error)
  }
}

export function DeviceForm({
  device,
  agencies,
  defaultAgencyId,
  canChooseAgency,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  device: Device | null
  agencies: Agency[]
  defaultAgencyId: string | null
  /** False for a MANAGER or TECHNICIAN: their own agency is the only option. */
  canChooseAgency: boolean
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (values: DeviceFormValues) => void
}) {
  const editing = device !== null
  const [values, setValues] = useState(() => initialValues(device, defaultAgencyId))
  const [touched, setTouched] = useState(false)

  const set = <K extends keyof DeviceFormValues>(key: K, value: DeviceFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const nameErr = shortTextError(values.name, touched, 'Name')
  const typeErr = shortTextError(values.device_type, touched, 'Device type')
  const clientIdErr = shortTextError(values.mqtt_client_id, touched, 'MQTT client id')
  const agencyMissing = !editing && canChooseAgency && values.agency_id === ''
  const invalid =
    shortTextError(values.name, true, 'Name') !== undefined ||
    shortTextError(values.device_type, true, 'Device type') !== undefined ||
    shortTextError(values.mqtt_client_id, true, 'MQTT client id') !== undefined ||
    agencyMissing

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    onSubmit(values)
  }

  const serverMessage = saveErrorMessage(error)

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="device_name" label="Name" required error={nameErr}>
        {(props) => (
          <input {...props} value={values.name} onChange={(e) => set('name', e.target.value)} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="device_type" label="Device type" required error={typeErr} hint="e.g. DHT22.">
          {(props) => (
            <input
              {...props}
              value={values.device_type}
              onChange={(e) => set('device_type', e.target.value)}
              placeholder="DHT22"
            />
          )}
        </Field>

        <Field
          id="device_mqtt_client_id"
          label="MQTT client id"
          required
          error={clientIdErr}
          hint="Unique across every device."
        >
          {(props) => (
            <input
              {...props}
              value={values.mqtt_client_id}
              onChange={(e) => set('mqtt_client_id', e.target.value)}
              placeholder="dht22-001"
              disabled={editing}
            />
          )}
        </Field>
      </div>

      <Field
        id="device_mqtt_topic"
        label="MQTT topic"
        hint={`Optional. Defaults to agency/{agency_id}/device/{mqtt_client_id}/sensor.`}
      >
        {(props) => (
          <input
            {...props}
            value={values.mqtt_topic}
            onChange={(e) => set('mqtt_topic', e.target.value)}
          />
        )}
      </Field>

      {editing && (
        <Field id="device_status" label="Status">
          {(props) => (
            <select
              {...props}
              value={values.status}
              onChange={(e) => set('status', e.target.value as DeviceFormValues['status'])}
            >
              {DEVICE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {!editing && canChooseAgency && (
        <Field
          id="device_agency"
          label="Branch"
          required
          hint="Required when creating as an admin."
        >
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
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Register device'}
        </Button>
      </div>
    </form>
  )
}
