import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, ImageOff, Ruler, Trash2, Undo2 } from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import {
  alignCameras,
  calibrateRect,
  deleteCalibration,
  fetchCalibration,
} from '@/api/endpoints/calibration'
import { fetchCameras, fetchNativeFrame } from '@/api/endpoints/cameras'
import { ApiError, describeApiError } from '@/api/errors'
import type { AlignResult, Camera, CameraCalibration, SharedPoint } from '@/api/types'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import { Screen } from './Screen'

/**
 * Site calibration: teaching the cameras where the floor is. Added
 * 2026-09-20, from ai/reference_ui/calibration rebuilt on this side of the
 * backend (contracts/ai-service.md §/calibration, proxies in
 * BACKEND-ASKS.md §8b).
 *
 * WHAT IT IS FOR, since nothing on this screen is visible in the product:
 * a pixel is not a place. One camera's "that person is at (410, 620)" means
 * nothing to another camera, and nothing at all in metres. Calibration turns
 * pixels into floor positions; alignment makes every camera agree on the
 * same floor. World-mode zones and person tracking are built on it, and
 * neither can exist until this is done once per site.
 *
 * TWO STEPS, AND THE SECOND IS NOT OPTIONAL
 *
 * 1. CALIBRATE one camera: click 4 points around something that is a right
 *    angle in real life. No measuring, no numbers - the rectangle's true
 *    proportions are inferred from the perspective in those 4 points.
 * 2. ALIGN the cameras: click the same real spot in two or more of them,
 *    record it, repeat. Until this runs, every camera has invented its own
 *    private coordinate system and two cameras can each look perfect while
 *    disagreeing by metres about where the same person is standing.
 *
 * THE REPROJECTION ERROR IS A TRAP AND IS NOT SHOWN AS ACCURACY
 *
 * A 4-point fit is exact by construction, so `px_err` comes back ~0 whether
 * or not the clicked shape really was a right angle. The contract says so
 * outright. Showing it as a score would teach people to trust a calibration
 * that may be badly wrong. What IS worth reading is `aspect_confident`:
 * false means the geometry was too degenerate to infer the shape and a
 * square was guessed, and that is surfaced loudly.
 *
 * WHAT THIS PASS LEAVES OUT, deliberately: the bird's-eye overlay, entry
 * gates, alignment by shared LINES, and cross-check. The first two are not
 * read by anything in this dashboard; cross-check is verification of an
 * alignment and belongs with the BEV view that makes a bad one visible.
 *
 * KEYBOARD: placing a point is a pointer act, as on the Zones screen. Every
 * control around it is reachable, and a live region reads out each point as
 * it lands.
 */

type Point = [number, number]
type Mode = 'calibrate' | 'align'

