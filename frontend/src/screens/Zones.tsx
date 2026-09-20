import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageOff, Pentagon, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchCameraFrame, fetchCameras } from '@/api/endpoints/cameras'
import { createZone, deleteZone, fetchZones } from '@/api/endpoints/zones'
import { ApiError, describeApiError } from '@/api/errors'
import type { Camera, CameraZone } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import { Screen } from './Screen'

/**
 * Drawing the floor areas the detector counts people inside. Added
 * 2026-09-19, the first half of the AI/CV integration Wahib pointed the
 * frontend at (ai/reference_ui, contracts/ai-service.md §/zoning).
 *
 * This is ai/reference_ui/zoning/zone_app.py rebuilt on this side of the
 * backend: click points on a camera's own picture, close the polygon, name
 * it. The reference app is the interaction reference, not the surface - it
 * is a local Flask page that talks to the unauthenticated AI service
 * directly, which this dashboard must never do (repo CLAUDE.md, 2026-08-11).
 * Everything here goes through PROPOSED backend proxies; see
 * api/endpoints/zones.ts and BACKEND-ASKS.md §8.
 *
 * WHY THIS SCREEN MATTERS TO THE ONE NEXT TO IT
 *
 * The Occupancy screen reads counts per zone from the AI service's stream.
 * Until now nothing in this application could create a zone, so that screen
 * could only ever report on zones somebody had drawn with the AI service's
 * own tools. This is where they come from.
 *
 * PIXEL MODE ONLY, DELIBERATELY
 *
 * The AI service infers a zone's mode from how many cameras it is saved
 * with: one camera is `pixel` - counted against that camera's own raw
 * detections, no calibration anywhere - and two or more is `world`, which
 * requires the drawn-on camera to be calibrated AND aligned into a shared
 * floor frame or it answers 422. Calibration is its own screen and its own
 * phase; offering a multi-camera zone before it exists would offer a button
 * whose only outcome is a refusal. A `world` zone made elsewhere still shows
 * in the list, read as what it is.
 *
 * THE PICTURE PLAYS UNTIL YOU CLICK, THEN HOLDS STILL
 *
 * The frame is the paper being drawn on: if it kept refreshing under a
 * half-finished polygon, the points would still be in the right pixels but
 * the room beneath them would have walked away. So the first click freezes
 * it, and clearing the points lets it play again.
 *
 * Freezing it BEFORE the first click, which is what this did originally,
 * buys nothing and costs the only thing that makes a camera legible - being
 * able to see it move. Someone drawing a queue area wants to watch the
 * queue for a few seconds first.
 *
 * KEYBOARD
 *
 * Placing a point is a pointer act and there is no honest keyboard
 * equivalent - "arrow keys to nudge a crosshair" would be a worse tool
 * pretending to be an accessible one. What is keyboard-reachable is
 * everything around it: the pickers, undo, clear, save, delete, and a live
 * region that announces each point as it lands, so the polygon's state is
 * legible without seeing the canvas. Said plainly here rather than left for
 * someone to discover.
 */

type Point = [number, number]

/* The live view's cadence, which matches the detectors' update_interval. */
const FRAME_MS = 2_000

