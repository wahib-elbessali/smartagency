import { FileWarning } from 'lucide-react'

/**
 * Shown by a screen that has no endpoint to call yet.
 *
 * This is deliberately not a mock of the finished screen. A convincing fake
 * invites someone to assume the data is real, and the point of this panel is
 * that the data does not exist.
 */
export function ContractPending({ screen }: { screen: string }) {
  return (
    <div className="max-w-2xl rounded-lg border border-slate-700 bg-slate-900/60 p-6">
      <div className="mb-3 flex items-center gap-2 font-medium text-slate-200">
        <FileWarning className="size-5 text-slate-400" aria-hidden />
        <span>Waiting on the API contract</span>
      </div>
      <p className="text-sm leading-relaxed text-slate-400">
        {screen} has no endpoint in <code className="text-slate-300">contracts/api.md</code> yet, so
        there is nothing to render. The mock layer, routing, and loading/empty/error states are in
        place — this screen fills in once the contract entry is merged.
      </p>
    </div>
  )
}
