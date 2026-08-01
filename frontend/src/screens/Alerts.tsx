import { ContractPending } from '@/components/ContractPending'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { useAlertsStreamStatus } from '@/hooks/useAlertsStreamStatus'
import { Screen } from './Screen'

export function Alerts() {
  const status = useAlertsStreamStatus()

  return (
    <Screen title="Alerts">
      <div className="mb-5">
        <StreamStatusBadge status={status} />
      </div>

      <ContractPending screen="Alerts" />

      <p className="mt-4 max-w-2xl text-sm text-slate-500">
        The transport is still open: <code className="text-slate-400">EventSource</code> speaks
        Server-Sent Events and cannot connect to a WebSocket, and the contract template only
        mentions WebSocket. Until that is decided the stream connects to nothing and reports it —
        the badge above reads "Not connected" rather than showing an empty list that looks calm.
      </p>
    </Screen>
  )
}
