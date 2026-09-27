import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { calibrateRect } from '@/api/endpoints/calibration'
import { ApiError, describeApiError } from '@/api/errors'
import type { Camera, CameraCalibration } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import { completeParallelogram, type Point } from '../homography'
import { FrameCanvas } from './FrameCanvas'

/**
 * Step 1: calibrate one camera from a rectangle on its floor.
 *
 * THREE CLICKS AND A GUESS. After the 3rd corner the 4th is placed for you by
 * parallelogram completion (screens/homography.ts) and drawn as a light-blue
 * handle. It is a guess - exact only for a near-front-on view - so it is
 * there to be dragged onto the real corner, nudged with the arrow keys, or
 * replaced by clicking where the corner really is. This is the reference
 * tool's recovery path for a low-confidence fit and it had been left out: a
 * homography needs 4 real correspondences, and "3 points and it's a right
 * angle" is still 2 short, so lining up the 4th by eye is strictly better
 * than trusting the aspect inference. Clicking all 4 corners still works -
 * click the 4th where it really is and the guess moves there.
 *
 * Once a fit has been computed, dragging the handle recomputes it on release,
 * so the effect of the move is read straight away rather than after another
 * button press. Before the first compute a drag only moves the point.
 */
export function CalibrateMode({
  agencyId,
  cameras,
  byCamera,
  onSaved,
}: {
  agencyId: string
  cameras: Camera[]
  byCamera: Map<string, CameraCalibration>
  onSaved: () => void
}) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const camera = cameras.find((c) => c.id === pickedId) ?? cameras[0] ?? null

  const [points, setPoints] = useState<Point[]>([])
  const [guessed, setGuessed] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  const save = useMutation({
    mutationFn: (corners: Point[]) =>
      calibrateRect(agencyId, {
        camera: (camera as Camera).name,
        points: corners,
        img_w: size?.w as number,
        img_h: size?.h as number,
      }),
    onSuccess: () => onSaved(),
  })

  function pickCamera(id: string | null) {
    setPickedId(id)
    setPoints([])
    setGuessed(false)
    save.reset()
  }

  function addPoint(point: Point) {
    const next = [...points, point]
    if (next.length === 3) {
      next.push(completeParallelogram(next[0], next[1], next[2]))
      setGuessed(true)
    }
    setPoints(next)
  }

  function moveCorner(point: Point) {
    setPoints((current) => [...current.slice(0, 3), point])
    setGuessed(false)
  }

  function dropCorner(point: Point) {
    moveCorner(point)
    /* Recompute on release once there is a fit to recompute. */
    if (save.data && !save.isPending) save.mutate([...points.slice(0, 3), point])
  }

  const current = camera ? byCamera.get(camera.name) : undefined

  const status =
    points.length === 0
      ? 'No corners yet — click 3 and the 4th is placed for you.'
      : points.length < 3
        ? `${points.length} of 3 corners.`
        : guessed
          ? 'The 4th corner (blue) is a guess — drag it onto the real corner, or click where it really is.'
          : 'All 4 corners placed.'

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
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
            onChange={(e) => pickCamera(e.target.value || null)}
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
            key={camera.id}
            camera={camera}
            points={points}
            maxPoints={4}
            onAddPoint={addPoint}
            handleIndex={points.length === 4 ? 3 : null}
            onMoveHandle={moveCorner}
            onDropHandle={dropCorner}
            onSize={setSize}
            hint="Click 3 corners of something you are sure is a right angle in real life — a floor tile, a rug, a doormat — going round it in order. Any rectangle works; you do not need a square and you do not measure anything."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={points.length === 0}
                  onClick={() => {
                    setPoints((current) => current.slice(0, -1))
                    setGuessed(false)
                  }}
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  Undo last point
                </Button>
                <Button
                  size="sm"
                  disabled={points.length === 0}
                  onClick={() => {
                    setPoints([])
                    setGuessed(false)
                    save.reset()
                  }}
                >
                  Start over
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={points.length !== 4 || size === null || save.isPending}
                  onClick={() => save.mutate(points)}
                >
                  {save.isPending ? 'Computing…' : save.data ? 'Compute again' : 'Compute and save'}
                </Button>
                <p role="status" aria-live="polite" className="text-ink-3 text-xs">
                  {status}
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
                const entry = byCamera.get(row.name)
                const aligned = entry?.diagnostics.aligned === true
                return (
                  <li
                    key={row.id}
                    className="border-line bg-panel-2 flex items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="text-ink min-w-0 flex-1 truncate text-sm">{row.name}</span>
                    {entry ? (
                      <Badge tone={aligned ? 'ok' : 'warn'}>
                        {aligned ? 'aligned' : 'not aligned'}
                      </Badge>
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
              so a square was assumed. Drag the 4th corner (blue) onto the real corner — the fit is
              recomputed when you let go — or align this camera against four or more shared points,
              which replaces this fit outright.
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
          <Row label="Aligned" value={d.aligned ? 'yes' : 'not yet'} />
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
