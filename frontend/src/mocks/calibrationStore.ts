import type {
  AlignResult,
  CalibrationRectRequest,
  CalibrationRectResult,
  CameraCalibration,
  SharedPoint,
} from '@/api/types'
import { ApiError } from '@/api/errors'

/**
 * Calibration state for mock mode.
 *
 * WHAT THIS DOES NOT DO, said plainly so nobody reads the numbers as real:
 * there is no homography here, no vanishing-point inference, no BFS over
 * camera pairs. Perspective geometry is the AI service's job and faking it
 * would produce numbers that look authoritative and mean nothing.
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
  camera_id: string
  aligned: boolean
  diagnostics: CameraCalibration['diagnostics']
}

let calibrations: StoredCalibration[] | null = null

function state(): StoredCalibration[] {
  if (calibrations === null) calibrations = []
  return calibrations
}

export function listCalibration(): CameraCalibration[] {
  return state().map((entry) => ({
    camera_id: entry.camera_id,
    aligned: entry.aligned,
    diagnostics: { ...entry.diagnostics },
  }))
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

  const diagnostics: CameraCalibration['diagnostics'] = {
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
  }

  const list = state()
  const existing = list.findIndex((entry) => entry.camera_id === body.camera_id)
  /* Re-calibrating drops alignment: the camera's floor frame just changed,
     so whatever it was reconciled with no longer holds. */
  const entry: StoredCalibration = { camera_id: body.camera_id, aligned: false, diagnostics }
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
  const reference = list[0].camera_id
  const results: AlignResult['results'] = {
    [reference]: { aligned: true, reference: true, n_points: null, via: null },
  }

  const weak: string[] = []
  for (const entry of list.slice(1)) {
    const shared = points.filter(
      (point) => point[entry.camera_id] !== undefined && point[reference] !== undefined,
    ).length

    if (shared >= 2) {
      entry.aligned = true
      entry.diagnostics = {
        ...entry.diagnostics,
        aligned: true,
        aligned_to: reference,
        aligned_with_n_points: shared,
        fit: shared >= 4 ? 'homography' : shared === 3 ? 'affine' : 'similarity',
        aspect_superseded: shared >= 4,
      }
      results[entry.camera_id] = {
        aligned: true,
        reference: false,
        n_points: shared,
        via: reference,
      }
      if (shared < 4) weak.push(entry.camera_id)
    } else {
      entry.aligned = false
      results[entry.camera_id] = {
        aligned: false,
        reference: false,
        n_points: shared,
        via: null,
        error:
          'no chain of >=2-point camera pairs connects this camera back to the reference -- record more shared points involving it',
      }
    }
  }

  list[0].aligned = true
  list[0].diagnostics = { ...list[0].diagnostics, aligned: true }

  return {
    reference,
    results,
    /* Distances shrink to nothing here because nothing was really solved.
       The shape is what the screen renders; the numbers are fixture. */
    residual_checks: points
      .filter((point) => Object.keys(point).length >= 2)
      .map((point) => {
        const cams = Object.keys(point)
        return {
          pairs: [{ cam_a: cams[0], cam_b: cams[1], distance_cm: 0 }],
        }
      }),
    weak_fits:
      weak.length > 0
        ? `camera(s) ${weak.join(', ')} were aligned with <4 shared points, so their own rectangle still determines their world frame. If any of them shows a bad aspect, click more shared points (>=4) to replace it outright.`
        : null,
  }
}

export function deleteCalibration(cameraId: string): void {
  const list = state()
  const index = list.findIndex((entry) => entry.camera_id === cameraId)
  if (index === -1) throw new ApiError('http', 'Camera non calibree', 404)
  list.splice(index, 1)
}

/** Tests only - module state would otherwise leak between them. */
export function resetCalibrationStore(): void {
  calibrations = null
}
