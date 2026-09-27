import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchCalibration } from '@/api/endpoints/calibration'
import { fetchCameras } from '@/api/endpoints/cameras'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { controlClass } from '@/components/ui/control'
import { AlignMode } from './calibration/AlignMode'
import { BirdsEyeMode } from './calibration/BirdsEyeMode'
import { CalibrateMode } from './calibration/CalibrateMode'
import { GatesMode } from './calibration/GatesMode'
import { Screen } from './Screen'

export { AlignReport } from './calibration/AlignReport'

/**
 * Site calibration: teaching the cameras where the floor is. Added
 * 2026-09-20, from ai/reference_ui/calibration rebuilt on this side of the
 * backend (contracts/ai-service.md §/calibration), through the backend's
 * gateway (backend/app/api/ai_calibration.py, see api/endpoints/calibration.ts).
 * Every camera is addressed by NAME, which is how the AI service knows it.
 *
 * WHAT IT IS FOR, since nothing on this screen is visible in the product:
 * a pixel is not a place. One camera's "that person is at (410, 620)" means
 * nothing to another camera, and nothing at all in metres. Calibration turns
 * pixels into floor positions; alignment makes every camera agree on the
 * same floor. World-mode zones and person tracking are built on it, and
 * neither can exist until this is done once per site.
 *
 * TWO STEPS, AND THE SECOND IS NOT OPTIONAL (plus a third that is)
 *
 * 1. CALIBRATE one camera: click 3 corners of something that is a right
 *    angle in real life; the 4th is placed as a draggable guess. No
 *    measuring, no numbers - the rectangle's true proportions are inferred
 *    from the perspective in those 4 points (calibration/CalibrateMode.tsx).
 * 2. ALIGN the cameras: click the same real spot - or points along the same
 *    real straight edge - in two or more of them, record it, repeat
 *    (calibration/AlignMode.tsx). Until this runs, every camera has invented its own
 *    private coordinate system and two cameras can each look perfect while
 *    disagreeing by metres about where the same person is standing. The same
 *    clicks can then be CROSS-CHECKED - read-only - to see the alignment took.
 * 3. GATES, optional: the doorways the person tracker treats as where new
 *    people appear (calibration/GatesMode.tsx).
 * 4. BIRD'S-EYE CHECK: every camera's picture laid onto one top-down floor,
 *    to see the alignment agree - or double (calibration/BirdsEyeMode.tsx).
 *
 * THE REPROJECTION ERROR IS A TRAP AND IS NOT SHOWN AS ACCURACY
 *
 * A 4-point fit is exact by construction, so `px_err` comes back ~0 whether
 * or not the clicked shape really was a right angle. The contract says so
 * outright. Showing it as a score would teach people to trust a calibration
 * that may be badly wrong. What IS worth reading is `aspect_confident`:
 * false means the geometry was too degenerate to infer the shape and a
 * square was guessed, and that is surfaced loudly.
 *
 * The pieces live in screens/calibration/: the shared clickable canvas, one
 * file per step, and the alignment report. Missing, and not by choice: forgetting one camera's calibration. The
 * gateway does not proxy the AI service's DELETE for it, so there is no
 * button; re-calibrating a camera replaces its fit.
 *
 * KEYBOARD: placing a point is a pointer act, as on the Zones screen. Every
 * control around it is reachable, and a live region reads out each point as
 * it lands.
 */

type Mode = 'calibrate' | 'align' | 'gates' | 'birdseye'

export default function Calibration() {
  const { user } = useSession()
  const scope = useScope()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
    enabled: isAdmin,
  })

  const [pickedAgencyId, setPickedAgencyId] = useState<string | null>(null)
  const agencyId = isAdmin
    ? (pickedAgencyId ?? scope.agencyId ?? agencies.data?.[0]?.id ?? null)
    : (user?.agency_id ?? null)

  const cameras = useQuery({
    queryKey: ['cameras', agencyId],
    queryFn: ({ signal }) => fetchCameras(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const calibration = useQuery({
    queryKey: ['calibration', agencyId],
    queryFn: ({ signal }) => fetchCalibration(agencyId as string, signal),
    enabled: agencyId !== null,
  })

  const cameraRows = useMemo(
    () => [...(cameras.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [cameras.data],
  )
  const byCamera = useMemo(
    () => new Map((calibration.data ?? []).map((entry) => [entry.camera, entry])),
    [calibration.data],
  )

  const [mode, setMode] = useState<Mode>('calibrate')

  return (
    <Screen
      title="Calibration"
      description="Teaching the cameras where the floor is, so they can agree on where somebody is standing."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {isAdmin && (
          <div className="max-w-xs flex-1">
            <label
              htmlFor="calibration_agency"
              className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
            >
              Branch
            </label>
            <select
              id="calibration_agency"
              className={controlClass()}
              value={agencyId ?? ''}
              onChange={(e) => setPickedAgencyId(e.target.value || null)}
            >
              {(agencies.data ?? []).map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={mode === 'calibrate' ? 'primary' : 'secondary'}
            onClick={() => setMode('calibrate')}
          >
            1. Calibrate a camera
          </Button>
          <Button
            size="sm"
            variant={mode === 'align' ? 'primary' : 'secondary'}
            onClick={() => setMode('align')}
          >
            2. Align the cameras
          </Button>
          <Button
            size="sm"
            variant={mode === 'gates' ? 'primary' : 'secondary'}
            onClick={() => setMode('gates')}
          >
            3. Entry gates
          </Button>
          <Button
            size="sm"
            variant={mode === 'birdseye' ? 'primary' : 'secondary'}
            onClick={() => setMode('birdseye')}
          >
            4. Bird's-eye check
          </Button>
        </div>
      </div>

      <AsyncBoundary
        isPending={cameras.isPending}
        error={cameras.error}
        isEmpty={cameraRows.length === 0}
        emptyMessage="No cameras in this branch yet. Calibration is per camera, so register one first."
        forbiddenMessage="Calibration is done by administrators and managers. Ask an administrator if you need access."
        onRetry={() => void cameras.refetch()}
        skeletonRows={3}
      >
        {mode === 'calibrate' ? (
          <CalibrateMode
            agencyId={agencyId as string}
            cameras={cameraRows}
            byCamera={byCamera}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: ['calibration'] })}
          />
        ) : mode === 'birdseye' ? (
          <BirdsEyeMode cameras={cameraRows} byCamera={byCamera} />
        ) : mode === 'gates' ? (
          <GatesMode agencyId={agencyId as string} cameras={cameraRows} byCamera={byCamera} />
        ) : (
          <AlignMode
            agencyId={agencyId as string}
            cameras={cameraRows}
            byCamera={byCamera}
            onAligned={() => void queryClient.invalidateQueries({ queryKey: ['calibration'] })}
          />
        )}
      </AsyncBoundary>

      {/* Where this actually gets used, for anyone wondering why they are
          clicking floor tiles. */}
      <p className="text-ink-3 mt-4 text-xs leading-relaxed">
        Zones spanning several cameras and person tracking both need this done.{' '}
        <Link to="/zones" className="text-ink-2 hover:text-accent underline">
          Zones
        </Link>{' '}
        drawn on a single camera do not.
      </p>
    </Screen>
  )
}
