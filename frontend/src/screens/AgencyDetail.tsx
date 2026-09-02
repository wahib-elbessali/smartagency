import { useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Building2, Cpu, IdCard, Layers } from 'lucide-react'
import { fetchAgencies, fetchAgency } from '@/api/endpoints/agencies'
import { fetchDevices } from '@/api/endpoints/devices'
import { fetchEmployees } from '@/api/endpoints/employees'
import { fetchServices } from '@/api/endpoints/services'
import type { DeviceStatus, EmployeeStatus } from '@/api/types'
import { useScope, withinScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import { Screen } from './Screen'

/**
 * One agency, everything about it in one place - what "press an agency, see
 * everything related to it (services, guichets...), switch to another and
 * check everything" asked for (2026-08-30). Reads ADMIN, MANAGER, same as
 * /agencies itself: auth/access.ts inherits the parent route's rule for any
 * nested path, since this is the same data one level deeper.
 *
 * Visiting this page also opens the branch in ScopeContext, the same effect
 * clicking "Open" on the Agencies list has - so Employees, Services and
 * Devices are already narrowed to it if the admin goes there next. There is
 * no separate "Open" button here because arriving at this screen already
 * means the branch is the thing being looked at.
 */

const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, Tone> = {
  ACTIVE: 'ok',
  INACTIVE: 'neutral',
  ON_LEAVE: 'warn',
}

const DEVICE_STATUS_TONE: Record<DeviceStatus, Tone> = {
  ONLINE: 'ok',
  OFFLINE: 'neutral',
  ERROR: 'danger',
  MAINTENANCE: 'warn',
}

function clockOf(value: string | null): string {
  if (!value) return '—'
  const [h, m] = value.split(':')
  return h && m ? `${h}:${m}` : value
}

export default function AgencyDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const scope = useScope()
  const isAdmin = user?.role === 'ADMIN'

  const agency = useQuery({
    queryKey: ['agencies', id],
    queryFn: ({ signal }) => fetchAgency(id, signal),
  })

  /* Only an admin has more than one branch to switch between. */
  const allAgencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
    enabled: isAdmin,
  })

  const services = useQuery({
    queryKey: ['services', id],
    queryFn: ({ signal }) => fetchServices(id, signal),
    enabled: agency.isSuccess,
  })

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => fetchDevices(signal),
  })

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => fetchEmployees(signal),
  })

  const agencyDevices = useMemo(() => withinScope(devices.data ?? [], id), [devices.data, id])
  const agencyEmployees = useMemo(() => withinScope(employees.data ?? [], id), [employees.data, id])

  const agencyId = agency.data?.id
  const agencyName = agency.data?.name
  /* Same effect as pressing "Open" on the Agencies list - see the module
     comment. Re-runs if the id changes, i.e. switching branches from the
     picker below without leaving this screen.

     THE GUARD IS LOAD-BEARING, not a micro-optimisation: scope.enter() sets
     state in ScopeProvider, which rebuilds `scope` as a new object on every
     call. That makes `scope` itself an unstable dependency - satisfying it
     honestly (rather than just naming scope.enter, which the linter does not
     accept as sufficient) means this effect re-runs every time scope changes,
     and scope changes every time this effect runs. Without the guard that is
     an infinite render loop, not a lint nitpick; the check below is what
     breaks the cycle once the scope already matches this branch. */
  useEffect(() => {
    if (agencyId && agencyName && scope.agencyId !== agencyId) {
      scope.enter({ id: agencyId, name: agencyName })
    }
  }, [agencyId, agencyName, scope])

  return (
    <Screen
      title={agency.data?.name ?? 'Branch'}
      description="Everything at this branch: hours, counters, services, employees and devices."
      actions={
        <Link to="/agencies">
          <Button size="sm">
            <ArrowLeft className="size-3.5" aria-hidden />
            All agencies
          </Button>
        </Link>
      }
    >
      <AsyncBoundary
        isPending={agency.isPending}
        error={agency.error}
        forbiddenMessage="Agencies are managed by administrators and managers. Ask an administrator if you need access."
        onRetry={() => void agency.refetch()}
        skeletonRows={5}
      >
        {agency.data && (
          <div className="space-y-4">
            {isAdmin && (allAgencies.data?.length ?? 0) > 1 && (
              <div className="max-w-xs">
                <label
                  htmlFor="agency_switch"
                  className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
                >
                  Switch branch
                </label>
                <select
                  id="agency_switch"
                  className={controlClass()}
                  value={agency.data.id}
                  onChange={(e) => void navigate(`/agencies/${e.target.value}`)}
                >
                  {(allAgencies.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Panel as="section">
              <PanelHeader>
                <div className="flex items-center gap-2.5">
                  <Building2 className="text-ink-3 size-4 shrink-0" aria-hidden />
                  <h2 className="text-ink text-sm font-semibold">{agency.data.name}</h2>
                  {!agency.data.is_active && <Badge tone="neutral">Inactive</Badge>}
                </div>
                <p className="text-ink-3 mt-1 text-xs">{agency.data.address ?? 'No address set'}</p>
              </PanelHeader>
              <PanelBody>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Stat label="Opens" value={clockOf(agency.data.opening_time)} />
                  <Stat label="Closes" value={clockOf(agency.data.closing_time)} />
                  <Stat label="Employees" value={String(agency.data.employees_count)} />
                  <Stat label="Counters" value={String(agency.data.counters.length)} />
                </dl>

                {agency.data.counters.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {agency.data.counters.map((counter) => (
                      <li key={counter.id}>
                        <Badge tone={counter.is_open ? 'ok' : 'neutral'}>
                          {counter.name ?? `Guichet ${counter.number}`}
                          {!counter.is_open && ' · closed'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}

                {agency.data.zones.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {agency.data.zones.map((zone) => (
                      <li key={zone.id}>
                        <Badge tone={zone.is_private ? 'warn' : 'info'}>
                          {zone.name}
                          {zone.is_private && ' · private'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <SectionPanel
                icon={<Layers className="text-ink-3 size-4 shrink-0" aria-hidden />}
                title="Services"
                count={services.data?.length}
                manageHref="/services"
                manageLabel="Manage services"
                isPending={services.isPending}
                error={services.error}
                emptyMessage="No services configured yet."
              >
                {services.data?.map((service) => (
                  <li
                    key={service.id}
                    className="flex items-center justify-between gap-2 py-1.5 text-sm"
                  >
                    <span className="text-ink truncate">{service.name}</span>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge tone="neutral">{service.code}</Badge>
                      {!service.is_active && <Badge tone="neutral">Inactive</Badge>}
                    </div>
                  </li>
                ))}
              </SectionPanel>

              <SectionPanel
                icon={<IdCard className="text-ink-3 size-4 shrink-0" aria-hidden />}
                title="Employees"
                count={agencyEmployees.length}
                manageHref="/employees"
                manageLabel="Manage employees"
                isPending={employees.isPending}
                error={employees.error}
                emptyMessage="No employees at this branch yet."
              >
                {agencyEmployees.map((employee) => (
                  <li
                    key={employee.id}
                    className="flex items-center justify-between gap-2 py-1.5 text-sm"
                  >
                    <span className="text-ink truncate">
                      {employee.first_name} {employee.last_name}
                    </span>
                    <Badge tone={EMPLOYEE_STATUS_TONE[employee.status] ?? 'neutral'}>
                      {employee.status}
                    </Badge>
                  </li>
                ))}
              </SectionPanel>

              <SectionPanel
                icon={<Cpu className="text-ink-3 size-4 shrink-0" aria-hidden />}
                title="Devices"
                count={agencyDevices.length}
                manageHref="/devices"
                manageLabel="Manage devices"
                isPending={devices.isPending}
                error={devices.error}
                emptyMessage="No devices registered at this branch yet."
              >
                {agencyDevices.map((device) => (
                  <li
                    key={device.id}
                    className="flex items-center justify-between gap-2 py-1.5 text-sm"
                  >
                    <span className="text-ink truncate">{device.name}</span>
                    <Badge tone={DEVICE_STATUS_TONE[device.status]}>{device.status}</Badge>
                  </li>
                ))}
              </SectionPanel>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-3 tracked text-[10px] font-medium">{label}</dt>
      <dd className="text-ink tabular mt-1 text-sm">{value}</dd>
    </div>
  )
}

/**
 * One consolidated section - services, employees or devices. Each reads its
 * own query independently (isPending/error are already scoped to this
 * section rather than the whole page) so one slow or refused list does not
 * block the other two from rendering.
 */
function SectionPanel({
  icon,
  title,
  count,
  manageHref,
  manageLabel,
  isPending,
  error,
  emptyMessage,
  children,
}: {
  icon: ReactNode
  title: string
  count: number | undefined
  manageHref: string
  manageLabel: string
  isPending: boolean
  error: unknown
  emptyMessage: string
  children: React.ReactNode
}) {
  const isEmpty = !isPending && !error && (count ?? 0) === 0

  return (
    <Panel as="section">
      <PanelHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-ink text-sm font-semibold">{title}</h2>
          </div>
          {count !== undefined && <span className="text-ink-3 tabular text-xs">{count}</span>}
        </div>
      </PanelHeader>
      <PanelBody>
        {isPending ? (
          <p className="text-ink-3 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-warn text-sm">Could not load {title.toLowerCase()}.</p>
        ) : isEmpty ? (
          <p className="text-ink-3 text-sm">{emptyMessage}</p>
        ) : (
          <ul className="divide-line/70 -my-1.5 divide-y">{children}</ul>
        )}

        <Link to={manageHref} className="mt-3 inline-block">
          <Button size="sm">{manageLabel}</Button>
        </Link>
      </PanelBody>
    </Panel>
  )
}
