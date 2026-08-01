import { NavLink, Outlet } from 'react-router'
import { Bell, Fan, Grid3x3, KeyRound, Users, UserCheck } from 'lucide-react'
import { MOCK_SCENARIO, USE_MOCKS } from '@/api/config'

const NAV = [
  { to: '/presence', label: 'Employee presence', icon: UserCheck },
  { to: '/climate', label: 'Climate', icon: Fan },
  { to: '/visitors', label: 'Visitor queue', icon: Users },
  { to: '/occupancy', label: 'Occupancy', icon: Grid3x3 },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/controls', label: 'Manual controls', icon: KeyRound },
] as const

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav
        aria-label="Main"
        className="shrink-0 border-b border-slate-800 bg-slate-900 md:w-60 md:border-r md:border-b-0"
      >
        <div className="px-4 py-5">
          <p className="text-sm font-semibold tracking-wide text-slate-200">SmartAgency</p>
        </div>
        <ul className="flex flex-wrap gap-1 px-2 pb-3 md:flex-col md:flex-nowrap">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                    isActive
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {USE_MOCKS && (
          /* Never let fixture data pass for live data - playbook 9. */
          <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
            Fixture data — no backend connected (scenario: {MOCK_SCENARIO})
          </p>
        )}
        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
