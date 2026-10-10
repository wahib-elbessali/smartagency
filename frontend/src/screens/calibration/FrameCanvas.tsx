import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ImageOff, Ruler } from 'lucide-react'
import { ApiError, describeApiError } from '@/api/errors'
import type { Camera } from '@/api/types'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { useCameraFrame } from '@/hooks/useCameraFrame'
import type { Point } from '../homography'

export interface Marker {
  point: Point
  label: string
  /** CSS colour for the dot. */
  color: string
}

/**
 * A camera's picture with clickable points on it - the one canvas every
 * calibration tool clicks on: the rectangle, shared spots, shared lines,
 * cross-check spots and gates.
 *
 * The same detector-scaled frame the live view shows - the gateway offers
 * no other. That is sound as long as `img_w`/`img_h` are THIS frame's size,
 * which they are (read from the loaded image): the service assumes the image
 * centre is the principal point, which scaling does not move, and records
 * the size as `calib_res` so the fit can be rescaled later.
 *
 * LIVE UNTIL YOU CLICK, FROZEN AFTER. Points are stored in frame pixels, so a
 * picture that kept moving would leave them pinned to a room that has walked
 * away. Holding still BEFORE the first click buys nothing and costs seeing
 * the camera move, so it plays until a point lands (or `hold` is set) and
 * clearing the points starts it again.
 *
 * THE HANDLE. One point may be marked draggable (`handleIndex`) - the
 * auto-placed 4th corner. It is dragged with the pointer, nudged with the
 * arrow keys once focused (Shift for 10 px), and a click anywhere on the
 * picture once every point is placed moves it there. Screen-to-image
 * conversion is the same `toImage` for all three, so there is one version of
 * that maths, not two.
 */
