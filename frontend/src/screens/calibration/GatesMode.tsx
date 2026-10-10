import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Undo2 } from 'lucide-react'
import { clearGates, fetchGates, saveGates } from '@/api/endpoints/calibration'
import { ApiError, describeApiError } from '@/api/errors'
import type { Camera, CameraCalibration } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { controlClass } from '@/components/ui/control'
import { applyH, invert, type Matrix3, type Point } from '@/geometry/homography'
import { FrameCanvas, type Marker } from './FrameCanvas'

/**
 * Step 3: entry and exit gates - the doorways people come in and out of.
 *
 * The person tracker uses them as a prior: a detection that matches no one
 * and appears far from every gate is taken to be someone already being
 * tracked whose position drifted, not somebody new. No gates at all is a safe
 * default - that logic simply does not apply - so this step is optional.
 *
 * ONE CLICK, ONE CAMERA. Unlike alignment, a gate needs no agreement between
 * cameras: it is clicked on any one calibrated camera, sent as that pixel,
 * and the AI service converts it to the floor through that camera's own
 * calibration (contracts/ai-service.md §/calibration, POST /gates).
 *
 * THE WHOLE LIST, EVERY TIME. A save REPLACES every gate on the site, and
 * saved gates come back only as floor coordinates - never as the pixels they
 * were clicked at. So keeping the others while adding one means turning
 * each saved gate back into pixels of the camera in hand, through the
 * inverse of that camera's own matrix, and sending those alongside the new
 * clicks. The round trip goes through the same matrix both ways, so it lands
 * exactly where it was (nothing is rounded on the way - a fixed rounding step
 * is a different fraction of the room in every scene). The same projection
 * is what draws the saved gates on the picture, so they survive a camera
 * switch or a new frame instead of vanishing with the click that made them.
 *
 * SITE-WIDE, SAID OUT LOUD. Gates are floor coordinates and belong to no
 * camera, so the list is every branch's, and clearing it clears theirs too.
 * The screen says so on the button that does it.
 */
