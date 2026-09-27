import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { alignCameras, crossCheck } from '@/api/endpoints/calibration'
import { ApiError, describeApiError } from '@/api/errors'
import type { Camera, CameraCalibration, CrossCheckResult, SharedPoint } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody } from '@/components/ui/Panel'
import { lineDiagnostics, reversedCameras, type Matrix3, type Point } from '@/geometry/homography'
import { AlignReport } from './AlignReport'
import { FrameCanvas } from './FrameCanvas'

type Method = 'spots' | 'lines'

/**
 * Step 2: alignment - the same real place, clicked in several cameras.
 *
 * The accumulated list is held here and sent WHOLE every time, because the
 * service re-solves from scratch - sending only the newest point would throw
 * away every earlier one. A camera that cannot be reached comes back
 * `aligned: false` with the call still returning 200, so the results are
 * read per camera rather than assumed from the status code.
 *
 * TWO WAYS TO FEED IT, usable together in one pass:
 *
 * - SPOTS: one identifiable point (a mat corner, a chair leg) clicked in
 *   each camera that sees it.
 * - LINES: a real straight edge (a wall base, a curb, a line on the floor)
 *   clicked as several points along it in each camera. Useful when an edge
 *   is plainly visible but no single point on it is crisp. When the line is
 *   finished, cameras that clicked the SAME number of points on it are paired
 *   point-by-point in click order, and each pair becomes an ordinary shared
 *   spot - the reference tool's line_finish, feeding the same request.
 *
 * Pairing by click order is exactly what goes wrong silently if one camera's
 * line was clicked from the other end. Between cameras that are already
 * aligned (so share a floor frame) the directions are compared and a reversed
 * one blocks finishing until it is flipped. Before alignment directions are
 * not comparable at all - each camera has its own private frame - so the
 * numbered points are the guard, and the screen says so. The reference's
 * live checks come along too: each camera's own points should fall on a
 * straight line once projected (tests that camera's calibration alone), and
 * aligned cameras should agree on the line's length (tests the alignment).
 *
 * CROSS-CHECK. The same spot-clicking, sent to a read-only endpoint instead:
 * where each ALIGNED camera puts the spot on the floor, and how far apart.
 * It is the check that an alignment actually took, so it wants spots that
 * were NOT used to align - checking a fit against its own points proves
 * nothing - and it is only offered once every camera marked is aligned (the
 * service refuses otherwise, and rightly).
 */
