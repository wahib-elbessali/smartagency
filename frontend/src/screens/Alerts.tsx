import { ContractPending } from '@/components/ContractPending'
import { StreamStatusBadge } from '@/components/StreamStatusBadge'
import { useAlertsStreamStatus } from '@/hooks/useAlertsStreamStatus'
import { Screen } from './Screen'

export default function Alerts() {
  const status = useAlertsStreamStatus()

  return (
    <Screen
      title="Alerts"
      description="Live security and system events."
      actions={<StreamStatusBadge status={status} />}
    >
      <ContractPending
        screen="Alerts"
        note="The transport is still open: EventSource speaks Server-Sent Events and cannot connect to a WebSocket, and the contract template only mentions WebSocket. Until that is decided the stream connects to nothing and says so — the badge reads “Not connected” rather than showing an empty list that looks calm."
      />
    </Screen>
  )
}
