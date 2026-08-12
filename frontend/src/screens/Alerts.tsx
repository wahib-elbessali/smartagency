import { useMemo, useState } from 'react'
import { AlertTriangle, Flame, ShieldAlert, Smile, UserSearch } from 'lucide-react'
import { createAlertStream } from '@/api/endpoints/streams'
import { applyAlertFrame, activeCameras, type AlertsByCamera } from '@/api/streamMerge'
import {
  ALERT_FEATURES,
  type AlertDetection,
  type AlertFeature,
  type AlertFrame,
} from '@/api/types'
import { useStream } from '@/hooks/useStream'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { Screen } from './Screen'

/**
 * Computer-vision alerts, one feature at a time.
 *
 * The stream comes from the backend, which proxies the AI service - the
 * frontend never reaches that service directly. It has no authentication at
 * all, and this feed carries the names and face photographs of people on a
 * watchlist, so a browser talking to it would be an open biometric endpoint.
 *
 * Reading this screen correctly depends on one thing: **the feed only speaks
 * when something changes.** No detections and no messages for an hour is the
 * normal state of a safe branch, not a broken connection. That is why the
 * status badge is given equal weight to the content - it is the only thing
 * that distinguishes "nothing is happening" from "we stopped listening".
 *
 * The four features are separate streams, mirroring the AI service. If the
 * backend merges them the switcher goes away; see endpoints/streams.ts.
 */

const FEATURE_LABEL: Record<AlertFeature, string> = {
  weapon: 'Weapons',
  fire: 'Fire and smoke',
  emotion: 'Distress',
  wanted: 'Watchlist',
}

const FEATURE_ICON: Record<AlertFeature, typeof ShieldAlert> = {
  weapon: ShieldAlert,
  fire: Flame,
  emotion: Smile,
  wanted: UserSearch,
}

/**
 * How a detection's confidence should be read, which differs by feature.
 *
 * For `wanted` it is cosine similarity in [-1, 1], not a probability. The
 * contract says so in as many words, and rendering "61% sure this is a wanted
 * person" would be a fabrication with real consequences.
 */
function confidenceLabel(feature: AlertFeature, value: number): string {
  if (feature === 'wanted') return `similarity ${value.toFixed(2)}`
  return `${Math.round(value * 100)}% confidence`
}

function DetectionRow({
  feature,
  detection,
}: {
  feature: AlertFeature
  detection: AlertDetection
}) {
  return (
    <div className="border-line bg-panel-2 flex items-start gap-3 rounded-lg border p-3">
      {/* Only the wanted feed carries a face, and only on the highest-
          confidence detection in a frame. */}
      {detection.snapshot && (
        <img
          src={`data:image/jpeg;base64,${detection.snapshot}`}
          alt=""
          className="border-line size-12 shrink-0 rounded border object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">{detection.class}</span>
          {detection.held && <Badge tone="neutral">held — position may be stale</Badge>}
        </div>
        <p className="text-ink-3 mt-0.5 text-xs">
          {confidenceLabel(feature, detection.confidence)}
          {detection.face_px !== undefined && ` · face ${detection.face_px}px`}
        </p>
      </div>
    </div>
  )
}

export default function Alerts() {
  const [feature, setFeature] = useState<AlertFeature>('weapon')

  const { state: alerts, status } = useStream<AlertFrame, AlertsByCamera>(
    feature,
    () => createAlertStream(feature),
    applyAlertFrame,
    () => ({}),
  )

  const active = useMemo(() => activeCameras(alerts), [alerts])
  const cameras = useMemo(() => Object.keys(alerts).sort(), [alerts])
  const Icon = FEATURE_ICON[feature]

  return (
    <Screen
      title="Alerts"
      description="What the cameras are seeing right now."
      actions={<StreamStatusBadge status={status} />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {ALERT_FEATURES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === feature ? 'primary' : 'secondary'}
            onClick={() => setFeature(option)}
          >
            {FEATURE_LABEL[option]}
          </Button>
        ))}
      </div>

      {active.length > 0 ? (
        <Panel as="section" tone="alert">
          <PanelHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-warn size-4" aria-hidden />
              <h2 className="text-ink text-sm font-semibold">
                {active.length === 1 ? '1 camera' : `${active.length} cameras`} detecting something
              </h2>
            </div>
          </PanelHeader>
          <PanelBody className="space-y-4">
            {active.map((camera) => (
              <div key={camera}>
                <p className="text-ink-2 mb-2 text-xs font-medium">{camera}</p>
                <div className="space-y-2">
                  {(alerts[camera] ?? []).map((detection, i) => (
                    <DetectionRow
                      key={`${camera}-${detection.class}-${i}`}
                      feature={feature}
                      detection={detection}
                    />
                  ))}
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>
      ) : (
        <Panel as="section">
          <PanelBody className="flex gap-4 py-5">
            <Icon className="text-ink-3 mt-0.5 size-5 shrink-0" aria-hidden />
            <div role="status">
              <h2 className="text-ink text-sm font-semibold">
                {status === 'open' ? 'All clear' : 'Nothing to show yet'}
              </h2>
              <p className="text-ink-2 mt-1.5 text-sm leading-relaxed">
                {status === 'open'
                  ? `No ${FEATURE_LABEL[feature].toLowerCase()} detections on any camera.`
                  : 'Waiting for the feed. Nothing here means the connection, not the cameras.'}
              </p>
            </div>
          </PanelBody>
        </Panel>
      )}

      {cameras.length > 0 && (
        <p className="text-ink-3 mt-4 text-xs leading-relaxed">
          Watching {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'}:{' '}
          {cameras.join(', ')}. This feed only sends a message when what a camera sees changes, so a
          long silence is normal — check the badge above, not the emptiness below.
        </p>
      )}
    </Screen>
  )
}
