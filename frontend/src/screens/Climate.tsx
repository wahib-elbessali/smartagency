import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export function Climate() {
  return (
    <Screen title="Climate / HVAC">
      <ContractPending screen="Climate / HVAC" />
      <p className="mt-4 max-w-2xl text-sm text-slate-500">
        Thresholds — what counts as too hot or too cold — come from the contract or from Ahmed, not
        from this screen.
      </p>
    </Screen>
  )
}
