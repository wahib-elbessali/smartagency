import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanFace } from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchEmployees } from '@/api/endpoints/employees'
import { deleteFace, enrollFace, fetchFaces } from '@/api/endpoints/faces'
import { ApiError, describeApiError } from '@/api/errors'
import type { Employee } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { PhotoField, photoError } from '@/components/PhotoField'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import { Screen } from './Screen'

/**
 * Which employees the face recogniser knows. Added 2026-09-27 on
 * backend/app/api/face_recognition.py (see api/endpoints/faces.ts).
 *
 * ENROLLMENT, AND ONLY ENROLLMENT. Adding a person's photo, seeing who is
 * enrolled, and taking them out is plain admin work - it belongs here. A
 * face SCAN does not: it happens because something happened (a door, a
 * kiosk), and that trigger is the backend's to design, the same way a badge
 * read arrives at /internal/access/door-access without anyone clicking
 * anything. So there is no "pick a camera and scan" panel, and no results
 * screen for scans that have no event log to read from.
 *
 * TIED TO THE EMPLOYEE, NOT A TYPED NAME. The backend enrolls a photo under
 * the employee's id, so the list here is the branch's employees, each marked
 * enrolled (with how many photos) or not. Enrolling again ADDS a photo -
 * several angles help recognition - and removing takes every photo.
 *
 * A SEPARATE GALLERY FROM THE WATCHLIST, on purpose: staff and wanted people
 * must never share one. The photo picker is the same control (PhotoField);
 * the data never meets.
 *
 * No photo is ever shown: none comes back from the backend, and a grid of
 * staff faces is not something to put on a dashboard by accident. An
 * inactive employee cannot be enrolled (the backend refuses it), so the
 * button is not offered for one.
 */
