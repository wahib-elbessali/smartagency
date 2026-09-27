import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Camera, CameraCalibration } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import {
  applyH,
  canvasTransform,
  coverageCheck,
  footprint,
  multiply,
  niceStep,
  toMatrix3d,
  type Bounds,
  type Footprint,
  type Matrix3,
  type Point,
} from '@/geometry/homography'
import { useCameraFrame } from '@/hooks/useCameraFrame'

/** The logical canvas, in CSS pixels before zoom - the reference's 700. */
const CANVAS = 700

/**
 * Step 4: the bird's-eye check - every camera's picture laid onto one
 * top-down floor, to SEE whether they agree.
 *
 * WHY. Calibration and alignment exist so every camera agrees on one floor.
 * The numbers can say an alignment "took"; this is how to confirm it by eye.
 * Each calibrated camera's current frame is warped onto the shared floor and
 * the layers are stacked at partial opacity: where they agree, a rug edge or
 * a tile seam lands in one place and looks sharp; where they do not, it
 * visibly doubles. The single-camera view on the same scale finds which one
 * is off; the grid shows whether a camera's OWN floor is straight.
 *
 * HOW, IN THE BROWSER. The reference tool warps server-side into a PNG. The
 * backend has no such route, and every piece needed is already here - each
 * camera's `Hinv` and its frame - so the warp is done with CSS instead: a
 * floor homography is a planar projective map, which is exactly what a CSS
 * matrix3d() can express. Per camera, M = S * Hinv takes its pixels straight
 * to canvas pixels, where S is ONE uniform scale-and-shift for the whole
 * canvas (uniform, so real skew and misalignment are not confused with a
 * stretched axis). Each layer is clipped to the part of its frame below the
 * horizon first - past it a floor homography goes to infinity. Chosen over a
 * server-rendered picture, and used consistently: nothing here is baked.
 *
 * WHERE THE CANVAS IS. The reference sizes the canvas around the points you
 * clicked; the gateway never returns those, so here it is anchored on the
 * floor right in front of each camera (the lower third of its frame), and
 * widened to each camera's full footprint only within three times that
 * span - a camera that sees past the horizon would otherwise zoom the room
 * down to a dot.
 *
 * PAN AND ZOOM are a CSS transform on the finished canvas, never a re-warp:
 * the wheel zooms around the cursor, dragging pans, Reset fits it again. They
 * survive a new frame, so you can stay on one tile seam while frames refresh.
 * Frames can be held still together (and refreshed) - but not scrubbed to an
 * earlier moment: the gateway's frame route has no frame index to ask for.
 *
 * THE COVERAGE CHECK IS WEAK, AND SAYS SO. Each camera's floor footprint
 * area against the median catches only gross scale blow-ups; a clean result
 * is not a green light, in the reference's own words.
 */