export function AlignMode({
  agencyId,
  cameras,
  byCamera,
  onAligned,
}: {
  agencyId: string
  cameras: Camera[]
  byCamera: Map<string, CameraCalibration>
  onAligned: () => void
}) {
  const calibrated = useMemo(
    () => cameras.filter((camera) => byCamera.has(camera.name)),
    [cameras, byCamera],
  )
  const hinvByCamera = useMemo(
    () =>
      Object.fromEntries(
        [...byCamera.values()].map((entry) => [entry.camera, entry.Hinv]),
      ) as Record<string, Matrix3>,
    [byCamera],
  )
  const alignedNames = useMemo(
    () => new Set([...byCamera.values()].filter((e) => e.diagnostics.aligned).map((e) => e.camera)),
    [byCamera],
  )

  const [method, setMethod] = useState<Method>('spots')
  const [pending, setPending] = useState<SharedPoint>({})
  const [recorded, setRecorded] = useState<SharedPoint[]>([])
  const [line, setLine] = useState<Record<string, Point[]>>({})
  const [lineNote, setLineNote] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: () => alignCameras(agencyId, recorded),
    onSuccess: () => onAligned(),
  })

  const check = useMutation({
    mutationFn: (spot: SharedPoint) => crossCheck(agencyId, spot),
  })

  const pendingCount = Object.keys(pending).length
  const pendingUnaligned = Object.keys(pending).filter((camera) => !alignedNames.has(camera))

  /**
   * How many recorded spots each pair of cameras has in common - the number
   * the solve turns on. Two is the threshold because one matched point fixes
   * position and nothing else: rotation and scale are still free. The
   * service refuses instead of guessing, so the screen says how many more
   * before the attempt rather than after.
   */
  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const point of recorded) {
      const names = Object.keys(point).sort()
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          const key = `${names[i]}|${names[j]}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
    }
    return counts
  }, [recorded])
  const readyPairs = [...pairCounts.values()].filter((n) => n >= 2).length

  const diagnostics = useMemo(() => lineDiagnostics(line, hinvByCamera), [line, hinvByCamera])
  const reversed = useMemo(
    () => reversedCameras(diagnostics, alignedNames),
    [diagnostics, alignedNames],
  )

  function finishLine() {
    const counts = Object.entries(line).filter(([, pts]) => pts.length >= 2)
    const sizes = new Set(counts.map(([, pts]) => pts.length))
    if (counts.length >= 2 && sizes.size === 1) {
      const n = counts[0][1].length
      const pairs: SharedPoint[] = Array.from({ length: n }, (_, i) =>
        Object.fromEntries(counts.map(([camera, pts]) => [camera, pts[i]])),
      )
      setRecorded((current) => [...current, ...pairs])
      setLineNote(`Line added as ${n} shared spots across ${counts.map(([c]) => c).join(', ')}.`)
    } else if (counts.length < 2) {
      setLineNote('Not added: a line needs at least 2 points in at least 2 cameras.')
    } else {
      setLineNote(
        `Not added: the cameras clicked different numbers of points (${counts
          .map(([c, pts]) => `${c} ${pts.length}`)
          .join(
            ', ',
          )}), so they cannot be paired point by point. Match the counts and finish again.`,
      )
      return
    }
    setLine({})
  }

  function reverseLine(camera: string) {
    setLine((current) => ({ ...current, [camera]: [...(current[camera] ?? [])].reverse() }))
  }

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

  const lineCounts = Object.values(line).filter((pts) => pts.length > 0).length

  return (
    <div>
      <Panel as="section" className="mb-3">
        <PanelBody>
          <div className="mb-3 flex gap-2" role="group" aria-label="How to mark shared places">
            <Button
              size="sm"
              variant={method === 'spots' ? 'primary' : 'secondary'}
              aria-pressed={method === 'spots'}
              onClick={() => setMethod('spots')}
            >
              Shared spots
            </Button>
            <Button
              size="sm"
              variant={method === 'lines' ? 'primary' : 'secondary'}
              aria-pressed={method === 'lines'}
              onClick={() => setMethod('lines')}
            >
              Shared lines
            </Button>
          </div>

          {method === 'spots' ? (
            <>
              <h2 className="text-ink text-sm font-semibold">Click one real spot in each camera</h2>
              <p className="text-ink-2 mt-2 text-sm leading-relaxed">
                Pick something you can identify in more than one view — a corner of a mat, a chair
                leg, a mark on the floor. Click it in each camera that can see it, then record it.
                Repeat with a few different spots. Two cameras need at least 2 spots in common to be
                tied together, and 4 or more lets the alignment repair a camera's own rectangle
                outright.
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
                  variant="ghost"
                  disabled={pendingCount < 2 || pendingUnaligned.length > 0 || check.isPending}
                  onClick={() => check.mutate(pending)}
                >
                  {check.isPending ? 'Checking…' : 'Cross-check this spot'}
                </Button>
                <p role="status" aria-live="polite" className="text-ink-3 text-xs">
                  {pendingCount === 0
                    ? 'Click the same spot in two or more cameras.'
                    : pendingCount === 1
                      ? 'This spot is marked in 1 camera — mark it in another to record or cross-check it.'
                      : `This spot is marked in ${pendingCount} cameras — ready to record or cross-check.`}
                  {pendingCount >= 2 &&
                    pendingUnaligned.length > 0 &&
                    ` Cross-check waits until ${pendingUnaligned.join(', ')} ${pendingUnaligned.length === 1 ? 'is' : 'are'} aligned.`}
                </p>
              </div>
              {check.error != null && (
                <p
                  role="alert"
                  className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm"
                >
                  {check.error instanceof ApiError
                    ? describeApiError(check.error)
                    : 'Could not cross-check this spot.'}
                </p>
              )}
              {check.data && <CrossCheckReport result={check.data} />}
            </>
          ) : (
            <>
              <h2 className="text-ink text-sm font-semibold">
                Click along one real straight edge in each camera
              </h2>
              <p className="text-ink-2 mt-2 text-sm leading-relaxed">
                Pick an edge more than one camera can see — a wall base, a curb, a painted line.
                Click points along it in each camera, starting from the SAME end every time and
                clicking the same number of points in each. They are paired in the order you click
                them, so point 1 in one camera must be the same place as point 1 in the others.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={lineCounts < 2 || reversed.length > 0}
                  onClick={finishLine}
                >
                  Finish this line
                </Button>
                <Button
                  size="sm"
                  disabled={lineCounts === 0}
                  onClick={() => {
                    setLine({})
                    setLineNote(null)
                  }}
                >
                  Clear this line
                </Button>
                <p role="status" aria-live="polite" className="text-ink-3 text-xs">
                  {lineNote ?? 'Click points along the same edge in two or more cameras.'}
                </p>
              </div>
              <LineChecks
                diagnostics={diagnostics}
                alignedNames={alignedNames}
                reversed={reversed}
                onReverse={reverseLine}
              />
            </>
          )}

          <div className="border-line mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="primary"
              /* Not "at least one spot": a single spot cannot tie any pair
                 together, so offering the solve there only produces a
                 refusal. */
              disabled={readyPairs === 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Aligning…' : 'Align the cameras'}
            </Button>
            <p className="text-ink-3 text-xs">
              {recorded.length === 0
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
                  const key = [a.name, b.name].sort().join('|')
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {calibrated.map((camera) =>
          method === 'spots' ? (
            <FrameCanvas
              key={`${camera.id}-spots`}
              camera={camera}
              points={pending[camera.name] ? [pending[camera.name]] : []}
              maxPoints={1}
              shape="none"
              onAddPoint={(point) =>
                setPending((current) => ({ ...current, [camera.name]: point }))
              }
              hint="Click the same real spot you clicked in the other cameras."
            />
          ) : (
            <FrameCanvas
              key={`${camera.id}-lines`}
              camera={camera}
              points={line[camera.name] ?? []}
              maxPoints={Number.POSITIVE_INFINITY}
              shape="polyline"
              onAddPoint={(point) => {
                setLineNote(null)
                setLine((current) => ({
                  ...current,
                  [camera.name]: [...(current[camera.name] ?? []), point],
                }))
              }}
              hint="Click points along the edge, from the same end as in the other cameras."
              footer={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={(line[camera.name] ?? []).length === 0}
                    onClick={() =>
                      setLine((current) => ({
                        ...current,
                        [camera.name]: (current[camera.name] ?? []).slice(0, -1),
                      }))
                    }
                  >
                    <Undo2 className="size-3.5" aria-hidden />
                    Undo last point
                  </Button>
                  <span className="text-ink-3 text-xs">
                    {(line[camera.name] ?? []).length} point
                    {(line[camera.name] ?? []).length === 1 ? '' : 's'} on this line
                  </span>
                </div>
              }
            />
          ),
        )}
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

/**
 * The reference's live line checks, in words and without its arbitrary floor
 * unit: straightness as a share of the line's own length, and agreement on
 * length only between cameras already sharing a floor frame.
 */
function LineChecks({
  diagnostics,
  alignedNames,
  reversed,
  onReverse,
}: {
  diagnostics: ReturnType<typeof lineDiagnostics>
  alignedNames: ReadonlySet<string>
  reversed: string[]
  onReverse: (camera: string) => void
}) {
  const rows = Object.entries(diagnostics.per_camera)
  if (rows.length === 0) return null

  const aligned = rows.filter(([camera]) => alignedNames.has(camera))
  const lengths = aligned.map(([, entry]) => entry.path_length)
  const spread =
    lengths.length >= 2
      ? (Math.max(...lengths) - Math.min(...lengths)) /
        (lengths.reduce((a, b) => a + b, 0) / lengths.length)
      : null

  return (
    <div className="mt-3 space-y-2 text-sm">
      <ul className="space-y-1">
        {rows.map(([camera, entry]) => {
          const bend =
            entry.collinearity_max_dev === null || entry.path_length === 0
              ? null
              : entry.collinearity_max_dev / entry.path_length
          return (
            <li key={camera} className="flex items-center gap-2">
              <span className="text-ink-2 min-w-0 flex-1 truncate">{camera}</span>
              {bend === null ? (
                <span className="text-ink-3 text-xs">3+ points to check straightness</span>
              ) : (
                <Badge tone={bend > 0.05 ? 'warn' : 'ok'}>
                  {bend > 0.05
                    ? `bends ${Math.round(bend * 100)}% off straight`
                    : 'straight on the floor'}
                </Badge>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-ink-3 text-xs leading-relaxed">
        A line that bends once projected onto the floor means that camera's own calibration is off —
        whatever the other cameras say.{' '}
        {spread === null
          ? 'Length agreement and direction are only checked between cameras that are already aligned; for the rest, the numbered points are the guide.'
          : `The aligned cameras disagree on this line's length by ${Math.round(spread * 100)}%.`}
      </p>
      {reversed.length > 0 && (
        <div className="border-warn/30 bg-warn/8 rounded-lg border p-3">
          <p role="alert" className="text-warn text-sm leading-relaxed">
            {reversed.join(', ')} clicked this line from the other end. Points are paired in click
            order, so as it stands every point would be matched with the wrong place.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reversed.map((camera) => (
              <Button key={camera} size="sm" onClick={() => onReverse(camera)}>
                Reverse {camera}'s points
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Where each camera put the one spot, and how far apart - the raw numbers,
 * not a pass mark. What counts as close enough depends on the room and the
 * cameras, so it is described, not judged.
 */
function CrossCheckReport({ result }: { result: CrossCheckResult }) {
  const worst = Math.max(0, ...result.pairs.map((pair) => pair.distance_cm))
  return (
    <div className="border-line bg-panel-2 mt-3 rounded-lg border p-3">
      <h3 className="text-ink text-sm font-semibold">Cross-check</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {result.pairs.map((pair) => (
          <li key={`${pair.cam_a}|${pair.cam_b}`} className="flex items-center gap-2">
            <span className="text-ink-2 min-w-0 flex-1 truncate">
              {pair.cam_a} ↔ {pair.cam_b}
            </span>
            <span className="text-ink tabular">{pair.distance_cm.toFixed(1)} cm apart</span>
          </li>
        ))}
      </ul>
      <p className="text-ink-3 mt-2 text-xs leading-relaxed">
        The same physical spot, placed by each camera on the shared floor. Up to {worst.toFixed(1)}{' '}
        cm between them. A few centimetres is agreement; tens of centimetres or more means the
        alignment has not taken for at least one of these cameras. Check with spots you did not use
        to align — a fit always agrees with its own points.
      </p>
    </div>
  )
}
