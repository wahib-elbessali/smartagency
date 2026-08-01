import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export default function EmployeePresence() {
  return (
    <Screen title="Employee presence" description="Who is currently in the building.">
      <ContractPending screen="Employee presence" />
    </Screen>
  )
}
