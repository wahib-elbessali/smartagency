import { useEffect, useState } from 'react'
import { createAlertsStream, type StreamStatus } from '@/api/alertsStream'

/**
 * Subscribes to the alerts transport's connection status.
 *
 * Kept separate from the event subscription because the status matters even
 * when no events are arriving: a disconnected alerts list that still looks calm
 * is the dangerous failure on this screen.
 */
export function useAlertsStreamStatus(): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('idle')

  useEffect(() => {
    const stream = createAlertsStream()
    const unsubscribe = stream.onStatusChange(setStatus)

    return () => {
      unsubscribe()
      stream.close()
    }
  }, [])

  return status
}
