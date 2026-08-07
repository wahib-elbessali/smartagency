import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, DoorOpen, LogIn, RefreshCw, UserCheck } from 'lucide-react'
import { isLate, type AttendanceEntry } from '@/api/attendanceMerge'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchEmployees } from '@/api/endpoints/employees'
import { useAttendanceToday } from '@/hooks/useAttendanceToday'
import type { Agency, Employee } from '@/api/types'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Clock } from '@/components/ui/Time'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { Screen } from './Screen'

/**
 * The one screen contracts/api.md fully supports today.
 *
 * Three endpoints feed it:
 *   GET /api/attendance/today  - who badged in, the snapshot
 *   WS  /ws/attendance         - keeps that current
 *   GET /api/employees         - position and RFID, joined on employee_id
 *   GET /api/agencies          - opening_time, to derive "late"
 *
 * Employees and agencies are secondary: if either fails the table still renders
 * with the attendance data alone, because "who is in the building" is the
 * question this screen exists to answer and a missing job title should not
 * blank it out.
 */

export default function EmployeePresence() {
  const attendance = useAttendanceToday()

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => fetchEmployees(signal),
  })

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
  })

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const employee of employees.data ?? []) map.set(employee.id, employee)
    return map
  }, [employees.data])

  const agencyById = useMemo(() => {
    const map = new Map<string, Agency>()
    for (const agency of agencies.data ?? []) map.set(agency.id, agency)
    return map
  }, [agencies.data])

  const lateCount = useMemo(
    () =>
      attendance.entries.filter(
        (entry) => isLate(entry.check_in, agencyById.get(entry.agency_id)?.opening_time) === true,
      ).length,
    [attendance.entries, agencyById],
  )

  const knowsOpeningTime = agencyById.size > 0

  return (
    <Screen
      title="Employee presence"
      description="Who is in the building right now, from badge and reader events."
      actions={
        <>
          <StreamStatusBadge status={attendance.streamStatus} />
          <Button size="sm" onClick={attendance.refetch} aria-label="Refresh attendance">
            <RefreshCw className="size-3.5" aria-hidden />
            Refresh
          </Button>
        </>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="In the building"
          value={attendance.totals.present}
          tone="ok"
          icon={<UserCheck className="size-4" aria-hidden />}
          hint="Checked in, no check-out yet"
        />
        <StatTile
          label="Checked out"
          value={attendance.totals.departed}
          icon={<DoorOpen className="size-4" aria-hidden />}
          hint="Completed visits today"
        />
        <StatTile
          label="Late arrivals"
          value={knowsOpeningTime ? lateCount : '—'}
          tone={lateCount > 0 ? 'warn' : 'neutral'}
          icon={<LogIn className="size-4" aria-hidden />}
          hint={
            knowsOpeningTime
              ? 'Checked in after the agency opening time'
              : 'Needs the agency opening time'
          }
        />
      </div>

      {attendance.isStale && !attendance.isPending && !attendance.error && <StaleNotice />}

      <AsyncBoundary
        isPending={attendance.isPending}
        error={attendance.error}
        isEmpty={attendance.entries.length === 0}
        emptyMessage="Nobody has checked in today yet."
        /* GET /api/attendance/today is restricted to ADMIN, MANAGER and
           SECURITY, so AGENT and TECHNICIAN land here. Naming the roles saves
           a round trip to whoever administers accounts. */
        forbiddenMessage="Attendance is visible to administrators, managers and security staff. Ask an administrator if you need access."
        onRetry={attendance.refetch}
        skeletonRows={6}
      >
        <Panel as="section">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink text-sm font-semibold">Today</h2>
              <span className="text-ink-3 tabular text-xs">
                {attendance.totals.total} {attendance.totals.total === 1 ? 'record' : 'records'}
              </span>
            </div>
          </PanelHeader>
          <PanelBody className="px-0 py-0">
            <RosterTable
              entries={attendance.entries}
              employeeById={employeeById}
              agencyById={agencyById}
            />
          </PanelBody>
        </Panel>
      </AsyncBoundary>
    </Screen>
  )
}

/**
 * Shown whenever the snapshot loaded but the socket is not open.
 *
 * This is the whole reason StreamStatus exists. A table of people who checked in
 * two hours ago looks exactly like a live one - same rows, same times, nothing
 * moving because nothing is happening. Saying so explicitly is the difference
 * between "quiet morning" and "the feed died at 09:10 and nobody noticed".
 */
function StaleNotice() {
  return (
    <Panel tone="alert" className="mb-5">
      <PanelBody className="flex gap-3 py-3.5">
        <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-warn/90 text-sm leading-relaxed" role="status">
          <span className="font-medium">Not receiving live updates.</span> These rows are from the
          last load and will not change until the connection comes back.
        </p>
      </PanelBody>
    </Panel>
  )
}

function RosterTable({
  entries,
  employeeById,
  agencyById,
}: {
  entries: AttendanceEntry[]
  employeeById: Map<string, Employee>
  agencyById: Map<string, Agency>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Employees who have checked in today, still-present first
        </caption>
        <thead>
          <tr className="text-ink-3 border-line border-b text-left text-xs">
            <th scope="col" className="px-5 py-2.5 font-medium">
              Employee
            </th>
            <th scope="col" className="px-5 py-2.5 font-medium">
              Position
            </th>
            <th scope="col" className="px-5 py-2.5 font-medium">
              In
            </th>
            <th scope="col" className="px-5 py-2.5 font-medium">
              Out
            </th>
            <th scope="col" className="px-5 py-2.5 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const employee = employeeById.get(entry.employee_id)
            const late = isLate(entry.check_in, agencyById.get(entry.agency_id)?.opening_time)
            const stillIn = entry.check_out === null

            return (
              <tr
                key={`${entry.employee_id}|${entry.check_in}`}
                className="border-line/70 hover:bg-panel-2/60 ease-soft border-b transition-colors duration-150 last:border-b-0"
              >
                <th scope="row" className="px-5 py-3 text-left font-normal">
                  <div className="flex items-center gap-3">
                    <Avatar name={entry.employee_name} />
                    <div className="min-w-0">
                      <div className="text-ink truncate font-medium">{entry.employee_name}</div>
                      {employee?.rfid_uid && (
                        <div className="text-ink-3 tabular truncate text-xs">
                          {employee.rfid_uid}
                        </div>
                      )}
                    </div>
                  </div>
                </th>
                <td className="text-ink-2 px-5 py-3">
                  {/* Two different unknowns, deliberately worded differently.
                      Attendance can name someone the employees list doesn't
                      cover, because a MANAGER's scope is set by the backend and
                      the two calls are not guaranteed to agree. Separately,
                      `position` is nullable in EmployeeResponse, so a known
                      employee can simply not have one. Neither may render as a
                      blank cell - on a wall display that reads as a bug. */}
                  {!employee ? (
                    <span className="text-ink-3">Not in employee list</span>
                  ) : employee.position ? (
                    employee.position
                  ) : (
                    <span className="text-ink-3">No position set</span>
                  )}
                </td>
                <td className="text-ink-2 px-5 py-3">
                  <Clock iso={entry.check_in} />
                </td>
                <td className="text-ink-2 px-5 py-3">
                  <Clock iso={entry.check_out} />
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stillIn ? <Badge tone="ok">In</Badge> : <Badge tone="neutral">Out</Badge>}
                    {late === true && <Badge tone="warn">Late</Badge>}
                    <Badge tone="neutral">{entry.method}</Badge>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