export default function Faces() {
  const { user } = useSession()
  const scope = useScope()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
    enabled: isAdmin,
  })
  const [pickedAgencyId, setPickedAgencyId] = useState<string | null>(null)
  const agencyId = isAdmin
    ? (pickedAgencyId ?? scope.agencyId ?? agencies.data?.[0]?.id ?? null)
    : (user?.agency_id ?? null)

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => fetchEmployees(signal),
  })
  const faces = useQuery({
    queryKey: ['faces'],
    queryFn: ({ signal }) => fetchFaces(signal),
  })

  const photosFor = useMemo(
    () => new Map((faces.data ?? []).map((face) => [face.employee_id, face.embeddings_count])),
    [faces.data],
  )
  const rows = useMemo(
    () =>
      (employees.data ?? [])
        .filter((employee) => employee.agency_id === agencyId)
        .sort((a, b) => a.last_name.localeCompare(b.last_name)),
    [employees.data, agencyId],
  )

  const [enrolling, setEnrolling] = useState<Employee | null>(null)
  const [removing, setRemoving] = useState<Employee | null>(null)

  const enroll = useMutation({
    mutationFn: ({ employee, image }: { employee: Employee; image: File }) =>
      enrollFace(employee.id, image),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['faces'] })
      setEnrolling(null)
    },
  })
  const remove = useMutation({
    mutationFn: (employee: Employee) => deleteFace(employee.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['faces'] })
      setRemoving(null)
    },
  })

  const enrolledCount = rows.filter((employee) => photosFor.has(employee.id)).length

  return (
    <Screen
      title="Face enrollment"
      description="Which employees the face recogniser knows, from photos you add here."
    >
      {isAdmin && (
        <div className="mb-4 max-w-xs">
          <label
            htmlFor="faces_agency"
            className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
          >
            Branch
          </label>
          <select
            id="faces_agency"
            className={controlClass()}
            value={agencyId ?? ''}
            onChange={(e) => setPickedAgencyId(e.target.value || null)}
          >
            {(agencies.data ?? []).map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <Panel as="section">
        <PanelHeader>
          <h2 className="text-ink text-sm font-semibold">Employees</h2>
          <p className="text-ink-3 mt-1 text-xs">
            {enrolledCount} of {rows.length} enrolled. Photos are held by the recogniser and never
            shown here.
          </p>
        </PanelHeader>
        <AsyncBoundary
          isPending={employees.isPending || faces.isPending}
          error={employees.error ?? faces.error}
          isEmpty={rows.length === 0}
          emptyMessage="No employees in this branch yet."
          forbiddenMessage="Face enrollment is done by administrators and managers."
          onRetry={() => {
            void employees.refetch()
            void faces.refetch()
          }}
          skeletonRows={4}
        >
          <PanelBody>
            <ul className="space-y-2">
              {rows.map((employee) => {
                const photos = photosFor.get(employee.id)
                const name = `${employee.first_name} ${employee.last_name}`
                return (
                  <li
                    key={employee.id}
                    className="border-line bg-panel-2 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <ScanFace className="text-ink-3 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink truncate text-sm font-medium">{name}</p>
                      <p className="text-ink-3 truncate text-xs">
                        {employee.position ?? 'No position recorded'}
                      </p>
                    </div>
                    {photos ? (
                      <Badge tone="ok">
                        enrolled · {photos} photo{photos === 1 ? '' : 's'}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">not enrolled</Badge>
                    )}
                    {employee.is_active ? (
                      <Button
                        size="sm"
                        aria-label={photos ? `Add a photo for ${name}` : `Enroll ${name}`}
                        onClick={() => setEnrolling(employee)}
                      >
                        {photos ? 'Add a photo' : 'Enroll'}
                      </Button>
                    ) : (
                      <span className="text-ink-3 text-xs">inactive — cannot enroll</span>
                    )}
                    {photos && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${name}'s face data`}
                        onClick={() => setRemoving(employee)}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </PanelBody>
        </AsyncBoundary>
      </Panel>

      <Dialog
        open={enrolling !== null}
        title={
          enrolling && photosFor.has(enrolling.id) ? 'Add another photo' : 'Enroll an employee'
        }
        description="One clear photo showing exactly this person's face."
        onClose={() => {
          setEnrolling(null)
          enroll.reset()
        }}
      >
        {enrolling && (
          <EnrollForm
            employee={enrolling}
            pending={enroll.isPending}
            error={enroll.error}
            onCancel={() => {
              setEnrolling(null)
              enroll.reset()
            }}
            onSubmit={(image) => enroll.mutate({ employee: enrolling, image })}
          />
        )}
      </Dialog>

      <Dialog
        open={removing !== null}
        title="Remove face data"
        description="The recogniser stops knowing this person."
        onClose={() => {
          setRemoving(null)
          remove.reset()
        }}
      >
        {removing && (
          <div>
            <p className="text-ink-2 text-sm leading-relaxed">
              Every photo enrolled for{' '}
              <span className="text-ink font-medium">
                {removing.first_name} {removing.last_name}
              </span>{' '}
              ({photosFor.get(removing.id) ?? 0}) will be removed. The employee record itself stays.
            </p>
            {remove.error != null && (
              <p
                role="alert"
                className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
              >
                {remove.error instanceof ApiError
                  ? describeApiError(remove.error)
                  : 'Could not remove the face data.'}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setRemoving(null)}>Keep</Button>
              <Button
                variant="primary"
                disabled={remove.isPending}
                onClick={() => remove.mutate(removing)}
              >
                {remove.isPending ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Screen>
  )
}

function EnrollForm({
  employee,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  employee: Employee
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (image: File) => void
}) {
  const [image, setImage] = useState<File | null>(null)
  const ready = image !== null && !photoError(image)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ready && image) onSubmit(image)
  }

  return (
    <form onSubmit={submit}>
      <p className="text-ink-2 mb-4 text-sm">
        {employee.first_name} {employee.last_name}
      </p>
      <PhotoField
        id="face_photo"
        label="Photo"
        required
        file={image}
        onChange={setImage}
        hint="Their face alone, clearly lit. Up to 10 MB. Several photos from different angles help."
      />
      {error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
        >
          {error instanceof ApiError ? describeApiError(error) : 'Could not enroll this photo.'}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready || pending}>
          {pending ? 'Enrolling…' : 'Enroll photo'}
        </Button>
      </div>
    </form>
  )
}