export function BirdsEyeMode({
  cameras,
  byCamera,
}: {
  cameras: Camera[]
  byCamera: Map<string, CameraCalibration>
}) {
  /* A camera needs a calibration AND the frame size it was calibrated at. */
  const usable = useMemo(
    () =>
      cameras.filter((camera) => {
        const entry = byCamera.get(camera.name)
        return entry?.Hinv && entry.diagnostics.calib_res
      }),
    [cameras, byCamera],
  )

  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [solo, setSolo] = useState<string>('')
  const [grid, setGrid] = useState(true)
  const [hold, setHold] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const included = usable.filter((camera) => !excluded.has(camera.name))
  const shown = solo ? included.filter((camera) => camera.name === solo) : included

  const footprints = useMemo(() => {
    const out: Record<string, Footprint> = {}
    for (const camera of usable) {
      const entry = byCamera.get(camera.name) as CameraCalibration
      const [w, h] = entry.diagnostics.calib_res as [number, number]
      out[camera.name] = footprint(entry.Hinv as Matrix3, w, h)
    }
    return out
  }, [usable, byCamera])

  /* The canvas is framed on the INCLUDED cameras - the same S whether one is
     soloed or all are blended, so switching views does not move the floor. */
  const bounds = useMemo(
    () => floorBounds(included, byCamera, footprints),
    [included, byCamera, footprints],
  )
  const S = useMemo(() => (bounds ? canvasTransform(bounds, CANVAS) : null), [bounds])

  const coverage = useMemo(
    () =>
      coverageCheck(
        Object.fromEntries(included.map((camera) => [camera.name, footprints[camera.name]])),
      ),
    [included, footprints],
  )

  if (usable.length === 0) {
    return (
      <Panel as="section">
        <PanelBody>
          <h2 className="text-ink text-sm font-semibold">Calibrate a camera first</h2>
          <p className="text-ink-2 mt-1 text-sm leading-relaxed">
            The bird's-eye view lays each calibrated camera onto the floor. Nothing is calibrated in
            this branch yet.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <Panel as="section">
        <PanelHeader>
          <h2 className="text-ink text-sm font-semibold">The floor, from above</h2>
          <p className="text-ink-3 mt-1 text-xs leading-relaxed">
            {solo
              ? `${solo} alone, on the same scale as the blend.`
              : 'Every included camera, stacked. Sharp where they agree, doubled where they do not.'}{' '}
            Scroll to zoom, drag to pan.
          </p>
        </PanelHeader>
        <PanelBody className="p-0">
          {S ? (
            <PanZoom>
              {shown.map((camera) => (
                <BevLayer
                  key={`${camera.id}-${refreshKey}`}
                  camera={camera}
                  entry={byCamera.get(camera.name) as CameraCalibration}
                  S={S}
                  footprint={footprints[camera.name]}
                  opacity={1 / Math.max(shown.length, 1)}
                  hold={hold}
                />
              ))}
              {grid && bounds && <Grid S={S} bounds={bounds} />}
            </PanZoom>
          ) : (
            <p className="text-ink-2 p-5 text-sm">
              None of the included cameras has any floor below its horizon to draw.
            </p>
          )}
        </PanelBody>
      </Panel>

      <div className="space-y-3">
        <Panel as="section">
          <PanelBody className="space-y-4">
            <fieldset>
              <legend className="text-ink-3 tracked mb-2 text-[11px] font-medium">Cameras</legend>
              <div className="space-y-1.5">
                {usable.map((camera) => (
                  <label key={camera.id} className="text-ink-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!excluded.has(camera.name)}
                      onChange={(e) =>
                        setExcluded((current) => {
                          const next = new Set(current)
                          if (e.target.checked) next.delete(camera.name)
                          else next.add(camera.name)
                          return next
                        })
                      }
                    />
                    {camera.name}
                    {byCamera.get(camera.name)?.diagnostics.aligned ? null : (
                      <Badge tone="warn">not aligned</Badge>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="bev_view"
                className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
              >
                View
              </label>
              <select
                id="bev_view"
                className={controlClass()}
                value={solo}
                onChange={(e) => setSolo(e.target.value)}
              >
                <option value="">All included, blended</option>
                {included.map((camera) => (
                  <option key={camera.id} value={camera.name}>
                    {camera.name} alone
                  </option>
                ))}
              </select>
            </div>

            <label className="text-ink-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
              Floor grid
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-ink-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />
                Hold the pictures still
              </label>
              {hold && (
                <Button size="sm" variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  New pictures
                </Button>
              )}
            </div>
            <p className="text-ink-3 text-xs leading-relaxed">
              Straight grid lines should stay straight under each camera alone — if they bend, that
              camera's own calibration is off, whatever the others say.
            </p>
          </PanelBody>
        </Panel>

        <CoveragePanel coverage={coverage} />
      </div>
    </div>
  )
}

/**
 * Where the canvas should look: floor right in front of each camera (the
 * lower third of the frame, below the horizon), widened to each footprint's
 * corners only while they stay within three times that span.
 */
function floorBounds(
  cameras: Camera[],
  byCamera: Map<string, CameraCalibration>,
  footprints: Record<string, Footprint>,
): Bounds | null {
  const anchors: Point[] = []
  for (const camera of cameras) {
    const entry = byCamera.get(camera.name) as CameraCalibration
    const [w, h] = entry.diagnostics.calib_res as [number, number]
    const Hinv = entry.Hinv as Matrix3
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.7, 0.85, 1]) {
        const p: Point = [w * fx, h * fy]
        const denominator = Hinv[2][0] * p[0] + Hinv[2][1] * p[1] + Hinv[2][2]
        const centre = Hinv[2][0] * (w / 2) + Hinv[2][1] * (h / 2) + Hinv[2][2]
        /* Same side of the horizon as the frame's centre: in front of the camera. */
        if (Math.sign(denominator) === Math.sign(centre || 1) && Math.abs(denominator) > 1e-9) {
          const world = applyH(Hinv, p)
          if (Number.isFinite(world[0]) && Number.isFinite(world[1])) anchors.push(world)
        }
      }
    }
  }
  if (anchors.length === 0) return null
  const ax = anchors.map((p) => p[0])
  const ay = anchors.map((p) => p[1])
  const reach =
    3 * Math.max(Math.max(...ax) - Math.min(...ax), Math.max(...ay) - Math.min(...ay), 1e-6)
  const cx = (Math.max(...ax) + Math.min(...ax)) / 2
  const cy = (Math.max(...ay) + Math.min(...ay)) / 2
  const all = [...anchors]
  for (const camera of cameras) {
    for (const p of footprints[camera.name]?.world ?? []) {
      if (Math.abs(p[0] - cx) <= reach && Math.abs(p[1] - cy) <= reach) all.push(p)
    }
  }
  return {
    xmin: Math.min(...all.map((p) => p[0])),
    xmax: Math.max(...all.map((p) => p[0])),
    ymin: Math.min(...all.map((p) => p[1])),
    ymax: Math.max(...all.map((p) => p[1])),
  }
}

/** One camera's picture, warped onto the canvas by M = S * Hinv. */
function BevLayer({
  camera,
  entry,
  S,
  footprint: fp,
  opacity,
  hold,
}: {
  camera: Camera
  entry: CameraCalibration
  S: Matrix3
  footprint: Footprint
  opacity: number
  hold: boolean
}) {
  const frame = useCameraFrame(camera, { hold })
  const [w, h] = entry.diagnostics.calib_res as [number, number]
  if (!frame.src || fp.pixels.length < 3) return null
  const M = multiply(S, entry.Hinv as Matrix3)
  return (
    <img
      src={frame.src}
      alt={`${camera.name} laid onto the floor`}
      className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
      style={{
        /* The calibration's own frame size, whatever size the picture
           arrives at - Hinv is expressed in these pixels. */
        width: w,
        height: h,
        transformOrigin: '0 0',
        transform: toMatrix3d(M),
        /* Below the horizon only: past it the warp goes to infinity. */
        clipPath: `polygon(${fp.pixels.map(([x, y]) => `${x}px ${y}px`).join(', ')})`,
        opacity,
      }}
    />
  )
}

/** Evenly spaced floor lines, drawn through S (a similarity - no divide needed). */
function Grid({ S, bounds }: { S: Matrix3; bounds: Bounds }) {
  const step = niceStep(Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin))
  const lines: Array<{ a: Point; b: Point; label: string; vertical: boolean }> = []
  for (let x = Math.floor(bounds.xmin / step) * step; x <= bounds.xmax + step; x += step) {
    lines.push({
      a: applyH(S, [x, bounds.ymin]),
      b: applyH(S, [x, bounds.ymax]),
      label: x.toFixed(0),
      vertical: true,
    })
  }
  for (let y = Math.floor(bounds.ymin / step) * step; y <= bounds.ymax + step; y += step) {
    lines.push({
      a: applyH(S, [bounds.xmin, y]),
      b: applyH(S, [bounds.xmax, y]),
      label: y.toFixed(0),
      vertical: false,
    })
  }
  return (
    <svg
      width={CANVAS}
      height={CANVAS}
      className="pointer-events-none absolute top-0 left-0"
      aria-hidden
    >
      {lines.map((line) => (
        <g key={`${line.vertical ? 'x' : 'y'}${line.label}`}>
          <line
            x1={line.a[0]}
            y1={line.a[1]}
            x2={line.b[0]}
            y2={line.b[1]}
            stroke="rgb(70, 160, 70)"
            strokeWidth={1}
          />
          <text
            x={line.vertical ? line.a[0] + 2 : 2}
            y={line.vertical ? 12 : line.a[1] + 10}
            fontSize={9}
            fill="rgb(70, 160, 70)"
            fontFamily="system-ui, sans-serif"
          >
            {line.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/**
 * The canvas at a fixed 700 x 700 logical size, scaled to fit its container,
 * then zoomed and panned by the person. All of it is one CSS transform on the
 * already-drawn canvas, so a new frame arriving does not reset where you are.
 */
function PanZoom({ children }: { children: React.ReactNode }) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState(1)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => setFit((el.clientWidth || CANVAS) / CANVAS)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])

  /* Wheel with passive: false, or the page scrolls instead of the canvas zooming. */
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const rect = (el as HTMLDivElement).getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      setView((current) => {
        const k = Math.min(20, Math.max(0.5, current.k * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
        const ratio = k / current.k
        /* Keep the floor point under the cursor where it is. */
        return { x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio, k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function down(event: PointerEvent<HTMLDivElement>) {
    drag.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x
    const dy = event.clientY - drag.current.y
    drag.current = { x: event.clientX, y: event.clientY }
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
  }
  function up() {
    drag.current = null
  }

  return (
    <div className="relative">
      <div
        ref={viewport}
        className="bg-ink/90 relative aspect-square w-full cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label="Bird's-eye view of the floor"
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width: CANVAS,
            height: CANVAS,
            transformOrigin: '0 0',
            transform: `translate(${view.x}px, ${view.y}px) scale(${fit * view.k})`,
          }}
        >
          {children}
        </div>
      </div>
      <Button
        size="sm"
        className="absolute top-2 right-2"
        disabled={view.x === 0 && view.y === 0 && view.k === 1}
        onClick={() => setView({ x: 0, y: 0, k: 1 })}
      >
        Reset view
      </Button>
    </div>
  )
}

function CoveragePanel({ coverage }: { coverage: ReturnType<typeof coverageCheck> }) {
  const names = Object.keys(coverage.areas).sort()
  return (
    <Panel as="section" tone={coverage.flagged.length > 0 ? 'alert' : 'neutral'}>
      <PanelHeader>
        <h2 className="text-ink text-sm font-semibold">Floor each camera covers</h2>
        <p className="text-ink-3 mt-1 text-xs leading-relaxed">
          A weak check: it only catches a camera whose floor is wildly the wrong size. A clean
          result here does not mean the calibration is right — use the picture for that.
        </p>
      </PanelHeader>
      <PanelBody>
        {coverage.median === null ? (
          <p className="text-ink-2 text-sm leading-relaxed">
            Not enough cameras with a bounded floor to compare.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {names.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <span className="text-ink-2 min-w-0 flex-1 truncate">{name}</span>
                <span className="text-ink tabular">
                  {(coverage.areas[name] / (coverage.median as number)).toFixed(1)}× median
                </span>
                {coverage.flagged.includes(name) && <Badge tone="warn">far off</Badge>}
              </li>
            ))}
          </ul>
        )}
        {coverage.flagged.length > 0 && (
          <p className="text-warn mt-3 text-sm leading-relaxed">
            {coverage.flagged.join(', ')} cover{coverage.flagged.length === 1 ? 's' : ''} a floor
            area wildly different from the others. Redo alignment with shared spots or lines spread
            across the whole room, not clustered together, then look again.
          </p>
        )}
        {coverage.flagged.length === 0 && coverage.median !== null && (
          <p className="text-ink-3 mt-3 text-xs leading-relaxed">
            No gross outlier — which is all this check can say.
          </p>
        )}
        {coverage.unbounded.length > 0 && (
          <p className="text-ink-3 mt-2 text-xs leading-relaxed">
            {coverage.unbounded.join(', ')} see
            {coverage.unbounded.length === 1 ? 's' : ''} past the horizon, so
            {coverage.unbounded.length === 1 ? ' its' : ' their'} floor has no finite size and
            {coverage.unbounded.length === 1 ? ' is' : ' are'} left out of the comparison.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}
