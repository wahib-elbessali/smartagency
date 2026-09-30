import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CircleHelp, Plus, Trash2, UserCheck, UserX } from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchCameras } from '@/api/endpoints/cameras'
import { fetchEmployees } from '@/api/endpoints/employees'
import { createWorkstationStream } from '@/api/endpoints/streams'
import {
  createWorkstation,
  deleteWorkstation,
  fetchWorkstations,
} from '@/api/endpoints/workstations'
import { fetchZones, zonesOnCameras } from '@/api/endpoints/zones'
import { ApiError, describeApiError } from '@/api/errors'
import { applyWorkstationFrame, unstaffed, type WorkstationsByName } from '@/api/streamMerge'
import type { Employee, Workstation, WorkstationFrame, WorkstationStatus } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { useStream } from '@/hooks/useStream'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { controlClass } from '@/components/ui/control'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { Screen } from './Screen'

/**
 * Whether the counters are being manned, live. Added 2026-09-19, the second
 * half of the AI/CV integration (contracts/ai-service.md
 * §/employee_activity).
 *
 * THIS IS NOT ATTENDANCE, and confusing the two would be the expensive
 * mistake. Employee presence answers "did they badge in today?" from the RFID
 * reader at the door. This answers "is anyone at counter 3 right now, while
 * twelve people are waiting?" Somebody can be present by the first measure
 * and away by the second all afternoon, and both readings are true.
 *
 * HOW LITTLE IS BEHIND IT
 *
 * No face recognition, no new model, no calibration: the AI service builds
 * this entirely on /zoning's existing occupancy. A workstation is a name
 * bound to a zone drawn on the Zones screen - so that screen is the setup
 * step for this one, which is why the empty state sends people there.
 *
 * THE THREE STATUSES ARE NOT TWO
 *
 * `present` fires on any sighting. `away` arrives only after the zone has
 * been continuously empty for the service's absence window (300s by
 * default), so it is a slow and deliberate signal rather than a flicker -
 * stepping to the printer does not empty a counter. `unknown` is neither: it
 * means the zone has not been classified yet, and with `zone_known: false`
 * it means nothing has EVER been read there, which is a broken camera rather
 * than a quiet counter. Those are rendered as three different things,
 * because a screen that shows "away" for a camera that has never worked is
 * reporting an unmanned counter that may be perfectly staffed.
 *
 * ROWS COME FROM REST, STATUS COMES FROM THE STREAM
 *
 * The rows are the backend's own table (backend/app/api/employee_activity.py),
 * scoped to one agency and carrying who is meant to be at each counter. The
 * stream (WS /ws/employee-activity) is the AI service's, relayed untouched:
 * the whole site, and no employee on a row. So the stream only refreshes
 * the status of rows this agency already has - a frame naming a workstation
 * that is not in the list is ignored rather than rendered, or one manager's
 * wall display would quietly grow another branch's counters - and it never
 * replaces a row outright, or the employee would vanish on the first flip.
 *
 * The zone picker offers only zones drawn on this branch's cameras. Backend
 * would accept any zone on the site; binding a Rabat counter to a
 * Casablanca camera is a mistake this form does not offer.
 */

const STATUS_TONE: Record<WorkstationStatus, Tone> = {
  present: 'ok',
  away: 'warn',
  unknown: 'neutral',
}

const STATUS_LABEL: Record<WorkstationStatus, string> = {
  present: 'Manned',
  away: 'Nobody there',
  unknown: 'Not classified',
}

/**
 * How long ago something happened, from an epoch-SECONDS float.
 *
 * The AI service speaks Unix time where the rest of this dashboard speaks ISO
 * 8601, so the conversion happens here rather than pretending the field is
 * something it is not. Anything under a minute reads as "just now" - a
 * counter that emptied 40 seconds ago and one that emptied 10 are the same
 * fact to the person reading this.
 */
function elapsed(since: number | null): { minutes: number; text: string } | null {
  /* Null when the AI service had no state for this row - nothing to say. */
  if (since === null) return null
  const seconds = Math.max(0, Date.now() / 1000 - since)
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return { minutes, text: 'less than a minute' }
  if (minutes < 60) return { minutes, text: `${minutes} min` }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return { minutes, text: rest === 0 ? `${hours} h` : `${hours} h ${rest} min` }
}

/**
 * `since` is when the STATUS began, not when the counter emptied.
 *
 * That distinction produced the first wording bug on this screen: a counter
 * flagged five seconds ago was rendered as "empty just now — past the
 * detector's five-minute window", which contradicts itself. The service only
 * declares `away` AFTER the full absence window has already elapsed, so the
 * moment it flips, the counter has in fact been empty for five minutes and a
 * bit. Saying when it was flagged is the honest form; adding the window on
 * top and claiming a total would be arithmetic on a number the service does
 * not publish.
 */
function flaggedLabel(since: number | null): string {
  const time = elapsed(since)
  if (time === null) return 'flagged at a time the detector did not report'
  return time.minutes < 1 ? 'flagged just now' : `flagged ${time.text} ago`
}

