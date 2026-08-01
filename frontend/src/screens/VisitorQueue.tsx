import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export default function VisitorQueue() {
  return (
    <Screen title="Visitor queue" description="Visitors waiting at reception.">
      <ContractPending
        screen="Visitor queue"
        note="Ordering and stale entries are the open question here: what happens to someone who was served an hour ago?"
      />
    </Screen>
  )
}