export function FrameCanvas({
  camera,
  points,
  maxPoints,
  onAddPoint,
  handleIndex,
  onMoveHandle,
  onDropHandle,
  shape = 'polygon',
  markers = [],
  hold = false,
  onSize,
  hint,
  footer,
}: {
  camera: Camera
  points: Point[]
  maxPoints: number
  onAddPoint: (point: Point) => void
  handleIndex?: number | null
  /** While the handle moves - for drawing it where the pointer is. */
  onMoveHandle?: (point: Point) => void
  /** When the handle comes to rest - pointer released, key released, or a click. */
  onDropHandle?: (point: Point) => void
  shape?: 'polygon' | 'polyline' | 'none'
  /** Extra dots that are not this tool's own points - saved gates, say. */
  markers?: Marker[]
  hold?: boolean
  onSize?: (size: { w: number; h: number } | null) => void
  hint: string
  footer?: ReactNode
}) {
  const frozen = hold || points.length > 0
  const frame = useCameraFrame(camera, { hold: frozen })
  const { src, size } = frame
  /* The parent sends this size as img_w/img_h, so it has to follow the
     picture exactly - including back to null on a camera switch, or the
     next camera would be calibrated against the previous one's frame size. */
  useEffect(() => {
    onSize?.(size)
  }, [size, onSize])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragging = useRef(false)
  const lastDrag = useRef<Point | null>(null)
  /* A pointer released over the picture also fires a click; that click is
     the end of a drag, not a new point. */
  const swallowClick = useRef(false)

  const noFrame = frame.isError
  const unavailable = !(frame.error instanceof ApiError)
    ? 'Could not fetch a picture from this camera.'
    : frame.error.status === 404
      ? `The detector cannot open ${camera.name}’s stream, so there is nothing to measure.`
      : frame.error.status === 422
        ? `${camera.name} has no stream address, so there is nothing to measure.`
        : describeApiError(frame.error)

  const hasHandle = handleIndex != null && handleIndex < points.length

  function toImage(clientX: number, clientY: number): Point | null {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return [Math.round(p.x), Math.round(p.y)]
  }

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    const point = toImage(event.clientX, event.clientY)
    if (!point) return
    if (points.length < maxPoints) {
      onAddPoint(point)
      return
    }
    /* Every point placed: a click is "the true corner is here". */
    if (hasHandle) {
      onMoveHandle?.(point)
      onDropHandle?.(point)
    }
  }

  function startDrag(event: PointerEvent<SVGCircleElement>) {
    event.stopPropagation()
    svgRef.current?.setPointerCapture?.(event.pointerId)
    dragging.current = true
    lastDrag.current = null
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!dragging.current) return
    const point = toImage(event.clientX, event.clientY)
    if (!point) return
    lastDrag.current = point
    onMoveHandle?.(point)
  }

  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (!dragging.current) return
    dragging.current = false
    svgRef.current?.releasePointerCapture?.(event.pointerId)
    swallowClick.current = true
    if (lastDrag.current) onDropHandle?.(lastDrag.current)
  }

  function nudge(event: KeyboardEvent<SVGCircleElement>) {
    if (!hasHandle) return
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, Point> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const d = delta[event.key]
    if (!d) return
    event.preventDefault()
    const [x, y] = points[handleIndex as number]
    onMoveHandle?.([x + d[0], y + d[1]])
  }

  function settle(event: KeyboardEvent<SVGCircleElement>) {
    if (!hasHandle || !event.key.startsWith('Arrow')) return
    onDropHandle?.(points[handleIndex as number])
  }

  const stroke = size ? Math.max(2, Math.round(size.w / 480)) : 2
  const radius = size ? Math.max(5, Math.round(size.w / 160)) : 5
  const outline = points.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <Panel as="section">
      <PanelHeader>
        <div className="flex items-center gap-2">
          <Ruler className="text-ink-3 size-4 shrink-0" aria-hidden />
          <h2 className="text-ink truncate font-mono text-sm font-medium">{camera.name}</h2>
        </div>
        <p className="text-ink-3 mt-1 text-xs leading-relaxed">{hint}</p>
        <p className="text-ink-3 mt-1 text-xs">
          {frozen ? (
            <span className="text-ink-2">
              Held still while you measure — clear the points to let it play again.
            </span>
          ) : (
            'Playing. It freezes as soon as you place a point.'
          )}
        </p>
      </PanelHeader>

      <PanelBody flush>
        <div className="bg-ink/90 relative aspect-video w-full overflow-hidden">
          {src && !noFrame ? (
            <img
              src={src}
              alt={`Current frame from ${camera.name}`}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={frame.onLoad}
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
              className={`absolute inset-0 h-full w-full touch-none ${
                points.length >= maxPoints && !hasHandle ? 'cursor-default' : 'cursor-crosshair'
              }`}
              onClick={handleClick}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="presentation"
            >
              {points.length > 1 && shape === 'polygon' && (
                <polygon
                  points={outline}
                  fill="rgba(255, 153, 0, 0.12)"
                  stroke="#ff9900"
                  strokeWidth={stroke}
                />
              )}
              {points.length > 1 && shape === 'polyline' && (
                <polyline points={outline} fill="none" stroke="#ff9900" strokeWidth={stroke} />
              )}

              {markers.map((marker) => (
                <g key={`${marker.label}-${marker.point[0]}-${marker.point[1]}`}>
                  <circle
                    cx={marker.point[0]}
                    cy={marker.point[1]}
                    r={radius}
                    fill={marker.color}
                  />
                  <PointLabel at={marker.point} width={size.w} text={marker.label} />
                </g>
              ))}

              {points.map(([x, y], i) => {
                const isHandle = hasHandle && i === handleIndex
                return (
                  <g key={`point-${i}`}>
                    {isHandle ? (
                      <circle
                        cx={x}
                        cy={y}
                        r={radius * 1.6}
                        fill="#5bc8ff"
                        stroke="#fff"
                        strokeWidth={stroke}
                        className="cursor-grab focus:outline-none"
                        tabIndex={0}
                        role="button"
                        aria-label={`Corner ${i + 1}, at ${x}, ${y}. Drag it, or use the arrow keys, to line it up with the real corner.`}
                        onPointerDown={startDrag}
                        onKeyDown={nudge}
                        onKeyUp={settle}
                      />
                    ) : (
                      <circle cx={x} cy={y} r={radius} fill={i === 0 ? '#4ade80' : '#ff9900'} />
                    )}
                    {maxPoints > 1 && (
                      <PointLabel at={[x, y]} width={size.w} text={String(i + 1)} />
                    )}
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </PanelBody>

      {footer && <PanelBody>{footer}</PanelBody>}
    </Panel>
  )
}

function PointLabel({ at: [x, y], width, text }: { at: Point; width: number; text: string }) {
  return (
    <text
      x={x + Math.max(8, Math.round(width / 120))}
      y={y}
      fontSize={Math.max(16, Math.round(width / 45))}
      fontFamily="system-ui, sans-serif"
      fontWeight={600}
      fill="#fff"
      stroke="#000"
      strokeWidth={Math.max(2, Math.round(width / 400))}
      paintOrder="stroke"
      pointerEvents="none"
    >
      {text}
    </text>
  )
}
