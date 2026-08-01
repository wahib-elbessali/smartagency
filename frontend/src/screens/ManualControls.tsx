import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export function ManualControls() {
  return (
    <Screen title="Manual controls">
      <ContractPending screen="Manual lock and motor control" />
      <p className="mt-4 max-w-2xl text-sm text-slate-500">
        These commands move real hardware. Before this screen gets a button, it needs an answer for
        what the UI shows between "clicked" and "hardware confirmed", and what a timeout means.
        Unknown is a legitimate state here — better than confidently showing the wrong one.
      </p>
    </Screen>
  )
}