export default function Zones() {
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
  /* Same order of preference as Cameras: what an admin picked here, then the
     branch open elsewhere, then the first branch. Everyone else has one. */
  const agencyId = isAdmin
    ? (pickedAgencyId ?? scope.agencyId ?? agencies.data?.[0]?.id ?? null)
    : (user?.agency_id ?? null)

  const cameras = useQuery({
    queryKey: ['cameras', agencyId],
    queryFn: ({ signal }) => fetchCameras(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: ({ signal }) => fetchZones(signal),
  })

  const cameraRows = useMemo(
    () => [...(cameras.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [cameras.data],
  )

  const [pickedCameraId, setPickedCameraId] = useState<string | null>(null)
  const camera: Camera | null =
    cameraRows.find((c) => c.id === pickedCameraId) ?? cameraRows[0] ?? null

  /* Points are in the frame's own pixels, which is what the AI service
     stores and what a later frame of the same camera can be redrawn with. */
  const [points, setPoints] = useState<Point[]>([])
  const [naming, setNaming] = useState(false)

  /* Switching camera or branch abandons the polygon rather than carrying it
     over: the same coordinates mean a different place on a different
     camera, and silently moving someone's work is worse than dropping it. */
  useEffect(() => {
    setPoints([])
  }, [camera?.id])

  const save = useMutation({
    mutationFn: (name: string) =>
      createZone({ name, camera_id: camera?.id as string, polygon: points }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['zones'] })
      setPoints([])
      setNaming(false)
      setLastSaved(saved.warnings.length > 0 ? saved.warnings : null)
    },
  })

  /* Warnings from the AI service, passed through by the proxy. Kept on
     screen after the dialog closes because they describe the zone that was
     just saved, not the act of saving it. */
  const [lastSaved, setLastSaved] = useState<string[] | null>(null)

  const remove = useMutation({
    mutationFn: (zone: CameraZone) => deleteZone(zone.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['zones'] })
    },
  })

  const zonesHere = useMemo(
    () =>
      (zones.data ?? [])
        .filter((zone) => zone.camera_id === camera?.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [zones.data, camera?.id],
  )
  const zonesElsewhere = useMemo(
    () => (zones.data ?? []).filter((zone) => zone.camera_id !== camera?.id).length,
    [zones.data, camera?.id],
  )

  const existingNames = useMemo(
    () => new Set((zones.data ?? []).map((zone) => zone.name)),
    [zones.data],
  )

  return (
    <Screen
      title="Zones"
      description="The floor areas the detector counts people inside, drawn on the camera that watches them."
    >
      <div className="mb-4 flex flex-wrap gap-3">
        {isAdmin && (
          <div className="max-w-xs flex-1">
            <label
              htmlFor="zones_agency"
              className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
            >
              Branch
            </label>
            <select
              id="zones_agency"
              className={controlClass()}
              value={agencyId ?? ''}
              onChange={(e) => {
                setPickedAgencyId(e.target.value || null)
                setPickedCameraId(null)
              }}
            >
              {(agencies.data ?? []).map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {cameraRows.length > 0 && (
          <div className="max-w-xs flex-1">
            <label
              htmlFor="zones_camera"
              className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
            >
              Camera
            </label>
            <select
              id="zones_camera"
              className={controlClass()}
              value={camera?.id ?? ''}
              onChange={(e) => setPickedCameraId(e.target.value || null)}
            >
              {cameraRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <AsyncBoundary
        isPending={cameras.isPending}
        error={cameras.error}
        isEmpty={cameraRows.length === 0}
        emptyMessage="No cameras in this branch yet. A zone is drawn on a camera's own picture, so register one first."
        forbiddenMessage="Zones are drawn by administrators and managers. Ask an administrator if you need access."
        onRetry={() => void cameras.refetch()}
        skeletonRows={3}
      >
        {camera && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <Drawing
              camera={camera}
              points={points}
              zones={zonesHere}
              drawing={points.length > 0}
              onAddPoint={(point) => setPoints((current) => [...current, point])}
              onUndo={() => setPoints((current) => current.slice(0, -1))}
              onClear={() => setPoints([])}
              onClose={() => setNaming(true)}
            />

            <div className="space-y-3">
              {lastSaved && (
                <Panel as="section" tone="alert">
                  <PanelBody>
                    <h2 className="text-warn text-sm font-semibold">Saved, with a warning</h2>
                    <ul className="text-ink-2 mt-2 space-y-1 text-sm leading-relaxed">
                      {lastSaved.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </PanelBody>
                </Panel>
              )}

              <Panel as="section">
                <PanelHeader>
                  <h2 className="text-ink text-sm font-semibold">Zones on {camera.name}</h2>
                  <p className="text-ink-3 mt-1 text-xs">
                    {zonesElsewhere > 0
                      ? `${zonesElsewhere} more on other cameras.`
                      : 'Every zone this branch has is on this camera.'}
                  </p>
                </PanelHeader>
                <PanelBody>
                  {zones.isPending ? (
                    <p className="text-ink-3 text-sm">Loading zones…</p>
                  ) : zones.error ? (
                    <p className="text-ink-2 text-sm">
                      {zones.error instanceof ApiError
                        ? describeApiError(zones.error)
                        : 'Could not read the zones.'}
                    </p>
                  ) : zonesHere.length === 0 ? (
                    <p className="text-ink-2 text-sm leading-relaxed">
                      Nothing drawn on this camera yet. Click three or more points on the picture to
                      trace an area.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {zonesHere.map((zone) => (
                        <li
                          key={zone.name}
                          className="border-line bg-panel-2 flex items-center gap-2 rounded-lg border px-3 py-2"
                        >
                          <span className="text-ink min-w-0 flex-1 truncate text-sm font-medium">
                            {zone.name}
                          </span>
                          {/* Read, not assumed: a world zone drawn with the
                              AI service's own tools counts against the
                              shared floor frame, not this picture. */}
                          <Badge tone={zone.mode === 'world' ? 'info' : 'neutral'}>
                            {zone.mode}
                          </Badge>
                          <span className="text-ink-3 tabular text-xs">
                            {zone.polygon_px?.length ?? zone.polygon_m?.length ?? 0} pts
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${zone.name}`}
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(zone)}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {remove.error != null && (
                    <p
                      role="alert"
                      className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm"
                    >
                      {remove.error instanceof ApiError
                        ? describeApiError(remove.error)
                        : 'Could not delete that zone.'}
                    </p>
                  )}
                </PanelBody>
              </Panel>

              <Panel as="section">
                <PanelBody>
                  <h2 className="text-ink text-sm font-semibold">How a zone is counted</h2>
                  <p className="text-ink-2 mt-2 text-sm leading-relaxed">
                    A person counts when their feet land inside the outline, checked against this
                    camera's own detections. Nothing is measured in metres and no calibration is
                    involved, so a zone here cannot disagree with another camera — it simply does
                    not know about one.
                  </p>
                  <p className="text-ink-3 mt-2 text-xs leading-relaxed">
                    Areas spanning several cameras need the site calibrated first. That is a
                    separate screen and it does not exist yet.
                  </p>
                </PanelBody>
              </Panel>
            </div>
          </div>
        )}
      </AsyncBoundary>

      <Dialog
        open={naming}
        title="Name this zone"
        description="The name is how the occupancy feed reports it."
        onClose={() => {
          setNaming(false)
          save.reset()
        }}
      >
        {naming && (
          <NameForm
            points={points.length}
            existingNames={existingNames}
            pending={save.isPending}
            error={save.error}
            onCancel={() => {
              setNaming(false)
              save.reset()
            }}
            onSubmit={(name) => save.mutate(name)}
          />
        )}
      </Dialog>
    </Screen>
  )
}

/**
 * The picture, the polygon over it, and the three controls that change it.
 *
 * The overlay is an <svg> with viewBox set to the frame's natural size, laid
 * over the <img> with the same object-fit - the same arrangement CameraView
 * uses for detection boxes, for the same reason: every coordinate stays in
 * source pixels and no scaling arithmetic is written by hand. Clicks come
 * back the other way through getScreenCTM().inverse(), which accounts for
 * the letterboxing that object-contain introduces at any other aspect ratio.
 */
function Drawing({
  camera,
  points,
  zones,
  drawing,
  onAddPoint,
  onUndo,
  onClear,
  onClose,
}: {
  camera: Camera
  points: Point[]
  zones: CameraZone[]
  drawing: boolean
  onAddPoint: (point: Point) => void
  onUndo: () => void
  onClear: () => void
  onClose: () => void
}) {
  /* Plays until the first point of a polygon lands, then holds still: the
     points are in frame pixels, so a picture that kept moving would leave a
     half-drawn zone tracing a room that has walked away. Clearing the points
     lets it play again. Same rule as the calibration canvases. */
  const frame = useQuery({
    queryKey: ['cameraFrame', camera.id],
    queryFn: ({ signal }) => fetchCameraFrame(camera.id, signal),
    retry: false,
    refetchInterval: drawing ? false : FRAME_MS,
    placeholderData: (previous) => previous,
    gcTime: 0,
  })

  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!frame.data) return
    const url = URL.createObjectURL(frame.data)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [frame.data])

  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const noFrame = frame.isError
  const unavailable =
    frame.error instanceof ApiError && frame.error.status === 404
      ? `The detector cannot open ${camera.name}’s stream, so there is no picture to draw on.`
      : 'Could not fetch a picture from this camera.'

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    onAddPoint([Math.round(point.x), Math.round(point.y)])
  }

  return (
    <Panel as="section">
      <PanelHeader
        action={
          <Button
            size="sm"
            variant="ghost"
            /* Refetching under a half-drawn polygon would leave the points
               in the right pixels over a room that has moved. */
            disabled={drawing || frame.isFetching}
            onClick={() => void frame.refetch()}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {frame.isFetching ? 'Refreshing…' : 'Refresh picture'}
          </Button>
        }
      >
        <div className="flex items-center gap-2.5">
          <Pentagon className="text-ink-3 size-4 shrink-0" aria-hidden />
          <h2 className="text-ink truncate text-sm font-semibold">{camera.name}</h2>
        </div>
        <p className="text-ink-3 mt-1 text-xs leading-relaxed">
          Click three or more points to trace an area. The dashed edge is the side that closes it.
        </p>
        <p className="text-ink-3 mt-1 text-xs">
          {drawing
            ? 'Held still while you draw — clear the points to let it play again.'
            : 'Playing. It freezes as soon as you place a point.'}
        </p>
      </PanelHeader>

      <PanelBody className="p-0">
        <div className="bg-ink/90 relative aspect-video w-full overflow-hidden">
          {src && !noFrame ? (
            <img
              src={src}
              alt={`Current frame from ${camera.name}`}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={(e) =>
                setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
              }
            />
          ) : (
            <div className="text-ink-3 absolute inset-0 grid place-items-center p-6 text-center text-sm">
              <div>
                <ImageOff className="mx-auto mb-2 size-6" aria-hidden />
                {noFrame ? unavailable : 'Waiting for the picture…'}
              </div>
            </div>
          )}

          {size && !noFrame && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-0 h-full w-full cursor-crosshair"
              onClick={handleClick}
              role="presentation"
            >
              {/* Zones already saved on this camera, so a new one can be
                  drawn next to them rather than blindly on top. */}
              {zones.map((zone) =>
                zone.polygon_px && zone.polygon_px.length > 2 ? (
                  <polygon
                    key={zone.name}
                    points={zone.polygon_px.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="rgba(110, 160, 255, 0.12)"
                    stroke="#6ea0ff"
                    strokeWidth={Math.max(2, Math.round(size.w / 480))}
                  />
                ) : null,
              )}

              <Outline points={points} width={size.w} />
            </svg>
          )}
        </div>
      </PanelBody>

      <PanelBody>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={points.length === 0} onClick={onUndo}>
            <Undo2 className="size-3.5" aria-hidden />
            Undo last point
          </Button>
          <Button size="sm" disabled={points.length === 0} onClick={onClear}>
            Clear
          </Button>
          <Button size="sm" variant="primary" disabled={points.length < 3} onClick={onClose}>
            Close zone
          </Button>
          {/* The polygon's state in words, for anyone not reading the
              picture - and announced as it changes. */}
          <p role="status" aria-live="polite" className="text-ink-3 text-xs">
            {points.length === 0
              ? 'No points yet.'
              : points.length < 3
                ? `${points.length} point${points.length === 1 ? '' : 's'} — at least 3 needed.`
                : `${points.length} points, last at ${points[points.length - 1][0]}, ${points[points.length - 1][1]}.`}
          </p>
        </div>
      </PanelBody>
    </Panel>
  )
}

/** The polygon being drawn: solid where it was clicked, dashed where it will close. */
function Outline({ points, width }: { points: Point[]; width: number }) {
  if (points.length === 0) return null
  const stroke = Math.max(2, Math.round(width / 480))
  const [firstX, firstY] = points[0]
  const [lastX, lastY] = points[points.length - 1]

  return (
    <g>
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill={points.length > 2 ? 'rgba(255, 153, 0, 0.12)' : 'none'}
        stroke="#ff9900"
        strokeWidth={stroke}
      />
      {points.length > 2 && (
        <line
          x1={lastX}
          y1={lastY}
          x2={firstX}
          y2={firstY}
          stroke="#ffcc66"
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 4} ${stroke * 4}`}
        />
      )}
      {points.map(([x, y], i) => (
        <circle
          key={`${x}-${y}-${i}`}
          cx={x}
          cy={y}
          r={i === 0 ? stroke * 3 : stroke * 2}
          fill={i === 0 ? '#4ade80' : '#ff9900'}
        />
      ))}
    </g>
  )
}

/**
 * Naming is a dialog rather than the reference app's window.prompt(): a
 * prompt cannot say that the name is already taken, and here that is not a
 * validation error but a destructive one - the AI service REPLACES a zone
 * whose name is re-posted, mode and all. So the collision is said out loud
 * before the button is pressed, and the button changes its word.
 */
function NameForm({
  points,
  existingNames,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  points: number
  existingNames: Set<string>
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const replacing = trimmed.length > 0 && existingNames.has(trimmed)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (trimmed.length === 0) return
    onSubmit(trimmed)
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="text-ink-2 mb-4 text-sm leading-relaxed">
        {points} points, closed back to the first one.
      </p>

      <Field
        id="zone_name"
        label="Name"
        required
        hint={replacing ? undefined : 'How the occupancy feed will report this area.'}
      >
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

      {replacing && (
        <p className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm leading-relaxed">
          A zone called <span className="font-medium">{trimmed}</span> already exists. Saving
          replaces its outline — there is no second copy and no undo.
        </p>
      )}

      {error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
        >
          {error instanceof ApiError ? describeApiError(error) : 'Could not save this zone.'}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || trimmed.length === 0}>
          {pending ? 'Saving…' : replacing ? 'Replace zone' : 'Save zone'}
        </Button>
      </div>
    </form>
  )
}
