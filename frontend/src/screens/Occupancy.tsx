import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export default function Occupancy() {
  return (
    <Screen title="Occupancy heatmap" description="Where people are, by zone.">
      <ContractPending
        screen="Occupancy heatmap"
        note="This screen also needs a floorplan and a sensor-to-coordinate mapping, which exist nowhere in the repo and have to come from the hardware side. A placeholder grid can be built before then, but it will be a placeholder and the PR will say so."
      />
    </Screen>
  )
}
