import { Wifi, WifiOff } from 'lucide-react'
import type { StreamStatus } from '@/api/alertsStream'

/** Colour alone never carries the status - there is an icon and a word too. */
const PRESENTATION: Record<StreamStatus, { label: string; className: string; live: boolean }> = {
  idle: { label: 'Not started', className: 'text-slate-400 border-slate-700', live: false },
  connecting: { label: 'Connecting…', className: 'text-sky-300 border-sky-500/40', live: false },
  open: { label: 'Live', className: 'text-emerald-300 border-emerald-500/40', live: true },
  reconnecting: {
    label: 'Reconnecting…',
    className: 'text-amber-200 border-amber-500/40',
    live: false,
  },
  closed: { label: 'Not connected', className: 'text-amber-200 border-amber-500/40', live: false },
}

export function StreamStatusBadge({ status }: { status: StreamStatus }) {
  const { label, className, live } = PRESENTATION[status]
  const Icon = live ? Wifi : WifiOff

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${className}`}
      role="status"
      aria-live="polite"
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}