export function GatesMode({
  agencyId,
  cameras,
  byCamera,
}: {
  agencyId: string
  cameras: Camera[]
  byCamera: Map<string, CameraCalibration>
}) {
  const queryClient = useQueryClient()
  const calibrated = useMemo(
    () => cameras.filter((camera) => byCamera.has(camera.name)),
    [cameras, byCamera],
  )
  const [pickedId, setPickedId] = useState<string | null>(null)
  const camera = calibrated.find((c) => c.id === pickedId) ?? calibrated[0] ?? null
  const Hinv = camera ? (byCamera.get(camera.name)?.Hinv as Matrix3 | undefined) : undefined
  const H = useMemo(() => (Hinv ? invert(Hinv) : null), [Hinv])

  const gates = useQuery({
    queryKey: ['gates', agencyId],
    queryFn: ({ signal }) => fetchGates(agencyId, signal),
  })
  const saved: Point[] = gates.data?.gates ?? []

  const [draft, setDraft] = useState<Point[]>([])
  const [confirmClear, setConfirmClear] = useState(false)

  const done = async () => {
    setDraft([])
    setConfirmClear(false)
    await queryClient.invalidateQueries({ queryKey: ['gates', agencyId] })
  }

  /* Every saved gate, as pixels of the camera in hand, minus any being removed. */
  function resend(keep: Point[], extra: Point[]) {
    if (!camera || !H) throw new Error('no inverse for this camera')
    return saveGates(agencyId, {
      gates: [{ camera: camera.name, points: [...keep.map((g) => applyH(H, g)), ...extra] }],
    })
  }

  const save = useMutation({ mutationFn: () => resend(saved, draft), onSuccess: done })
  const removeOne = useMutation({
    mutationFn: (index: number) => {
      const keep = saved.filter((_, i) => i !== index)
      /* Removing the last one is a clear, not an empty replace. */
      return keep.length === 0 ? clearGates(agencyId) : resend(keep, [])
    },
    onSuccess: done,
  })
  const clear = useMutation({ mutationFn: () => clearGates(agencyId), onSuccess: done })

  const markers: Marker[] = H
    ? saved.map((gate, i) => ({ point: applyH(H, gate), label: `gate ${i + 1}`, color: '#4ade80' }))
    : []

  const error = save.error ?? removeOne.error ?? clear.error ?? gates.error
  const busy = save.isPending || removeOne.isPending || clear.isPending

  if (calibrated.length === 0) {
    return (
      <Panel as="section">
        <PanelBody>
          <h2 className="text-ink text-sm font-semibold">Calibrate a camera first</h2>
          <p className="text-ink-2 mt-1 text-sm leading-relaxed">
            A gate is a place on the floor, and a camera can only say where its pixels are on the
            floor once it has been calibrated.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div>
        <div className="mb-3 max-w-xs">
          <label
            htmlFor="gates_camera"
            className="text-ink-3 tracked mb-2 block text-[11px] font-medium"
          >
            Camera
          </label>
          <select
            id="gates_camera"
            className={controlClass()}
            value={camera?.id ?? ''}
            onChange={(e) => {
              setPickedId(e.target.value || null)
              setDraft([])
            }}
          >
            {calibrated.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        {camera && (
          <FrameCanvas
            key={camera.id}
            camera={camera}
            points={draft}
            maxPoints={Number.POSITIVE_INFINITY}
            shape="none"
            markers={markers}
            onAddPoint={(point) => setDraft((current) => [...current, point])}
            hint="Click where people step through a doorway or entrance, on the floor. Green dots are gates already saved; orange ones are yours, not saved yet."
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={draft.length === 0}
                  onClick={() => setDraft((current) => current.slice(0, -1))}
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  Undo last point
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={draft.length === 0 || busy || !H || gates.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending
                    ? 'Saving…'
                    : draft.length === 0
                      ? 'Save gates'
                      : `Save ${draft.length} gate${draft.length === 1 ? '' : 's'}`}
                </Button>
                <p role="status" aria-live="polite" className="text-ink-3 text-xs">
                  {!H
                    ? 'This camera’s calibration cannot be inverted, so saved gates cannot be kept — recalibrate it.'
                    : draft.length === 0
                      ? 'No new gates yet.'
                      : `${draft.length} new gate${draft.length === 1 ? '' : 's'}, not saved yet.`}
                </p>
              </div>
            }
          />
        )}

        {error != null && (
          <p
            role="alert"
            className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm"
          >
            {error instanceof ApiError ? describeApiError(error) : 'Could not update the gates.'}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Panel as="section">
          <PanelHeader>
            <h2 className="text-ink text-sm font-semibold">Saved gates</h2>
            <p className="text-ink-3 mt-1 text-xs leading-relaxed">
              One list for the whole site, every branch included — a gate is a place on the shared
              floor, not on a camera.
            </p>
          </PanelHeader>
          <PanelBody>
            {gates.isPending ? (
              <p className="text-ink-3 text-sm">Loading gates…</p>
            ) : saved.length === 0 ? (
              <p className="text-ink-2 text-sm leading-relaxed">
                None yet. That is a safe default: the tracker simply does not use gates until some
                are marked.
              </p>
            ) : (
              <ul className="space-y-2">
                {saved.map(([x, y], i) => (
                  <li
                    key={`${x}-${y}-${i}`}
                    className="border-line bg-panel-2 flex items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <span className="text-ink flex-1 text-sm font-medium">gate {i + 1}</span>
                    {/* Rounded for reading only; what is sent is never rounded. */}
                    <span className="text-ink-3 tabular text-xs">
                      {x.toFixed(1)}, {y.toFixed(1)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove gate ${i + 1}`}
                      disabled={busy || !H}
                      onClick={() => removeOne.mutate(i)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {saved.length > 0 &&
              (confirmClear ? (
                <div className="border-warn/30 bg-warn/8 mt-3 rounded-lg border p-3">
                  <p className="text-warn text-sm leading-relaxed">
                    This removes all {saved.length} gates on the site, other branches' included.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => setConfirmClear(false)}>
                      Keep them
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => clear.mutate()}
                    >
                      Clear every gate
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3"
                  onClick={() => setConfirmClear(true)}
                >
                  Clear every gate on the site…
                </Button>
              ))}
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}
