import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchCameras } from '@/api/endpoints/cameras'
import { fetchPeopleStatus } from '@/api/endpoints/people'
import { createPeopleStream } from '@/api/endpoints/streams'
import { fetchZones, zonesOnCameras } from '@/api/endpoints/zones'
import { ApiError, describeApiError } from '@/api/errors'
import { applyPeopleFrame, EMPTY_PEOPLE, type PeopleState } from '@/api/streamMerge'
import type { PeopleFrame, PeoplePhase, PeopleRoom, PersonTrack } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StatTile } from '@/components/ui/StatTile'
import { controlClass } from '@/components/ui/control'
import { useStream } from '@/hooks/useStream'
import { Screen } from './Screen'

/**
 * Where every tracked person is on the floor, live. Added 2026-09-27 on the
 * backend's person-tracking gateway (api/endpoints/people.ts) and its
 * /ws/people/tracks proxy (endpoints/streams.ts).
 *
 * WHAT IT IS. Once 2+ cameras are calibrated and aligned onto one shared
 * floor, the AI service follows each person across all of them and reports
 * a floor position per person, every cycle. This plots those positions on a
 * top-down map, with the floor zones (the ones drawn across several cameras)
 * underneath, and lists the raw tracks below.
 *
 * WHAT IT IS NOT. Nobody is identified - an id is a number the tracker hands
 * out, and a person who leaves and comes back gets a new one. The per-camera
 * pixel boxes that ride along on the stream are for a live-view overlay, not
 * for this map; the map plots only floor positions.
 *
 * THE PHASE IS THE WHOLE STORY UNTIL IT RUNS. There is no "start": the
 * tracker bootstraps by itself once every registered camera is calibrated
 * and aligned - idle, then a one-off bootstrap (~30 s on live video), then
 * running. Until then the map is empty for a reason, and the phase, warnings
 * and error say which. When it drops back out of running the dots go too,
 * rather than freezing in place as if people had stopped walking.
 *
 * ONE SITE. The stream is the AI service's whole site, not one branch: the
 * backend does not filter it, and a floor position belongs to no camera. The
 * backend also registers every branch's cameras for tracking, so with more
 * than one branch it cannot reach `running` today - raised with backend, and
 * said on screen when it applies.
 *
 * Roles: ADMIN, MANAGER and SECURITY (PEOPLE_ROLES in the backend).
 */

const PHASE_TONE: Record<PeoplePhase, Tone> = {
  idle: 'neutral',
  bootstrapping: 'info',
  running: 'ok',
  error: 'danger',
}

const PHASE_LABEL: Record<PeoplePhase, string> = {
  idle: 'Not tracking',
  bootstrapping: 'Starting up',
  running: 'Tracking',
  error: 'Failed',
}

