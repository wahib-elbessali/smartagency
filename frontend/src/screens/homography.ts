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
