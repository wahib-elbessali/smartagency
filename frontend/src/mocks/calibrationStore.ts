import type {
  AlignResult,
  CalibrationDiagnostics,
  CalibrationEntry,
  CalibrationGatesRequest,
  CalibrationGatesSaved,
  CalibrationRectRequest,
  CalibrationRectResult,
  CrossCheckResult,
  SharedPoint,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { applyH, multiply, solveHomography, type Matrix3, type Point } from '@/geometry/homography'

/**
 * The AI service's calibration state, for mock mode - the whole site's,
 * keyed by camera NAME as the AI service keys it. The gateway's own checks
 * (agency scope, camera names in this agency) are in fixtures/calibration.ts.
 *
 * WHAT THIS DOES NOT DO, said plainly so nobody reads the numbers as real:
 * no vanishing-point inference and no BFS over camera pairs. The geometry it
 * does is the simplest honest version, so the screens that read `Hinv`
 * (cross-check, gates, the bird's-eye view) have something coherent to show:
 * each camera's clicked quad is mapped onto a rectangle 100 cm tall with the
 * crude aspect below, and alignment fits a similarity (rotation, scale,
 * shift) from each camera's shared spots onto the reference's. Real cameras
 * would need the real solve; these numbers only have to be self-consistent.
 *
 * What it does reproduce is the BEHAVIOUR the screen has to get right, which
 * is where the frontend bugs live:
 *
 *   - exactly 4 points or 422
 *   - a camera is calibrated but NOT aligned until alignment runs
 *   - alignment needs >=2 calibrated cameras (400 otherwise) and >=2 shared
 *     points tying a camera to the reference, or that camera comes back
 *     `aligned: false` WITH the call still returning 200
 *   - fewer than 4 shared points leaves the camera's own rectangle in charge,
 *     which is what `weak_fits` warns about
 *
 * The aspect is a crude ratio of the clicked quad's sides rather than an
 * inference, and `aspect_confident` is true whenever the quad is not almost
 * degenerate. Enough to exercise both branches of the screen's warning; not
 * enough to believe.
 */

interface StoredCalibration {
  camera: string
  Hinv: Matrix3
  diagnostics: CalibrationDiagnostics
}

let calibrations: StoredCalibration[] | null = null
/* Entry/exit gates, floor coordinates - one list for the whole site. */
let gates: Point[] = []

function state(): StoredCalibration[] {
  if (calibrations === null) calibrations = []
  return calibrations
}

/** GET /calibration: the whole site's map, `{}` before anything is calibrated. */
export function listCalibration(): Record<string, CalibrationEntry> {
  return Object.fromEntries(
    state().map((entry) => [
      entry.camera,
      { Hinv: entry.Hinv.map((row) => [...row]), diagnostics: { ...entry.diagnostics } },
    ]),
  )
}

function find(camera: string): StoredCalibration | undefined {
  return state().find((entry) => entry.camera === camera)
}

function sideLength(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

export function calibrateRect(body: CalibrationRectRequest): CalibrationRectResult {
  const points = body.points ?? []
  if (points.length !== 4) {
    throw new ApiError('http', 'La calibration demande exactement 4 points', 422)
  }
  if (!body.img_w || !body.img_h) {
    throw new ApiError('http', 'img_w et img_h sont obligatoires', 422)
  }

  const top = sideLength(points[0], points[1])
  const side = sideLength(points[1], points[2])
  /* Near-collinear points make the real solve meaningless, and the service
     answers 422 for them - so a quad with a side of nothing does here too. */
  if (top < 10 || side < 10) {
    throw new ApiError('http', 'Points trop proches ou alignes', 422)
  }

  const aspect = Number((top / side).toFixed(3))
  const confident = aspect > 0.2 && aspect < 5

  const width = aspect * 100
  const Hinv = solveHomography(points, [
    [0, 0],
    [width, 0],
    [width, 100],
    [0, 100],
  ])
  if (!Hinv) throw new ApiError('http', 'Points trop proches ou alignes', 422)

  const diagnostics: CalibrationDiagnostics = {
    n_points: 4,
    /* ~0 by construction, exactly as the real fit reports - kept so the
       screen has the misleading number to NOT present as accuracy. */
    px_err_mean: 2.9e-13,
    px_err_max: 3.4e-13,
    aspect_source: confident
      ? 'vanishing-point inference'
      : 'vanishing-point inference -- LOW CONFIDENCE, verify by dragging the 4th corner',
    inferred_aspect: aspect,
    aspect_stability_std: confident ? 0.02 : 0.41,
    aspect_confident: confident,
    calib_res: [body.img_w, body.img_h],
    aligned: false,
  }

  const list = state()
  const existing = list.findIndex((entry) => entry.camera === body.camera)
  /* Re-calibrating drops alignment: the camera's floor frame just changed,
     so whatever it was reconciled with no longer holds. */
  const entry: StoredCalibration = { camera: body.camera, Hinv, diagnostics }
  if (existing === -1) list.push(entry)
  else list[existing] = entry

  return { ...diagnostics, aligned: false }
}

export function alignCameras(points: SharedPoint[]): AlignResult {
  const list = state()
  if (list.length < 2) {
    throw new ApiError('http', 'Au moins deux cameras doivent etre calibrees', 400)
  }

  /* The real service picks the most trustworthy camera, not the first. This
     picks the first, and says so rather than implying a judgement. */
  const reference = list[0].camera
  const results: AlignResult['results'] = {
    [reference]: { aligned: true, reference: true, n_points: null, via: null },
  }

  const referenceHinv = list[0].Hinv
  const weak: string[] = []
  for (const entry of list.slice(1)) {
    const sharedPoints = points.filter(
      (point) => point[entry.camera] !== undefined && point[reference] !== undefined,
    )
    const shared = sharedPoints.length

    if (shared >= 2) {
      /* Move this camera's floor onto the reference's. */
      const fit = fitSimilarity(
        sharedPoints.map((point) => applyH(entry.Hinv, point[entry.camera])),
        sharedPoints.map((point) => applyH(referenceHinv, point[reference])),
      )
      if (fit) entry.Hinv = multiply(fit, entry.Hinv)
      entry.diagnostics = {
        ...entry.diagnostics,
        aligned: true,
        aligned_to: reference,
        aligned_with_n_points: shared,
        fit: shared >= 4 ? 'homography' : shared === 3 ? 'affine' : 'similarity',
        aspect_superseded: shared >= 4,
      }
      results[entry.camera] = {
        aligned: true,
        reference: false,
        n_points: shared,
        via: reference,
      }
      if (shared < 4) weak.push(entry.camera)
    } else {
      entry.diagnostics = { ...entry.diagnostics, aligned: false }
      results[entry.camera] = {
        aligned: false,
        reference: false,
        n_points: shared,
        via: null,
        error:
          'no chain of >=2-point camera pairs connects this camera back to the reference -- record more shared points involving it',
      }
    }
  }

  list[0].diagnostics = { ...list[0].diagnostics, aligned: true }

  return {
    reference,
    results,
    /* Computed from the corrected matrices, as the real service does: how
       far apart the aligned cameras now place each recorded spot. Never a
       made-up zero - a similarity fit on real clicks leaves real residue. */
    residual_checks: points.map((point) => ({
      pairs: pairwise(point, (camera) => find(camera)?.diagnostics.aligned === true).pairs,
    })),
    weak_fits:
      weak.length > 0
        ? `camera(s) ${weak.join(', ')} were aligned with <4 shared points, so their own rectangle still determines their world frame. If any of them shows a bad aspect, click more shared points (>=4) to replace it outright.`
        : null,
  }
}

/**
 * Least-squares similarity (rotation + uniform scale + shift) taking `from`
 * onto `to`, as complex numbers: to = a*from + b. Null with fewer than two
 * distinct points.
 */
function fitSimilarity(from: Point[], to: Point[]): Matrix3 | null {
  const n = from.length
  const mean = (pts: Point[]): Point => [
    pts.reduce((s, p) => s + p[0], 0) / n,
    pts.reduce((s, p) => s + p[1], 0) / n,
  ]
  const [fx, fy] = mean(from)
  const [tx, ty] = mean(to)
  let re = 0
  let im = 0
  let norm = 0
  for (let k = 0; k < n; k += 1) {
    const zx = from[k][0] - fx
    const zy = from[k][1] - fy
    const wx = to[k][0] - tx
    const wy = to[k][1] - ty
    /* (w) * conj(z) */
    re += wx * zx + wy * zy
    im += wy * zx - wx * zy
    norm += zx * zx + zy * zy
  }
  if (norm < 1e-9) return null
  const ar = re / norm
  const ai = im / norm
  return [
    [ar, -ai, tx - (ar * fx - ai * fy)],
    [ai, ar, ty - (ai * fx + ar * fy)],
    [0, 0, 1],
  ]
}

/** Distances between where each camera in `point` puts it on the floor. */
function pairwise(point: SharedPoint, include: (camera: string) => boolean) {
  const cameras = Object.keys(point)
    .filter((camera) => find(camera) && include(camera))
    .sort()
  const worlds = Object.fromEntries(
    cameras.map((camera) => [
      camera,
      applyH((find(camera) as StoredCalibration).Hinv, point[camera]),
    ]),
  )
  const pairs: Array<{ cam_a: string; cam_b: string; distance_cm: number }> = []
  for (let i = 0; i < cameras.length; i += 1) {
    for (let j = i + 1; j < cameras.length; j += 1) {
      const a = worlds[cameras[i]]
      const b = worlds[cameras[j]]
      pairs.push({
        cam_a: cameras[i],
        cam_b: cameras[j],
        distance_cm: Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 10) / 10,
      })
    }
  }
  return { worlds, pairs }
}

/**
 * POST /calibration/cross_check - read-only. The same real spot clicked in
 * 2+ ALIGNED cameras; answers where each puts it and how far apart. 422 for
 * fewer than 2, an uncalibrated camera, or an unaligned one - the service's
 * own reasoning: cross-checking an unaligned camera means nothing yet.
 */
export function crossCheck(points: SharedPoint): CrossCheckResult {
  const cameras = Object.keys(points)
  if (cameras.length < 2) {
    throw new ApiError('http', 'need the same point in at least 2 cameras', 422)
  }
  const missing = cameras.filter((camera) => !find(camera))
  if (missing.length > 0) {
    throw new ApiError('http', `not calibrated yet: ${JSON.stringify(missing)}`, 422)
  }
  const unaligned = cameras.filter((camera) => find(camera)?.diagnostics.aligned !== true)
  if (unaligned.length > 0) {
    throw new ApiError(
      'http',
      `not aligned yet: ${JSON.stringify(unaligned)} -- run /calibrate/align first, cross-check only means something once cameras are actually reconciled to a shared frame`,
      422,
    )
  }
  const { worlds, pairs } = pairwise(points, () => true)
  return {
    worlds: Object.fromEntries(
      Object.entries(worlds).map(([camera, [x, y]]) => [
        camera,
        [Math.round(x * 10) / 10, Math.round(y * 10) / 10],
      ]),
    ),
    pairs,
  }
}

/** GET /calibration/gates. */
export function getGates(): { gates: Point[] } {
  return { gates: gates.map(([x, y]) => [x, y] as Point) }
}

/**
 * POST /calibration/gates - REPLACES the whole list. Pixel clicks per camera,
 * converted through that camera's current Hinv; 422 for an uncalibrated one.
 */
export function saveGates(body: CalibrationGatesRequest): CalibrationGatesSaved {
  const next: Point[] = []
  for (const entry of body.gates ?? []) {
    const calibration = find(entry.camera)
    if (!calibration) {
      throw new ApiError(
        'http',
        `camera '${entry.camera}' has no calibration -- calibrate it first (POST /calibration/rect)`,
        422,
      )
    }
    for (const point of entry.points) next.push(applyH(calibration.Hinv, point))
  }
  gates = next
  return { gates: getGates().gates, n: next.length, saved: 'ai/features/data/gates.json' }
}

/** DELETE /calibration/gates - clears every gate on the site. */
export function clearGates(): CalibrationGatesSaved {
  gates = []
  return { gates: [], n: 0, saved: 'ai/features/data/gates.json' }
}

/**
 * The pixel -> floor matrix of a calibrated AND aligned camera, for the
 * zone mock's world conversion; a reason string when it is neither.
 */
export function worldMatrixOf(camera: string): Matrix3 | string {
  const entry = find(camera)
  if (!entry) {
    return `camera '${camera}' has no calibration in site_calibration.json -- a world zone is a FLOOR-metre polygon, so the camera it was drawn on must be calibrated first (POST /calibration/rect)`
  }
  if (entry.diagnostics.aligned !== true) {
    return `camera '${camera}' is calibrated but NOT aligned to a shared frame -- converting through it would anchor this zone to camera ${camera}'s own invented coordinate frame, which looks valid but disagrees with every other camera`
  }
  return entry.Hinv
}

/** Tests only - module state would otherwise leak between them. */
export function resetCalibrationStore(): void {
  calibrations = null
  gates = []
}
