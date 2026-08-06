import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export default function Alerts() {
  return (
    <Screen title="Alerts" description="Security and safety events.">
      <ContractPending
        screen="Alerts"
        note={
          'The transport question is settled - WS /ws/attendance is a WebSocket - but that ' +
          'socket carries check-ins and check-outs, not alerts. It now feeds the Employee ' +
          'presence screen, which is what it is for. Real alerts (weapon, fire, intruder) are ' +
          'features 10, 13 and 15 of the project brief and are specified in contracts/ai-service.md ' +
          'on the unmerged branch feat/ai-service-contract, not in contracts/api.md. This screen ' +
          'stays empty until it is decided whether the frontend talks to that service directly or ' +
          'through the backend - wiring it to the attendance feed instead would be a lie.'
        }
      />
    </Screen>
  )
}
