import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export default function ManualControls() {
  return (
    <Screen title="Manual controls" description="Doors, locks, and motors.">
      <ContractPending
        screen="Manual lock and motor control"
        note="These commands move real hardware. Before this screen gets a button it needs an answer for what the UI shows between “clicked” and “hardware confirmed”, and what a timeout means. Unknown is a legitimate state here — better than confidently showing the wrong one."
      />
    </Screen>
  )
}
