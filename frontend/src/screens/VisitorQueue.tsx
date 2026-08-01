import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export function VisitorQueue() {
  return (
    <Screen title="Visitor queue">
      <ContractPending screen="Visitor queue" />
    </Screen>
  )
}