export default function PeopleMap() {
  const { user } = useSession()
  const scope = useScope()
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

  const rest = useQuery({
    queryKey: ['peopleStatus', agencyId],
    queryFn: ({ signal }) => fetchPeopleStatus(agencyId as string, signal),
    enabled: agencyId !== null,
    /* The socket carries every change; this is the starting point, refreshed
       now and then in case the socket is down. */
    refetchInterval: 15_000,
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

  const { state: live, status: streamStatus } = useStream<PeopleFrame, PeopleState>(
    'people',
    createPeopleStream,
    applyPeopleFrame,
    () => EMPTY_PEOPLE,
  )

  /* The socket's word wins over the REST starting point, field by field. */
  const status = live.status ?? rest.data ?? null
  const phase: PeoplePhase | null = live.phase ?? rest.data?.phase ?? null
  const tracks = phase === 'running' ? live.tracks : []

  const floorZones = useMemo(
    () =>
      zonesOnCameras(zones.data ?? [], cameras.data ?? []).filter(
        (zone) => zone.mode === 'world' && zone.polygon_m,
      ),
    [zones.data, cameras.data],
  )

  const room =
    status?.room ??
    boundsOf(
      tracks,
      floorZones.flatMap((z) => z.polygon_m ?? []),
    )

  return (
    <Screen
      title="Live floor map"
      description="Where each tracked person is on the shared floor, across every aligned camera."
      actions={<StreamStatusBadge status={streamStatus} />}
    >
      {isAdmin && (
        <div className="mb-4 max-w-xs">
          <label
            htmlFor="map_agency"
            className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
          >
            Branch
          </label>
          <select
            id="map_agency"
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

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Tracker"
          value={
            phase ? (
              <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
            ) : (
              <span className="text-ink-3 text-sm">Unknown</span>
            )
          }
        />
        <StatTile
          label="People tracked"
          value={phase === 'running' ? String(tracks.length) : '—'}
        />
        <StatTile label="Frames a second" value={status?.fps ? String(status.fps) : '—'} />
        <StatTile
          label="Person width on the floor"
          value={status?.person_scale ? status.person_scale.toFixed(1) : '—'}
        />
      </div>

      {rest.error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mb-4 rounded-lg border p-3 text-sm"
        >
          {rest.error instanceof ApiError
            ? describeApiError(rest.error)
            : 'Could not read the tracker status.'}
        </p>
      )}

      {(status?.warnings.length || status?.error) && (
        <Panel as="section" tone="alert" className="mb-4">
          <PanelBody>
            <h2 className="text-warn text-sm font-semibold">
              {status?.error ? 'The tracker stopped with an error' : 'The tracker says'}
            </h2>
            <ul className="text-ink-2 mt-2 space-y-1 text-sm leading-relaxed">
              {status?.error && <li>{status.error}</li>}
              {status?.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <Panel as="section">
          <PanelHeader>
            <h2 className="text-ink text-sm font-semibold">Floor</h2>
            <p className="text-ink-3 mt-1 text-xs">
              Seen from above, in the shared floor's own units. Shaded shapes are floor zones.
            </p>
          </PanelHeader>
          <PanelBody className="p-0">
            <FloorMap room={room} tracks={tracks} zones={floorZones} phase={phase} />
          </PanelBody>
        </Panel>

        <Panel as="section">
          <PanelHeader>
            <h2 className="text-ink text-sm font-semibold">Tracks</h2>
            <p className="text-ink-3 mt-1 text-xs">
              The full set each cycle. Hits and misses are how many cycles running the tracker has
              and has not seen someone.
            </p>
          </PanelHeader>
          <PanelBody>
            {tracks.length === 0 ? (
              <p className="text-ink-2 text-sm leading-relaxed">
                {phase === 'running'
                  ? 'Nobody on the floor right now.'
                  : 'No tracks until the tracker is running.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-3 text-left text-xs">
                    <th className="pb-2 font-medium">Id</th>
                    <th className="pb-2 font-medium">x</th>
                    <th className="pb-2 font-medium">y</th>
                    <th className="pb-2 font-medium">Hits</th>
                    <th className="pb-2 font-medium">Misses</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {tracks.map((track) => (
                    <tr key={track.id} className="border-line border-t">
                      <td className="text-ink py-1.5">{track.id}</td>
                      <td className="text-ink-2 py-1.5">{track.x.toFixed(1)}</td>
                      <td className="text-ink-2 py-1.5">{track.y.toFixed(1)}</td>
                      <td className="text-ink-2 py-1.5">{track.hits}</td>
                      <td className="text-ink-2 py-1.5">{track.misses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PanelBody>
        </Panel>
      </div>

      <p className="text-ink-3 mt-4 text-xs leading-relaxed">
        Nobody here is identified — an id is a number the tracker hands out, and someone who leaves
        and returns gets a new one. This is the whole site's floor, not one branch's. Tracking
        starts by itself once every registered camera is{' '}
        <Link to="/calibration" className="text-ink-2 hover:text-accent underline">
          calibrated and aligned
        </Link>
        ; floor zones are drawn on{' '}
        <Link to="/zones" className="text-ink-2 hover:text-accent underline">
          Zones
        </Link>
        .
      </p>
    </Screen>
  )
}

/** A rectangle around everything there is to draw, when the tracker gave none. */
function boundsOf(tracks: PersonTrack[], points: Array<[number, number]>): PeopleRoom | null {
  const xs = [...tracks.map((t) => t.x), ...points.map((p) => p[0])]
  const ys = [...tracks.map((t) => t.y), ...points.map((p) => p[1])]
  if (xs.length === 0) return null
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  }
}

/**
 * The floor, in floor units: the SVG's viewBox IS the room rectangle (padded
 * a little), so every track and zone is drawn at its raw coordinate and no
 * scaling arithmetic is written here. Uniform scale ("meet"), so a square
 * room stays square.
 */
function FloorMap({
  room,
  tracks,
  zones,
  phase,
}: {
  room: PeopleRoom | null
  tracks: PersonTrack[]
  zones: Array<{ name: string; polygon_m: Array<[number, number]> | null }>
  phase: PeoplePhase | null
}) {
  if (!room) {
    return (
      <div className="text-ink-3 grid aspect-video place-items-center p-6 text-center text-sm">
        {phase === 'bootstrapping'
          ? 'The tracker is working out the room. The map appears when it is running.'
          : 'No floor to draw yet — the tracker has not measured the room.'}
      </div>
    )
  }
  const width = Math.max(room.xmax - room.xmin, 1)
  const height = Math.max(room.ymax - room.ymin, 1)
  const pad = Math.max(width, height) * 0.04
  const dot = Math.max(width, height) / 90

  return (
    <svg
      viewBox={`${room.xmin - pad} ${room.ymin - pad} ${width + 2 * pad} ${height + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
      className="bg-panel-2 aspect-video w-full"
      role="img"
      aria-label={`Floor map with ${tracks.length} tracked ${tracks.length === 1 ? 'person' : 'people'}`}
    >
      <rect
        x={room.xmin}
        y={room.ymin}
        width={width}
        height={height}
        fill="none"
        stroke="currentColor"
        className="text-ink-3"
        strokeWidth={dot / 4}
        strokeDasharray={`${dot} ${dot}`}
      />
      {zones.map((zone) =>
        zone.polygon_m && zone.polygon_m.length > 2 ? (
          <g key={zone.name}>
            <polygon
              points={zone.polygon_m.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="rgba(110, 160, 255, 0.15)"
              stroke="#6ea0ff"
              strokeWidth={dot / 3}
            />
            <text
              x={zone.polygon_m[0][0]}
              y={zone.polygon_m[0][1] - dot}
              fontSize={dot * 2.2}
              fill="#6ea0ff"
              fontFamily="system-ui, sans-serif"
            >
              {zone.name}
            </text>
          </g>
        ) : null,
      )}
      {tracks.map((track) => (
        <g key={track.id}>
          <circle cx={track.x} cy={track.y} r={dot * 1.4} fill="#ff9900" />
          <text
            x={track.x + dot * 2}
            y={track.y - dot * 1.5}
            fontSize={dot * 2.4}
            fontWeight={600}
            fill="currentColor"
            className="text-ink"
            fontFamily="system-ui, sans-serif"
          >
            {track.id}
          </text>
        </g>
      ))}
    </svg>
  )
}
