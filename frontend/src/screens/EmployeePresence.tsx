import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export function EmployeePresence() {
  return (
    <Screen title="Employee presence">
      <ContractPending screen="Employee presence" />
    </Screen>
  )
}
