import { ContractPending } from '@/components/ContractPending'
import { Screen } from './Screen'

export function Occupancy() {
  return (
    <Screen title="Occupancy heatmap">
      <ContractPending screen="Occupancy heatmap" />
      <p className="mt-4 max-w-2xl text-sm text-slate-500">
        This screen also needs a floorplan and a sensor-to-coordinate mapping, which exist nowhere
        in the repo and have to come from the hardware side. A placeholder grid can be built before
        then, but it will be a placeholder and the PR will say so.
      </p>
    </Screen>
  )
}
