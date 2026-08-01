import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export default function Climate() {
  return (
    <Screen title="Climate / HVAC" description="Temperature and humidity per zone.">
      <ContractPending
        screen="Climate / HVAC"
        note="Thresholds — what counts as too hot or too cold — come from the contract or from Ahmed, not from this screen."
      />
    </Screen>
  )
}