export default function Calibration() {
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

  const cameras = useQuery({
    queryKey: ['cameras', agencyId],
    queryFn: ({ signal }) => fetchCameras(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const calibration = useQuery({
    queryKey: ['calibration'],
    queryFn: ({ signal }) => fetchCalibration(signal),
  })

  const cameraRows = useMemo(
    () => [...(cameras.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [cameras.data],
  )
  const byCamera = useMemo(
    () => new Map((calibration.data ?? []).map((entry) => [entry.camera_id, entry])),
    [calibration.data],
  )

  const [mode, setMode] = useState<Mode>('calibrate')

  return (
    <Screen
      title="Calibration"
      description="Teaching the cameras where the floor is, so they can agree on where somebody is standing."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {isAdmin && (
          <div className="max-w-xs flex-1">
            <label
              htmlFor="calibration_agency"
              className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
            >
              Branch
            </label>
            <select
              id="calibration_agency"
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

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === 'calibrate' ? 'primary' : 'secondary'}
            onClick={() => setMode('calibrate')}
          >
            1. Calibrate a camera
          </Button>
          <Button
            size="sm"
            variant={mode === 'align' ? 'primary' : 'secondary'}
            onClick={() => setMode('align')}
          >
            2. Align the cameras
          </Button>
        </div>
      </div>

      <AsyncBoundary
        isPending={cameras.isPending}
        error={cameras.error}
        isEmpty={cameraRows.length === 0}
        emptyMessage="No cameras in this branch yet. Calibration is per camera, so register one first."
        forbiddenMessage="Calibration is done by administrators and managers. Ask an administrator if you need access."
        onRetry={() => void cameras.refetch()}
        skeletonRows={3}
      >
        {mode === 'calibrate' ? (
          <CalibrateMode
            cameras={cameraRows}
            byCamera={byCamera}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: ['calibration'] })}
          />
        ) : (
          <AlignMode
            cameras={cameraRows}
            byCamera={byCamera}
            onAligned={() => void queryClient.invalidateQueries({ queryKey: ['calibration'] })}
          />
        )}
      </AsyncBoundary>

      {/* Where this actually gets used, for anyone wondering why they are
          clicking floor tiles. */}
      <p className="text-ink-3 mt-4 text-xs leading-relaxed">
        Zones spanning several cameras and person tracking both need this done.{' '}
        <Link to="/zones" className="text-ink-2 hover:text-accent underline">
          Zones
        </Link>{' '}
        drawn on a single camera do not.
      </p>
    </Screen>
  )
}

/* ---------------------------------------------------------------- step 1 */

function CalibrateMode({
  cameras,
  byCamera,
  onSaved,
}: {
  cameras: Camera[]
  byCamera: Map<string, CameraCalibration>
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const camera = cameras.find((c) => c.id === pickedId) ?? cameras[0] ?? null

  const [points, setPoints] = useState<Point[]>([])
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    setPoints([])
  }, [camera?.id])

  const save = useMutation({
    mutationFn: () =>
      calibrateRect({
        camera_id: camera?.id as string,
        points,
        img_w: size?.w as number,
        img_h: size?.h as number,
      }),
    onSuccess: () => {
      setPoints([])
      onSaved()
    },
  })

  const forget = useMutation({
    mutationFn: (cameraId: string) => deleteCalibration(cameraId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calibration'] })
    },
  })

  const current = camera ? byCamera.get(camera.id) : undefined

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div>
        <div className="mb-3 max-w-xs">
          <label
            htmlFor="calibration_camera"
            className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
          >
            Camera
          </label>
          <select
            id="calibration_camera"
            className={controlClass()}
            value={camera?.id ?? ''}
            onChange={(e) => setPickedId(e.target.value || null)}
          >
            {cameras.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        {camera && (
          <FrameCanvas
            camera={camera}
            points={points}
            maxPoints={4}
            onAddPoint={(point) => setPoints((current) => [...current, point])}
            onSize={setSize}
            hint="Click 4 corners of something you are sure is a right angle in real life — a floor tile, a rug, a doormat. Any rectangle works; you do not need a square and you do not measure anything."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={points.length === 0}
                  onClick={() => setPoints((current) => current.slice(0, -1))}
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  Undo last point
                </Button>
                <Button size="sm" disabled={points.length === 0} onClick={() => setPoints([])}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={points.length !== 4 || size === null || save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? 'Saving…' : 'Compute and save'}
                </Button>
                <p role="status" aria-live="polite" className="text-ink-3 text-xs">
                  {points.length === 0
                    ? 'No corners yet — 4 needed.'
                    : points.length < 4
                      ? `${points.length} of 4 corners.`
                      : 'All 4 corners placed.'}
                </p>
              </div>
            }
          />
        )}

        {save.error != null && (
          <p
            role="alert"
            className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm"
          >
            {save.error instanceof ApiError
              ? describeApiError(save.error)
              : 'Could not compute this calibration.'}
          </p>
        )}

        {save.data && <RectResult result={save.data} />}
      </div>

      <div className="space-y-3">
        <Panel as="section">
          <PanelHeader>
            <h2 className="text-ink text-sm font-semibold">This branch's cameras</h2>
            <p className="text-ink-3 mt-1 text-xs">
              Calibrated is per camera. Aligned is the whole site agreeing.
            </p>
          </PanelHeader>
          <PanelBody>
            <ul className="space-y-2">
              {cameras.map((row) => {
                const entry = byCamera.get(row.id)
                return (
                  <li
                    key={row.id}
                    className="border-line bg-panel-2 flex items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="text-ink min-w-0 flex-1 truncate text-sm">{row.name}</span>
                    {entry ? (
                      <>
                        <Badge tone={entry.aligned ? 'ok' : 'warn'}>
                          {entry.aligned ? 'aligned' : 'not aligned'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Forget calibration for ${row.name}`}
                          disabled={forget.isPending}
                          onClick={() => forget.mutate(row.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </>
                    ) : (
                      <Badge tone="neutral">not calibrated</Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          </PanelBody>
        </Panel>

        {current && <Diagnostics entry={current} />}

        <Panel as="section">
          <PanelBody>
            <h2 className="text-ink text-sm font-semibold">Why the error figure is missing</h2>
            <p className="text-ink-2 mt-2 text-sm leading-relaxed">
              A four-point fit always reports near-zero reprojection error, whether or not the shape
              you clicked really was a right angle. It says the maths ran, not that it is correct —
              so it is not shown as a score. What matters is whether the shape's proportions could
              be inferred, which is stated above when a calibration is saved.
            </p>
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}

function RectResult({
  result,
}: {
  result: { aspect_confident?: boolean; inferred_aspect?: number; aspect_source?: string }
}) {
  const confident = result.aspect_confident !== false
  return (
    <Panel as="section" tone={confident ? 'neutral' : 'alert'} className="mt-3">
      <PanelBody>
        <h2 className="text-ink text-sm font-semibold">
          {confident ? 'Calibrated' : 'Calibrated, but the shape was guessed'}
        </h2>
        <p className="text-ink-2 mt-2 text-sm leading-relaxed">
          {confident ? (
            <>
              The rectangle's proportions were inferred from its own perspective —{' '}
              <span className="text-ink tabular">{result.inferred_aspect}</span> wide for every 1
              tall. This camera still has to be aligned with the others before anything can use it.
            </>
          ) : (
            <>
              The four points were too flat or too close together to work out the real proportions,
              so a square was assumed. Re-click a larger, clearer rectangle, or fix it by aligning
              this camera against four or more shared points, which replaces this fit outright.
            </>
          )}
        </p>
      </PanelBody>
    </Panel>
  )
}

function Diagnostics({ entry }: { entry: CameraCalibration }) {
  const d = entry.diagnostics
  return (
    <Panel as="section">
      <PanelHeader>
        <h2 className="text-ink text-sm font-semibold">What this camera knows</h2>
      </PanelHeader>
      <PanelBody>
        <dl className="space-y-2 text-sm">
          <Row label="Shape inferred" value={d.aspect_confident === false ? 'guessed' : 'yes'} />
          {d.inferred_aspect !== undefined && (
            <Row label="Proportions" value={`${d.inferred_aspect} : 1`} />
          )}
          {d.calib_res && <Row label="Measured at" value={`${d.calib_res[0]}×${d.calib_res[1]}`} />}
          <Row label="Aligned" value={entry.aligned ? 'yes' : 'not yet'} />
          {d.fit && <Row label="Aligned by" value={d.fit} />}
          {d.aligned_with_n_points !== undefined && (
            <Row label="Shared points used" value={String(d.aligned_with_n_points)} />
          )}
        </dl>
      </PanelBody>
    </Panel>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3 text-xs">{label}</dt>
      <dd className="text-ink tabular text-sm">{value}</dd>
    </div>
  )
}

/* ---------------------------------------------------------------- step 2 */

/**
 * Alignment: the same real spot, clicked in several cameras.
 *
 * The accumulated list is held here and sent WHOLE every time, because the
 * service re-solves from scratch - sending only the newest point would throw
 * away every earlier one. A camera that cannot be reached comes back
 * `aligned: false` with the call still returning 200, so the results are
 * read per camera rather than assumed from the status code.
 */
function AlignMode({
  cameras,
  byCamera,
  onAligned,
}: {
  cameras: Camera[]
  byCamera: Map<string, CameraCalibration>
  onAligned: () => void
}) {
  const calibrated = useMemo(
    () => cameras.filter((camera) => byCamera.has(camera.id)),
    [cameras, byCamera],
  )

  const [pending, setPending] = useState<SharedPoint>({})
  const [recorded, setRecorded] = useState<SharedPoint[]>([])

  const run = useMutation({
    mutationFn: () => alignCameras(recorded),
    onSuccess: () => onAligned(),
  })

  const pendingCount = Object.keys(pending).length

  /**
   * How many recorded spots each pair of cameras has in common.
   *
   * This is the number the solve actually turns on, and it used to be
   * invisible until after the attempt: record one spot, press align, and
   * read "no chain of >=2-point camera pairs connects this camera back to
   * the reference" - which is accurate, arrives too late, and sounds like a
   * fault rather than "click one more spot".
   *
   * Two is the threshold because one matched point fixes position and
   * nothing else: rotation and scale are still free, so there are infinitely
   * many ways to place the other camera's floor that satisfy it. The service
   * refuses instead of guessing.
   */
  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const point of recorded) {
      const ids = Object.keys(point).sort()
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const key = `${ids[i]}|${ids[j]}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
    }
    return counts
  }, [recorded])

  const readyPairs = useMemo(
    () => [...pairCounts.values()].filter((n) => n >= 2).length,
    [pairCounts],
  )

  if (calibrated.length < 2) {
    return (
      <Panel as="section">
        <PanelBody className="flex gap-3">
          <AlertTriangle className="text-ink-3 mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <h2 className="text-ink text-sm font-semibold">Calibrate at least two cameras first</h2>
            <p className="text-ink-2 mt-1 text-sm leading-relaxed">
              Alignment reconciles cameras with each other, so there is nothing to reconcile until
              two of them have been calibrated on their own.{' '}
              {calibrated.length === 1 && 'One is done.'}
            </p>
          </div>
        </PanelBody>
      </Panel>
    )
  }

  return (
    <div>
      <Panel as="section" className="mb-3">
        <PanelBody>
          <h2 className="text-ink text-sm font-semibold">Click one real spot in each camera</h2>
          <p className="text-ink-2 mt-2 text-sm leading-relaxed">
            Pick something you can identify in more than one view — a corner of a mat, a chair leg,
            a mark on the floor. Click it in each camera that can see it, then record it. Repeat
            with a few different spots. Two cameras need at least 2 spots in common to be tied
            together, and 4 or more lets the alignment repair a camera's own rectangle outright.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pendingCount < 2}
              onClick={() => {
                setRecorded((current) => [...current, pending])
                setPending({})
              }}
            >
              Record this spot
            </Button>
            <Button size="sm" disabled={pendingCount === 0} onClick={() => setPending({})}>
              Clear this spot
            </Button>
            <Button
              size="sm"
              variant="primary"
              /* Not "at least one spot": a single spot cannot tie any pair
                 together, so offering the solve there only produces the
                 refusal above. */
              disabled={readyPairs === 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Aligning…' : 'Align the cameras'}
            </Button>
            <p role="status" aria-live="polite" className="text-ink-3 text-xs">
              {pendingCount > 0
                ? `This spot is marked in ${pendingCount} camera${pendingCount === 1 ? '' : 's'} — 2 needed to record it.`
                : recorded.length === 0
                  ? 'No spots recorded yet.'
                  : readyPairs === 0
                    ? `${recorded.length} spot${recorded.length === 1 ? '' : 's'} recorded — no two cameras share 2 yet, which is the minimum to tie a pair together.`
                    : `${recorded.length} spot${recorded.length === 1 ? '' : 's'} recorded.`}
            </p>
            {recorded.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setRecorded([])}>
                Start over
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>

      {recorded.length > 0 && (
        <Panel as="section" className="mb-3">
          <PanelBody>
            <h3 className="text-ink-2 text-xs font-medium">Spots shared, camera by camera</h3>
            <ul className="mt-2 space-y-1">
              {calibrated.flatMap((a, i) =>
                calibrated.slice(i + 1).map((b) => {
                  const key = [a.id, b.id].sort().join('|')
                  const count = pairCounts.get(key) ?? 0
                  return (
                    <li key={key} className="flex items-center gap-2 text-sm">
                      <span className="text-ink-2 min-w-0 flex-1 truncate">
                        {a.name} ↔ {b.name}
                      </span>
                      <Badge tone={count >= 2 ? 'ok' : 'neutral'}>
                        {count >= 2 ? `${count} spots` : `${count} of 2`}
                      </Badge>
                    </li>
                  )
                }),
              )}
            </ul>
          </PanelBody>
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {calibrated.map((camera) => (
          <FrameCanvas
            key={camera.id}
            camera={camera}
            points={pending[camera.id] ? [pending[camera.id]] : []}
            maxPoints={1}
            onAddPoint={(point) => setPending((current) => ({ ...current, [camera.id]: point }))}
            hint="Click the same real spot you clicked in the other cameras."
          />
        ))}
      </div>

      {run.error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm"
        >
          {run.error instanceof ApiError
            ? describeApiError(run.error)
            : 'Could not align the cameras.'}
        </p>
      )}

      {run.data && <AlignReport result={run.data} cameras={cameras} />}
    </div>
  )
}

function AlignReport({ result, cameras }: { result: AlignResult; cameras: Camera[] }) {
  const nameOf = (id: string) => cameras.find((camera) => camera.id === id)?.name ?? id
  const entries = Object.entries(result.results)
  const failed = entries.filter(([, value]) => !value.aligned)
  /* The contract calls this `results_warning`; the service emits
     `reference_warning`. Both are read so neither is silently dropped. */
  const referenceWarning = result.reference_warning ?? result.results_warning

  return (
    <Panel as="section" tone={failed.length > 0 ? 'alert' : 'neutral'} className="mt-3">
      <PanelHeader>
        <h2 className="text-ink text-sm font-semibold">
          {failed.length === 0
            ? 'Every camera is on the same floor now'
            : `${failed.length} camera${failed.length === 1 ? '' : 's'} could not be reached`}
        </h2>
        <p className="text-ink-3 mt-1 text-xs">
          Everything was reconciled onto {nameOf(result.reference)}.
        </p>
      </PanelHeader>
      <PanelBody>
        <ul className="space-y-2">
          {entries.map(([cameraId, value]) => (
            <li
              key={cameraId}
              className="border-line bg-panel-2 rounded-lg border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                  {nameOf(cameraId)}
                </span>
                {value.reference && <Badge tone="info">reference</Badge>}
                <Badge tone={value.aligned ? 'ok' : 'warn'}>
                  {value.aligned ? 'aligned' : 'not aligned'}
                </Badge>
              </div>
              {value.error && <p className="text-ink-2 mt-1.5 text-xs">{value.error}</p>}
              {value.aligned && !value.reference && (
                <p className="text-ink-3 mt-1.5 text-xs">
                  Tied to {nameOf(value.via ?? '')} with {value.n_points} shared spot
                  {value.n_points === 1 ? '' : 's'}
                  {value.order_reversed && ' — point order was reversed to fit better'}.
                </p>
              )}
            </li>
          ))}
        </ul>

        {referenceWarning && (
          <p className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm leading-relaxed">
            {referenceWarning}
          </p>
        )}
        {result.weak_fits && (
          <p className="text-ink-2 mt-3 text-sm leading-relaxed">{result.weak_fits}</p>
        )}

        {result.residual_checks.length > 0 && (
          <p className="text-ink-3 mt-3 text-xs leading-relaxed">
            Across the spots you recorded, the cameras now place the same point within{' '}
            <span className="text-ink-2 tabular">
              {Math.max(
                0,
                ...result.residual_checks.flatMap((check) =>
                  check.pairs.map((pair) => pair.distance_cm),
                ),
              ).toFixed(1)}{' '}
              cm
            </span>{' '}
            of each other at worst. Small is the whole point; metres mean the alignment did not
            take.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}

/* ------------------------------------------------------------------ both */

/**
 * A camera's picture with clickable points on it.
 *
 * The frame is NATIVE resolution here, not the detector-scaled one the live
 * view uses: the clicked points are sent with `img_w`/`img_h` and the
 * service assumes the image centre is the principal point, so points
 * measured on a resized frame describe a camera that does not exist.
 *
 * Fetched once and never refetched - the picture is the thing being
 * measured, and swapping it under placed points would silently move them to
 * a different room.
 */
function FrameCanvas({
  camera,
  points,
  maxPoints,
  onAddPoint,
  onSize,
  hint,
  footer,
}: {
  camera: Camera
  points: Point[]
  maxPoints: number
  onAddPoint: (point: Point) => void
  onSize?: (size: { w: number; h: number }) => void
  hint: string
  footer?: React.ReactNode
}) {
  const frame = useQuery({
    queryKey: ['nativeFrame', camera.id],
    queryFn: ({ signal }) => fetchNativeFrame(camera.id, signal),
    retry: false,
    staleTime: Infinity,
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
      ? `The detector cannot open ${camera.name}’s stream, so there is nothing to measure.`
      : 'Could not fetch a picture from this camera.'

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (points.length >= maxPoints) return
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    onAddPoint([Math.round(point.x), Math.round(point.y)])
  }

  return (
    <Panel as="section">
      <PanelHeader>
        <div className="flex items-center gap-2.5">
          <Ruler className="text-ink-3 size-4 shrink-0" aria-hidden />
          <h2 className="text-ink truncate text-sm font-semibold">{camera.name}</h2>
        </div>
        <p className="text-ink-3 mt-1 text-xs leading-relaxed">{hint}</p>
      </PanelHeader>

      <PanelBody className="p-0">
        <div className="bg-ink/90 relative aspect-video w-full overflow-hidden">
          {src && !noFrame ? (
            <img
              src={src}
              alt={`Current frame from ${camera.name}`}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={(e) => {
                const next = {
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                }
                setSize(next)
                onSize?.(next)
              }}
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
              className={`absolute inset-0 h-full w-full ${
                points.length >= maxPoints ? 'cursor-default' : 'cursor-crosshair'
              }`}
              onClick={handleClick}
              role="presentation"
            >
              {points.length > 1 && (
                <polygon
                  points={points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="rgba(255, 153, 0, 0.12)"
                  stroke="#ff9900"
                  strokeWidth={Math.max(2, Math.round(size.w / 480))}
                />
              )}
              {points.map(([x, y], i) => (
                <g key={`${x}-${y}-${i}`}>
                  <circle
                    cx={x}
                    cy={y}
                    r={Math.max(5, Math.round(size.w / 160))}
                    fill={i === 0 ? '#4ade80' : '#ff9900'}
                  />
                  {maxPoints > 1 && (
                    <text
                      x={x + Math.max(8, Math.round(size.w / 120))}
                      y={y}
                      fontSize={Math.max(16, Math.round(size.w / 45))}
                      fontFamily="system-ui, sans-serif"
                      fontWeight={600}
                      fill="#fff"
                      stroke="#000"
                      strokeWidth={Math.max(2, Math.round(size.w / 400))}
                      paintOrder="stroke"
                    >
                      {i + 1}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          )}
        </div>
      </PanelBody>

      {footer && <PanelBody>{footer}</PanelBody>}
    </Panel>
  )
}