export default function Staffing() {
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
  /* Same order of preference as Zones: what an admin picked here, then the
     branch open elsewhere, then the first branch. Everyone else has one. */
  const agencyId = isAdmin
    ? (pickedAgencyId ?? scope.agencyId ?? agencies.data?.[0]?.id ?? null)
    : (user?.agency_id ?? null)

  const stations = useQuery({
    queryKey: ['workstations', agencyId],
    queryFn: ({ signal }) => fetchWorkstations(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const cameras = useQuery({
    queryKey: ['cameras', agencyId],
    queryFn: ({ signal }) => fetchCameras(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const zones = useQuery({
    queryKey: ['zones', agencyId],
    queryFn: ({ signal }) => fetchZones(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => fetchEmployees(signal),
  })

  const { state: live, status: streamStatus } = useStream<WorkstationFrame, WorkstationsByName>(
    'workstations',
    () => createWorkstationStream(),
    applyWorkstationFrame,
    () => ({}),
  )

  /* The scoped list, wearing whatever the feed last said about each row's
     status - and only its status: the employee is ours, not the feed's. */
  const rows: Workstation[] = useMemo(
    () =>
      [...(stations.data ?? [])]
        .map((station) => {
          const state = live[station.name]
          return state
            ? { ...station, status: state.status, since: state.since, zone_known: state.zone_known }
            : station
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stations.data, live],
  )

  const byName = useMemo(
    () => Object.fromEntries(rows.map((station) => [station.name, station])),
    [rows],
  )
  const empty = useMemo(() => unstaffed(byName), [byName])

  const [binding, setBinding] = useState(false)

  const bind = useMutation({
    mutationFn: (values: BindValues) => createWorkstation(agencyId as string, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workstations'] })
      setBinding(false)
    },
  })

  const unbind = useMutation({
    mutationFn: (station: Workstation) => deleteWorkstation(agencyId as string, station.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
  })

  const zoneNames = useMemo(
    () =>
      zonesOnCameras(zones.data ?? [], cameras.data ?? [])
        .map((zone) => zone.name)
        .sort((a, b) => a.localeCompare(b)),
    [zones.data, cameras.data],
  )
  const branchEmployees = useMemo(
    () =>
      (employees.data ?? [])
        .filter((employee) => employee.agency_id === agencyId && employee.is_active)
        .sort((a, b) => a.last_name.localeCompare(b.last_name)),
    [employees.data, agencyId],
  )
  const takenNames = useMemo(
    () => new Set((stations.data ?? []).map((station) => station.name)),
    [stations.data],
  )

  return (
    <Screen
      title="Counter staffing"
      description="Whether anyone is actually at each counter, from the zones drawn on the cameras."
      actions={
        <div className="flex items-center gap-2">
          <StreamStatusBadge status={streamStatus} />
          {zoneNames.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => setBinding(true)}>
              <Plus className="size-3.5" aria-hidden />
              Add workstation
            </Button>
          )}
        </div>
      }
    >
      {isAdmin && (
        <div className="mb-4 max-w-xs">
          <label
            htmlFor="staffing_agency"
            className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
          >
            Branch
          </label>
          <select
            id="staffing_agency"
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

      {empty.length > 0 && (
        <Panel as="section" tone="alert" className="mb-4">
          <PanelBody className="flex gap-3">
            <UserX className="text-warn mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 className="text-ink text-sm font-semibold">
                {empty.length === 1
                  ? '1 counter has nobody at it'
                  : `${empty.length} counters have nobody at them`}
              </h2>
              <p className="text-ink-2 mt-1 text-sm leading-relaxed">
                {empty.map((station) => station.name).join(', ')} —{' '}
                {empty.length === 1 ? 'empty' : 'each empty'} for at least five continuous minutes,
                which is how long the detector waits before saying so. Not somebody stepping away.
              </p>
            </div>
          </PanelBody>
        </Panel>
      )}

      <AsyncBoundary
        isPending={stations.isPending}
        error={stations.error}
        isEmpty={rows.length === 0}
        emptyMessage={
          zoneNames.length === 0
            ? 'No zones drawn yet. A workstation watches a zone, so draw the area in front of a counter first.'
            : 'No workstations yet. Bind one to a zone and the detector will report whether anyone is standing in it.'
        }
        forbiddenMessage="Counter staffing is read by administrators and managers. Ask an administrator if you need access."
        onRetry={() => void stations.refetch()}
        skeletonRows={3}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((station) => (
            <Panel as="section" key={station.name}>
              <PanelHeader
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Unbind ${station.name}`}
                    disabled={unbind.isPending}
                    onClick={() => unbind.mutate(station)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                }
              >
                <div className="flex items-center gap-2.5">
                  <StatusIcon status={station.status} />
                  <h2 className="text-ink min-w-0 truncate text-sm font-semibold">
                    {station.name}
                  </h2>
                  <Badge tone={STATUS_TONE[station.status]}>{STATUS_LABEL[station.status]}</Badge>
                </div>
                <p className="text-ink-3 mt-1 truncate text-xs">
                  Watching zone <span className="text-ink-2">{station.zone}</span>
                  {station.employee_name && (
                    <>
                      {' · '}
                      <span className="text-ink-2">{station.employee_name}</span>’s counter
                    </>
                  )}
                </p>
              </PanelHeader>

              <PanelBody>
                {/* `zone_known: false` outranks the status: there is no
                    reading at all, so saying anything about the counter
                    would be inventing it. */}
                {!station.zone_known ? (
                  <p className="text-ink-2 text-sm leading-relaxed">
                    Nothing has been measured here yet. The camera behind{' '}
                    <span className="text-ink">{station.zone}</span> has not produced a frame, so
                    this is a camera to check rather than a counter to staff.
                  </p>
                ) : (
                  <p className="text-ink-2 text-sm leading-relaxed">
                    {station.status === 'present' && (
                      <>
                        Somebody has been at this counter
                        {elapsed(station.since) && (
                          <>
                            {' for '}
                            <span className="text-ink">{elapsed(station.since)?.text}</span>
                          </>
                        )}
                        .
                      </>
                    )}
                    {station.status === 'away' && (
                      <>
                        Nobody there for at least five minutes —{' '}
                        <span className="text-ink">{flaggedLabel(station.since)}</span>. The
                        detector waits out a full five minutes of absence before saying this, so it
                        is not somebody who stepped away.
                      </>
                    )}
                    {station.status === 'unknown' && (
                      <>Waiting for the detector to classify this zone.</>
                    )}
                  </p>
                )}
              </PanelBody>
            </Panel>
          ))}
        </div>
      </AsyncBoundary>

      {unbind.error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
        >
          {unbind.error instanceof ApiError
            ? describeApiError(unbind.error)
            : 'Could not unbind that workstation.'}
        </p>
      )}

      <p className="text-ink-3 mt-4 text-xs leading-relaxed">
        This is not attendance. It says whether a counter is being manned, not who is at it and not
        whether they came to work — {user?.role === 'ADMIN' ? 'the' : 'your'} roster lives on{' '}
        <Link to="/presence" className="text-ink-2 hover:text-accent underline">
          Employee presence
        </Link>
        . Areas are drawn on{' '}
        <Link to="/zones" className="text-ink-2 hover:text-accent underline">
          Zones
        </Link>
        .
      </p>

      <Dialog
        open={binding}
        title="Add a workstation"
        description="A workstation is a name for one zone, watched for whether anyone is standing in it."
        onClose={() => {
          setBinding(false)
          bind.reset()
        }}
      >
        {binding && (
          <BindForm
            zoneNames={zoneNames}
            employees={branchEmployees}
            takenNames={takenNames}
            pending={bind.isPending}
            error={bind.error}
            onCancel={() => {
              setBinding(false)
              bind.reset()
            }}
            onSubmit={(values) => bind.mutate(values)}
          />
        )}
      </Dialog>
    </Screen>
  )
}

function StatusIcon({ status }: { status: WorkstationStatus }) {
  if (status === 'present') return <UserCheck className="text-ok size-4 shrink-0" aria-hidden />
  if (status === 'away') return <UserX className="text-warn size-4 shrink-0" aria-hidden />
  return <CircleHelp className="text-ink-3 size-4 shrink-0" aria-hidden />
}

/**
 * The zone is picked, never typed.
 *
 * The AI service answers 422 for a zone that does not exist, and a free-text
 * field would make that the normal way to discover a typo. Picking also makes
 * the dependency visible: no zones, no workstations.
 */
interface BindValues {
  name: string
  zone: string
  employee_id: string | null
}

function BindForm({
  zoneNames,
  employees,
  takenNames,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  zoneNames: string[]
  employees: Employee[]
  takenNames: Set<string>
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (values: BindValues) => void
}) {
  const [name, setName] = useState('')
  const [zone, setZone] = useState(zoneNames[0] ?? '')
  const [employeeId, setEmployeeId] = useState('')
  const trimmed = name.trim()
  const replacing = trimmed.length > 0 && takenNames.has(trimmed)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (trimmed.length === 0 || zone.length === 0) return
    onSubmit({ name: trimmed, zone, employee_id: employeeId || null })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <Field id="workstation_name" label="Name" required hint="What people call this counter.">
          {(props) => (
            <input
              {...props}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
            />
          )}
        </Field>

        <Field id="workstation_zone" label="Zone" required>
          {(props) => (
            <select {...props} value={zone} onChange={(e) => setZone(e.target.value)}>
              {zoneNames.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/* Who is meant to be here. Optional, and only ever a label: the
            detector reports whether SOMEBODY is in the zone, never who. */}
        <Field
          id="workstation_employee"
          label="Employee"
          hint="Who normally works this counter. The detector does not check who is there."
        >
          {(props) => (
            <select {...props} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Nobody in particular</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {replacing && (
        <p className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm leading-relaxed">
          A workstation called <span className="font-medium">{trimmed}</span> already exists. Saving
          rebinds it to this zone and this employee.
        </p>
      )}

      {error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
        >
          {error instanceof ApiError ? describeApiError(error) : 'Could not add this workstation.'}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || trimmed.length === 0}>
          {pending ? 'Saving…' : replacing ? 'Rebind' : 'Add workstation'}
        </Button>
      </div>
    </form>
  )
}
