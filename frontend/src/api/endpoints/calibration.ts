import { fetchJson } from '../client'
import type {
  AlignResult,
  CalibrationEntry,
  CalibrationRectRequest,
  CalibrationRectResult,
  CameraCalibration,
  SharedPoint,
} from '../types'

/**
 * Site calibration - backend/app/api/ai_calibration.py (PR #109), the
 * gateway in front of contracts/ai-service.md §/calibration. Not in
 * contracts/api.md yet; paths and bodies transcribed from that backend
 * source. These are the heaviest writes on the AI service: they define the
 * floor geometry every world-mode zone and the whole person tracker are
 * computed against, so getting them wrong does not fail loudly, it just
 * moves everybody a metre.
 *
 * ADMIN and MANAGER only, under the agency's path. Every camera is named,
 * not id'd, and must be one of this agency's (404 otherwise).
 *
 * NOT HERE:
 *   - Forgetting one camera's calibration. The AI service has
 *     DELETE /calibration/{camera}; the gateway does not proxy it, so there
 *     is no way to do it from this dashboard. Re-calibrating replaces a
 *     camera's fit, which covers the common case. Raised with backend.
 *   - Gates and cross-check, which the gateway does proxy: gates are a
 *     tracking prior nothing here reads, and cross-check belongs with a
 *     bird's-eye view that is not built.
 */

/** The gateway's name-keyed map, folded into a list - the one place that happens. */
export async function fetchCalibration(
  agencyId: string,
  signal?: AbortSignal,
): Promise<CameraCalibration[]> {
  const map = await fetchJson<Record<string, CalibrationEntry>>(
    {
      key: 'GET /api/agencies/{id}/ai/calibration',
      path: `/api/agencies/${agencyId}/ai/calibration`,
      auth: true,
    },
    { signal },
  )
  return Object.entries(map).map(([camera, entry]) => ({
    camera,
    Hinv: entry.Hinv,
    diagnostics: entry.diagnostics ?? {},
  }))
}

/**
 * Fit one camera's rectangle. 422 for anything other than 4 points, or for
 * points near enough to collinear that the solve is meaningless.
 */
export function calibrateRect(
  agencyId: string,
  body: CalibrationRectRequest,
  signal?: AbortSignal,
): Promise<CalibrationRectResult> {
  return fetchJson<CalibrationRectResult>(
    {
      key: 'POST /api/agencies/{id}/ai/calibration/rect',
      path: `/api/agencies/${agencyId}/ai/calibration/rect`,
      method: 'POST',
      auth: true,
    },
    { signal, body },
  )
}

/**
 * Reconcile every calibrated camera into one shared floor frame.
 *
 * `points` is the FULL accumulated list every time, not a delta - the
 * service re-solves from scratch, so sending only the newest point would
 * quietly throw away every earlier one.
 *
 * 400 with fewer than two cameras calibrated. A per-camera failure does NOT
 * fail the call: it comes back 200 with that camera's `aligned: false` and
 * an `error` string, which is why the screen reads `results` per camera.
 */
export function alignCameras(
  agencyId: string,
  points: SharedPoint[],
  signal?: AbortSignal,
): Promise<AlignResult> {
  return fetchJson<AlignResult>(
    {
      key: 'POST /api/agencies/{id}/ai/calibration/align',
      path: `/api/agencies/${agencyId}/ai/calibration/align`,
      method: 'POST',
      auth: true,
    },
    { signal, body: { points } },
  )
}
