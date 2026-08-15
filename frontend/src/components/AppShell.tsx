import { NavLink, Outlet, useLocation } from 'react-router'
import {
  Bell,
  Fan,
  FlaskConical,
  Grid3x3,
  IdCard,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react'
import { MOCK_SCENARIO, USE_MOCKS } from '@/api/config'
import { useSession } from '@/auth/SessionContext'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'

const NAV = [
  { to: '/presence', label: 'Employee presence', icon: UserCheck },
  { to: '/employees', label: 'Employees', icon: IdCard },
  { to: '/users', label: 'User accounts', icon: ShieldCheck },
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
  const { user, signOut } = useSession()

  return (
    <div className="bg-canvas flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="bg-accent text-canvas sr-only rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      {/* The sidebar sits DARKER than the content it frames, not lighter. A
          navigation panel lit brighter than the work pulls the eye away from
          the thing being looked at all day. */}
      <nav
        aria-label="Main"
        className="bg-canvas ring-line/70 shrink-0 md:flex md:w-60 md:flex-col md:ring-1"
      >
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-7">
          <ShieldCheck className="text-accent size-[1.15rem]" aria-hidden />
          <span className="text-ink text-[0.95rem] font-medium tracking-tight">
            Smart<span className="text-ink-2">Agency</span>
          </span>
        </div>

        <ul className="flex flex-wrap gap-0.5 px-3 pb-4 md:flex-col md:flex-nowrap">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group ease-soft rounded-control relative flex items-center gap-3 px-3 py-2 text-[0.8125rem] transition-colors duration-150',
                    /* The active item is marked by its own surface plus the
                       rail below - no tint. A coloured wash behind text is
                       the easiest way to make a sidebar look templated, and
                       it costs contrast on the label itself. */
                    isActive
                      ? 'bg-panel text-ink font-medium'
                      : 'text-ink-2 hover:bg-panel/60 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* The rail grows out of nothing rather than fading in.
                        Scaling on the Y axis reads as the marker travelling to
                        the new item; opacity alone reads as two separate
                        things blinking. */}
                    <span
                      aria-hidden
                      className={cn(
                        'bg-accent ease-soft absolute top-2 bottom-2 -left-3 w-[3px] origin-center rounded-full transition-transform duration-300',
                        isActive ? 'scale-y-100' : 'scale-y-0',
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

        {user && (
          /* Role is shown because several endpoints are role-scoped, so "why
             can't I see the other agency?" has a visible answer instead of
             looking like a bug. */
          <div className="mt-auto hidden px-3 pt-3 pb-4 md:block">
            <div className="flex items-center gap-2.5 px-1 py-1">
              <Avatar name={user.full_name} />
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-[0.8125rem] font-medium">
                  {user.full_name}
                </div>
                {/* The role is set as a small tracked label rather than body
                    text, so it reads as metadata about the name above it
                    instead of a second, competing line. */}
                <div className="text-ink-3 tracked truncate text-[10px]">{user.role}</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={signOut}
              className="mt-1 w-full justify-start"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </Button>
          </div>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {USE_MOCKS && (
          /* Always visible while mocking. A screen of fake numbers must never
             be mistakable for a live one. */
          <div className="bg-warn/8 flex items-center gap-2.5 px-6 py-2">
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
