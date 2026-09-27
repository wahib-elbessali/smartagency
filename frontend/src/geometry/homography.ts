/**
 * The small amount of planar-homography maths the calibration screens do in
 * the browser, kept in one place and tested on its own.
 *
 * Everything here mirrors ai/reference_ui/calibration/calibration_app.py, the
 * reference the calibration screens are rebuilt from, so a number the
 * dashboard shows is the number that tool would have shown. None of it is
 * sent anywhere: the AI service does its own solving, and these are the
 * checks and projections a person reads while clicking.
 *
 * A homography is a 3x3 row-major matrix. `Hinv` from GET .../ai/calibration
 * maps a camera's image pixels to floor coordinates; its inverse maps back.
 */

export type Point = [number, number]
export type Matrix3 = number[][]

/** Applies H to a point, with the projective divide. */
export function applyH(H: Matrix3, [x, y]: Point): Point {
  const w = H[2][0] * x + H[2][1] * y + H[2][2]
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]
}

export function multiply(A: Matrix3, B: Matrix3): Matrix3 {
  return A.map((row) =>
    [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]),
  )
}

/** 3x3 inverse by cofactors; null for a singular matrix. */
export function invert(M: Matrix3): Matrix3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = M
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ]
}

/**
 * The 4th corner of a rectangle from the first three, by parallelogram
 * completion: corner4 = corner1 + corner3 - corner2 (the diagonals of a
 * parallelogram share a midpoint). Exact only for a near-front-on view -
 * a real rectangle does not project to an exact parallelogram under general
 * perspective - which is why the screen offers it as a draggable guess
 * rather than trusting it. Same formula as the reference's inferRectCorner3.
 */
export function completeParallelogram(p1: Point, p2: Point, p3: Point): Point {
  return [p1[0] + p3[0] - p2[0], p1[1] + p3[1] - p2[1]]
}

export interface LineCameraDiagnostics {
  n_points: number
  /** Length of the clicked path along the floor, in floor units. */
  path_length: number
  /**
   * With 3+ points: how far the furthest intermediate point sits off the
   * straight first-to-last line, in floor units. Large means THIS camera's
   * own calibration bends straight lines - independent of any other camera.
   */
  collinearity_max_dev: number | null
  /** Unit vector first -> last point on the floor. */
  direction: Point
}

export interface LineDiagnostics {
  per_camera: Record<string, LineCameraDiagnostics>
  /** With 2+ cameras: how much they disagree on the same line's length. */
  agreement: { mean: number; spread: number; spread_frac: number | null } | null
}

/**
 * The reference's _line_diagnostics: per-camera collinearity and path length
 * of one clicked straight line, and whether cameras agree on its length.
 * Cameras without a calibration, or with fewer than 2 points, are skipped.
 */
export function lineDiagnostics(
  line: Record<string, Point[]>,
  hinvByCamera: Record<string, Matrix3>,
): LineDiagnostics {
  const per_camera: Record<string, LineCameraDiagnostics> = {}
  for (const [camera, pixels] of Object.entries(line)) {
    const Hinv = hinvByCamera[camera]
    if (!Hinv || pixels.length < 2) continue
    const world = pixels.map((p) => applyH(Hinv, p))

    let path = 0
    for (let k = 1; k < world.length; k += 1) {
      path += Math.hypot(world[k][0] - world[k - 1][0], world[k][1] - world[k - 1][1])
    }

    const first = world[0]
    const last = world[world.length - 1]
    const span = Math.hypot(last[0] - first[0], last[1] - first[1]) || 1e-9
    const direction: Point = [(last[0] - first[0]) / span, (last[1] - first[1]) / span]

    let deviation: number | null = null
    if (world.length >= 3) {
      deviation = 0
      for (const p of world) {
        const rx = p[0] - first[0]
        const ry = p[1] - first[1]
        const along = rx * direction[0] + ry * direction[1]
        const off = Math.hypot(rx - along * direction[0], ry - along * direction[1])
        deviation = Math.max(deviation, off)
      }
    }

    per_camera[camera] = {
      n_points: pixels.length,
      path_length: path,
      collinearity_max_dev: deviation,
      direction,
    }
  }

  const lengths = Object.values(per_camera).map((entry) => entry.path_length)
  let agreement: LineDiagnostics['agreement'] = null
  if (lengths.length >= 2) {
    const mean = lengths.reduce((sum, n) => sum + n, 0) / lengths.length
    const spread = Math.max(...lengths) - Math.min(...lengths)
    agreement = { mean, spread, spread_frac: mean > 1e-9 ? spread / mean : null }
  }
  return { per_camera, agreement }
}

/**
 * Cameras whose line runs the opposite way to the first camera's, on the
 * shared floor. Only meaningful between cameras that are already ALIGNED -
 * before alignment each camera has its own private floor frame and their
 * directions cannot be compared at all.
 *
 * This is the failure the line method invites: points are paired by the
 * order they were clicked, so one camera clicked right-to-left pairs every
 * point with the wrong end of the line in the other, silently.
 */
export function reversedCameras(
  diagnostics: LineDiagnostics,
  comparable: ReadonlySet<string>,
): string[] {
  const entries = Object.entries(diagnostics.per_camera).filter(([camera]) =>
    comparable.has(camera),
  )
  if (entries.length < 2) return []
  const [, reference] = entries[0]
  return entries
    .slice(1)
    .filter(
      ([, entry]) =>
        entry.direction[0] * reference.direction[0] + entry.direction[1] * reference.direction[1] <
        0,
    )
    .map(([camera]) => camera)
}

