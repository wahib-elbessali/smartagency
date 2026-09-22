import { fetchJson } from '../client'
import type {
  AlignResult,
  CalibrationRectRequest,
  CalibrationRectResult,
  CameraCalibration,
  SharedPoint,
} from '../types'

/**
 * Site calibration — PROPOSED, not in contracts/api.md (2026-09-20).
 *
 * contracts/ai-service.md §/calibration, proxied by the backend for the
 * reason everything AI-facing is (repo CLAUDE.md, 2026-08-11). These are
 * the heaviest writes on that service: they define the floor geometry every
 * world-mode zone and the whole person tracker are computed against, so
 * getting them wrong does not fail loudly, it just moves everybody a metre.
 * BACKEND-ASKS.md §8b.
 *
 * Gates (`/calibration/gates`) are deliberately not here. They are a
 * tracking prior rather than geometry, nothing in this dashboard reads
 * them, and asking backend to proxy a route no screen calls would be
 * asking for work with no user.
 *
 * Roles: ADMIN and MANAGER, as for zones.
 */

export function fetchCalibration(signal?: AbortSignal): Promise<CameraCalibration[]> {
  return fetchJson<CameraCalibration[]>(
    { key: 'GET /api/calibration', path: '/api/calibration', auth: true },
    { signal },
  )
}

/**
 * Fit one camera's rectangle. 422 for anything other than 4 points, or for
 * points near enough to collinear that the solve is meaningless.
 */
export function calibrateRect(
  body: CalibrationRectRequest,
  signal?: AbortSignal,
): Promise<CalibrationRectResult> {
  return fetchJson<CalibrationRectResult>(
    {
      key: 'POST /api/calibration/rect',
      path: '/api/calibration/rect',
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
 * 400 with fewer than two cameras calibrated. Note that a per-camera
 * failure does NOT fail the call: it comes back 200 with that camera's
 * `aligned: false` and an `error` string, which is why the screen reads
 * `results` per camera instead of treating 200 as success.
 */
export function alignCameras(points: SharedPoint[], signal?: AbortSignal): Promise<AlignResult> {
  return fetchJson<AlignResult>(
    {
      key: 'POST /api/calibration/align',
      path: '/api/calibration/align',
      method: 'POST',
      auth: true,
    },
    { signal, body: { points } },
  )
}

/** Forgets one camera's geometry. The zones drawn on it are unaffected. */
export function deleteCalibration(cameraId: string, signal?: AbortSignal): Promise<void> {
  return fetchJson<void>(
    {
      key: 'DELETE /api/calibration/{id}',
      path: `/api/calibration/${cameraId}`,
      method: 'DELETE',
      auth: true,
    },
    { signal },
  )
}
