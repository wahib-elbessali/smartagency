import { NavLink, Outlet, useLocation } from 'react-router'
import {
  Bell,
  Fan,
  FlaskConical,
  Grid3x3,
  KeyRound,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react'
import { MOCK_SCENARIO, USE_MOCKS } from '@/api/config'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/components/ui/cn'

const NAV = [
  { to: '/presence', label: 'Employee presence', icon: UserCheck },
  { to: '/climate', label: 'Climate', icon: Fan },
  { to: '/visitors', label: 'Visitor queue', icon: Users },
  { to: '/occupancy', label: 'Occupancy', icon: Grid3x3 },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/controls', label: 'Manual controls', icon: KeyRound },
] as const

export function AppShell() {
  // Keying the main region on pathname replays the enter animation per route,
  // so navigation reads as a transition rather than an instant swap.
  const { pathname } = useLocation()

  return (
    <div className="bg-canvas flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="bg-accent text-canvas sr-only rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <nav
        aria-label="Main"
        className="border-line bg-panel/70 shrink-0 border-b backdrop-blur md:w-64 md:border-r md:border-b-0"
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <ShieldCheck className="text-accent size-5" aria-hidden />
          <span className="text-ink text-[0.95rem] font-semibold tracking-tight">SmartAgency</span>
        </div>

        <ul className="flex flex-wrap gap-1 px-3 pb-4 md:flex-col md:flex-nowrap">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group ease-soft relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                    isActive
                      ? 'bg-accent/12 text-ink font-medium'
                      : 'text-ink-2 hover:bg-panel-2 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'bg-accent ease-soft absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-full transition-opacity duration-200',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <Icon
                      className={cn(
                        'size-4 transition-colors',
                        isActive ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2',
                      )}
                      aria-hidden
                    />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {USE_MOCKS && (
          /* Always visible while mocking. A screen of fake numbers must never
             be mistakable for a live one. */
          <div className="border-warn/25 bg-warn/8 flex items-center gap-2.5 border-b px-6 py-2">
            <Badge tone="warn" icon={<FlaskConical className="size-3.5" aria-hidden />}>
              Fixture data
            </Badge>
            <span className="text-warn/85 text-xs">
              No backend connected · scenario <span className="tabular">{MOCK_SCENARIO}</span>
            </span>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1 px-6 py-7">
          <div key={pathname} className="animate-fade-rise mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
