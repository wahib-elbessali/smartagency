import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { fetchCameras } from '@/api/endpoints/cameras'
import { createOccupancyStream } from '@/api/endpoints/streams'
import { fetchZones, zonesOnCameras } from '@/api/endpoints/zones'
import { applyOccupancyFrame, totalAcrossZones, type ZonesByName } from '@/api/streamMerge'
import type { OccupancyFrame } from '@/api/types'
import { useSession } from '@/auth/SessionContext'
import { useStream } from '@/hooks/useStream'
import { Badge } from '@/components/ui/Badge'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { Screen } from './Screen'

/**
 * How many people are standing in each zone, live.
 *
 * Same transport story as Alerts: the backend proxies the AI service
 * (WS /ws/occupancy, contracts/api.md §13) and the frontend never touches it
 * directly.
 *
 * Three honesty problems this screen has to avoid, all from the contract:
 *
 * 1. **The counts are not a headcount.** Zones can overlap, a person inside two
 *    of them is counted in both, and a boundary counts as inside. So the total
 *    is labelled as detections across zones, not as people in the building.
 *
 * 2. **A zone at zero is data, not absence.** Frames arrive only when a count
 *    changes and there is no heartbeat, so hiding empty zones would leave the
 *    last busy number on a wall display long after the room emptied. Every
 *    known zone is rendered, zero included.
 *
 * 3. **Zero is not always a count.** For a world zone, `people_tracking_ready:
 *    false` means person tracking is not running yet, and the contract says
 *    its 0 must not be read as an empty zone. Such a zone says "Not tracking
 *    yet" instead of a number, and stays out of the total and the busiest.
 *
 * ONE SITE, SEVERAL BRANCHES
 *
 * The stream relays the AI service's whole-site feed - it is not filtered by
 * agency. A MANAGER sees only the zones drawn on their own branch's cameras
 * (the zone list says which camera each is on); until that list has loaded
 * nothing is shown, rather than briefly flashing another branch's counts.
 * An ADMIN sees every zone.
 */

/** Bar width as a share of the busiest zone, so the shape is readable at a glance. */
function share(count: number, busiest: number): string {
  if (busiest <= 0) return '0%'
  return `${Math.round((count / busiest) * 100)}%`
}

export default function Occupancy() {
  const { user } = useSession()
  const isAdmin = user?.role === 'ADMIN'
  const agencyId = isAdmin ? null : (user?.agency_id ?? null)

  const { state: allZones, status } = useStream<OccupancyFrame, ZonesByName>(
    'occupancy',
    createOccupancyStream,
    applyOccupancyFrame,
    () => ({}),
  )

  /* Which zones are this branch's - only needed, and only fetched, for a
     caller who is not an ADMIN. */
  const cameras = useQuery({
    queryKey: ['cameras', agencyId],
    queryFn: ({ signal }) => fetchCameras(agencyId as string, signal),
    enabled: agencyId !== null,
  })
  const drawn = useQuery({
    queryKey: ['zones', agencyId],
    queryFn: ({ signal }) => fetchZones(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const zones: ZonesByName = useMemo(() => {
    if (isAdmin) return allZones
    if (!cameras.data || !drawn.data) return {}
    const mine = new Set(zonesOnCameras(drawn.data, cameras.data).map((zone) => zone.name))
    return Object.fromEntries(Object.entries(allZones).filter(([name]) => mine.has(name)))
  }, [isAdmin, allZones, cameras.data, drawn.data])
  const scopeError = !isAdmin && (cameras.isError || drawn.isError)

  const names = useMemo(() => Object.keys(zones).sort(), [zones])
  const total = useMemo(() => totalAcrossZones(zones), [zones])
  const busiest = useMemo(
    () =>
      Math.max(
        0,
        ...Object.values(zones)
          .filter((zone) => zone.people_tracking_ready)
          .map((zone) => zone.count),
      ),
    [zones],
  )

  return (
    <Screen
      title="Occupancy"
      description="Where people are standing, zone by zone."
      actions={<StreamStatusBadge status={status} />}
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Zones" value={String(names.length)} />
        <StatTile label="Detections across zones" value={String(total)} />
        <StatTile label="Busiest zone" value={busiest > 0 ? String(busiest) : '—'} />
      </div>

      <Panel as="section">
        <PanelHeader>
          <h2 className="text-ink text-sm font-semibold">By zone</h2>
        </PanelHeader>
        <PanelBody className="space-y-3">
          {scopeError ? (
            <div role="alert" className="py-2">
              <p className="text-ink text-sm font-medium">Could not tell which zones are yours</p>
              <p className="text-ink-2 mt-1.5 text-sm leading-relaxed">
                The feed covers every branch, and the list of this branch's zones did not load, so
                nothing is shown rather than another branch's counts.
              </p>
            </div>
          ) : names.length === 0 ? (
            <div role="status" className="py-2">
              <p className="text-ink text-sm font-medium">
                {status === 'open' ? 'No zones configured' : 'Waiting for the feed'}
              </p>
              <p className="text-ink-2 mt-1.5 text-sm leading-relaxed">
                {status === 'open'
                  ? 'Zones are drawn on the Zones screen. Until at least one exists there is nothing to count.'
                  : 'Nothing here reflects the connection, not the building.'}
              </p>
            </div>
          ) : (
            names.map((name) => {
              const zone = zones[name]
              if (!zone) return null
              const ready = zone.people_tracking_ready
              return (
                <div key={name}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-ink text-sm">{name}</span>
                    {ready ? (
                      <span className="text-ink tabular text-sm font-medium">{zone.count}</span>
                    ) : (
                      <Badge tone="neutral">Not tracking yet</Badge>
                    )}
                  </div>
                  {/* A zero-width bar still leaves the track visible, so an
                      empty zone reads as "measured, and empty". */}
                  <div className="bg-panel-2 border-line h-2 overflow-hidden rounded-full border">
                    <div
                      className="bg-accent h-full rounded-full transition-all duration-300"
                      style={{ width: ready ? share(zone.count, busiest) : '0%' }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </PanelBody>
      </Panel>

      <p className="text-ink-3 mt-4 flex items-start gap-2 text-xs leading-relaxed">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Zones can overlap, and someone standing in two is counted in both — so the total is
          detections, not a headcount. Counts update only when a zone changes, with no heartbeat, so
          the badge above is the only sign the feed is alive.
        </span>
      </p>
    </Screen>
  )
}