/**
 * The homography taking four source points to four destination points
 * (direct linear transform, h33 fixed at 1). Null when the points are
 * degenerate - three of them collinear.
 */
export function solveHomography(src: Point[], dst: Point[]): Matrix3 | null {
  if (src.length !== 4 || dst.length !== 4) return null
  const A: number[][] = []
  for (let k = 0; k < 4; k += 1) {
    const [x, y] = src[k]
    const [u, v] = dst[k]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  /* Gaussian elimination with partial pivoting on the 8x9 augmented system. */
  for (let col = 0; col < 8; col += 1) {
    let pivot = col
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row
    }
    if (Math.abs(A[pivot][col]) < 1e-10) return null
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue
      const factor = A[row][col] / A[col][col]
      for (let k = col; k < 9; k += 1) A[row][k] -= factor * A[col][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ]
}

/* ------------------------------------------------------------ bird's-eye */

export interface Footprint {
  /** The part of the frame below the horizon, in the frame's pixels. */
  pixels: Point[]
  /** The same polygon on the floor. */
  world: Point[]
  /** Its floor area, in floor units squared. */
  area: number
  /** Share of the frame at or above the horizon (0 = all floor, 1 = none). */
  horizonFrac: number
}

function shoelace(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

/**
 * A camera's floor footprint - the reference's _camera_world_footprint. Only
 * the part of the frame BELOW the horizon is projected: a floor homography
 * sends the horizon line to infinity, so a pixel above it is behind the
 * camera or arbitrarily far away, and its "area" would be a confident,
 * made-up number. The frame is clipped (Sutherland-Hodgman) against the
 * half-plane where Hinv's denominator is positive before projecting.
 */
export function footprint(Hinv: Matrix3, w: number, h: number): Footprint {
  let [a, b, c] = Hinv[2]
  const sign = Math.sign(a * (w / 2) + b * (h / 2) + c) || 1
  a *= sign
  b *= sign
  c *= sign
  const eps = 1e-9 * Math.max(1, Math.abs(c))
  const frame: Point[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]
  const clipped: Point[] = []
  for (let i = 0; i < frame.length; i += 1) {
    const cur = frame[i]
    const next = frame[(i + 1) % frame.length]
    const fc = a * cur[0] + b * cur[1] + c
    const fn = a * next[0] + b * next[1] + c
    if (fc >= eps) clipped.push(cur)
    if (fc >= eps !== fn >= eps) {
      const t = (eps - fc) / (fn - fc)
      clipped.push([cur[0] + t * (next[0] - cur[0]), cur[1] + t * (next[1] - cur[1])])
    }
  }
  if (clipped.length < 3) return { pixels: [], world: [], area: 0, horizonFrac: 1 }
  const world = clipped.map((p) => applyH(Hinv, p))
  return {
    pixels: clipped,
    world,
    area: shoelace(world),
    horizonFrac: Math.max(0, 1 - shoelace(clipped) / (w * h)),
  }
}

export interface CoverageCheck {
  areas: Record<string, number>
  median: number | null
  /** Wildly off the median - more than 20x, or under 1/20th. */
  flagged: string[]
  /** Seeing past the horizon: no finite floor footprint to compare. */
  unbounded: string[]
}

/**
 * The reference's _coverage_check. READ ITS CAVEAT: footprint area is a WEAK
 * signal, dominated by how near a camera looks to the horizon rather than
 * how much room it sees. It catches only gross scale blow-ups; a clean
 * result is not a green light, and the screen says so.
 */
export function coverageCheck(footprints: Record<string, Footprint>): CoverageCheck {
  const areas: Record<string, number> = {}
  const unbounded: string[] = []
  for (const [camera, fp] of Object.entries(footprints)) {
    if (fp.horizonFrac > 0.01) unbounded.push(camera)
    else areas[camera] = fp.area
  }
  const values = Object.values(areas).sort((x, y) => x - y)
  if (values.length < 2) return { areas, median: null, flagged: [], unbounded: unbounded.sort() }
  const mid = Math.floor(values.length / 2)
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
  const flagged = Object.entries(areas)
    .filter(([, area]) => median > 1e-9 && (area / median > 20 || area / median < 0.05))
    .map(([camera]) => camera)
    .sort()
  return { areas, median, flagged, unbounded: unbounded.sort() }
}

export interface Bounds {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

/**
 * The shared canvas transform S: floor -> canvas pixels, UNIFORM scale plus
 * a shift. Uniform on purpose - a stretched axis would make real skew and
 * real misalignment look the same by eye.
 */
export function canvasTransform(bounds: Bounds, size: number, pad = 20): Matrix3 {
  const span = Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin, 1e-6)
  const scale = (size - 2 * pad) / span
  return [
    [scale, 0, pad - bounds.xmin * scale],
    [0, scale, pad - bounds.ymin * scale],
    [0, 0, 1],
  ]
}

/**
 * A 3x3 planar homography as a CSS matrix3d() - column-major 4x4 with the
 * z row and column left as identity. Applied to an element whose top-left is
 * at the origin (transform-origin 0 0), it maps element pixel (x, y) exactly
 * as H maps (x, y, 1), perspective divide included.
 */
export function toMatrix3d(H: Matrix3): string {
  const [[a, b, c], [d, e, f], [g, h, i]] = H
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].join(', ')})`
}

/** A round grid spacing (1, 2 or 5 times a power of ten) for about `lines` lines. */
export function niceStep(span: number, lines = 10): number {
  const raw = span / Math.max(lines, 1)
  if (raw <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) {
    if (m * magnitude >= raw) return m * magnitude
  }
  return 10 * magnitude
}
