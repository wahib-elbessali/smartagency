import { Badge } from '@/components/ui/Badge'
import type { AlignResult, Camera } from '@/api/types'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'

/**
 * The outcome of one alignment, told only about this branch's cameras.
 *
 * Alignment is site-wide underneath: the AI service re-solves every
 * calibrated camera it knows, and the gateway passes the whole result back.
 * So the report keeps the rows, the residuals and the weak-fit note to this
 * branch's own cameras, and names another branch's camera only as that -
 * never by name - when it happens to be the reference. The free-text
 * `weak_fits` lists camera names, so it is rebuilt here from the per-camera
 * rows instead of shown verbatim. (Raised with backend: the gateway should
 * scope this itself.)
 */
export function AlignReport({ result, cameras }: { result: AlignResult; cameras: Camera[] }) {
  const mine = new Set(cameras.map((camera) => camera.name))
  const nameOf = (name: string) => (mine.has(name) ? name : 'a camera in another branch')
  const entries = Object.entries(result.results).filter(([name]) => mine.has(name))
  const failed = entries.filter(([, value]) => !value.aligned)
  const weak = entries
    .filter(([, value]) => value.aligned && !value.reference && (value.n_points ?? 0) < 4)
    .map(([name]) => name)
  const residuals = result.residual_checks.flatMap((check) =>
    check.pairs.filter((pair) => mine.has(pair.cam_a) && mine.has(pair.cam_b)),
  )
  /* The contract calls this `results_warning`; the service emits
     `reference_warning`. Both are read so neither is silently dropped. */
  const referenceWarning = result.reference_warning ?? result.results_warning

  return (
    <Panel as="section" tone={failed.length > 0 ? 'alert' : 'neutral'} className="mt-3">
      <PanelHeader>
        <h2 className="text-ink text-sm font-semibold">
          {failed.length === 0
            ? 'Every camera is on the same floor now'
            : `${failed.length} camera${failed.length === 1 ? '' : 's'} could not be reached`}
        </h2>
        <p className="text-ink-3 mt-1 text-xs">
          Everything was reconciled onto {nameOf(result.reference)}.
        </p>
      </PanelHeader>
      <PanelBody>
        <ul className="space-y-2">
          {entries.map(([cameraName, value]) => (
            <li
              key={cameraName}
              className="border-line bg-panel-2 rounded-lg border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                  {nameOf(cameraName)}
                </span>
                {value.reference && <Badge tone="info">reference</Badge>}
                <Badge tone={value.aligned ? 'ok' : 'warn'}>
                  {value.aligned ? 'aligned' : 'not aligned'}
                </Badge>
              </div>
              {value.error && <p className="text-ink-2 mt-1.5 text-xs">{value.error}</p>}
              {value.aligned && !value.reference && (
                <p className="text-ink-3 mt-1.5 text-xs">
                  Tied to {nameOf(value.via ?? '')} with {value.n_points} shared spot
                  {value.n_points === 1 ? '' : 's'}
                  {value.order_reversed && ' — point order was reversed to fit better'}.
                </p>
              )}
            </li>
          ))}
        </ul>

        {referenceWarning && (
          <p className="border-warn/30 bg-warn/8 text-warn mt-3 rounded-lg border p-3 text-sm leading-relaxed">
            {referenceWarning}
          </p>
        )}
        {weak.length > 0 && (
          <p className="text-ink-2 mt-3 text-sm leading-relaxed">
            {weak.join(', ')} {weak.length === 1 ? 'was' : 'were'} aligned on fewer than 4 shared
            spots, so {weak.length === 1 ? 'its' : 'their'} own rectangle still sets the floor
            shape. If one looks stretched, record more shared spots (4 or more) to replace it
            outright.
          </p>
        )}

        {residuals.length > 0 && (
          <p className="text-ink-3 mt-3 text-xs leading-relaxed">
            Across the spots you recorded, the cameras now place the same point within{' '}
            <span className="text-ink-2 tabular">
              {Math.max(0, ...residuals.map((pair) => pair.distance_cm)).toFixed(1)} cm
            </span>{' '}
            of each other at worst. Small is the whole point; metres mean the alignment did not
            take.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}
