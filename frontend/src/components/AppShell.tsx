import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { Building2, FlaskConical, LogOut, ShieldCheck } from 'lucide-react'
import { MOCK_SCENARIO, USE_MOCKS } from '@/api/config'
import { useScope } from '@/agency/ScopeContext'
import { useSession } from '@/auth/SessionContext'
import { canReach } from '@/auth/access'
import { landingPathFor } from '@/auth/landing'
import { SCREENS } from '@/auth/screens'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'

export function AppShell() {
  // Keying the main region on pathname replays the enter animation per route,
  // so navigation reads as a transition rather than an instant swap.
  const { pathname } = useLocation()
  const { user, signOut } = useSession()
  const scope = useScope()

  /* Only what this role can actually use. A link that answers with a refusal
     is not a link, and the nav is the one place that has to be true. */
  const nav = SCREENS.filter(({ to }) => canReach(user?.role, to))

  /* The URL is the other way in, and hiding the link without closing it would
     leave the boundary half-applied. Sent to where their role starts rather
     than to a refusal, because there is nothing here for them to act on.
     Guarded once for every child route: this is the layout all of them share. */
  if (!canReach(user?.role, pathname)) {
    return <Navigate to={landingPathFor(user?.role)} replace />
  }

  return (
    /* No background here on purpose. The glow lives on <body>, and an opaque
       fill on the app root would paint straight over it - which also takes the
       translucent cards with it, since glass with nothing behind it is just a
       dark rectangle. */
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="bg-accent bg-accent-gradient text-ink sr-only rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      {/* The sidebar has no surface of its own and no dividing rule - it sits
          directly on the canvas, and the only lit thing in it is the active
          item. A navigation panel with its own fill competes with the cards it
          frames; leaving it transparent lets the glass do all the layering. */}
      {/* Pinned to the viewport rather than scrolling with the page. The
          sidebar's bottom section - the theme control, the account, sign out -
          used to sit at the end of a document that is several screens tall, so
          reaching it meant scrolling past the whole roster. Those three are
          the controls least related to the data being read, which makes
          "scroll to the end of the data" exactly the wrong way to get to them.

          h-screen with its own overflow, so a long nav scrolls inside the
          column instead of pushing the account block off the bottom. */}
      <nav
        aria-label="Main"
        className="shrink-0 md:sticky md:top-0 md:flex md:h-screen md:w-64 md:flex-col md:overflow-y-auto"
      >
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-7">
          <ShieldCheck className="text-accent size-[1.15rem]" aria-hidden />
          <span className="text-ink text-[0.95rem] font-medium tracking-tight">
            Smart<span className="text-ink-2">Agency</span>
          </span>
        </div>

        <ul className="flex flex-wrap gap-0.5 px-3 pb-4 md:flex-col md:flex-nowrap">
          {nav.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group ease-soft relative flex items-center gap-3 rounded-[0.9375rem] p-2.5 text-sm transition-all duration-200',
                    /* The selected item is a SOLID panel, not glass, and that
                       is measured from the design rather than assumed. Glass
                       here would be wrong twice over: the sidebar sits on the
                       darkest part of the page, so there is nothing behind it
                       worth showing through, and a translucent selection on a
                       transparent column reads as a smudge rather than a
                       press. Solid gives the item a definite edge. */
                    isActive
                      ? 'bg-panel-2 text-ink shadow-panel font-medium'
                      : 'text-ink-2 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* The icon lives in a chip, and the chip is what carries
                        the state - a flat accent fill when selected, the panel
                        colour when not. Flat rather than the gradient the
                        buttons use: at 32px a two-stop gradient reads as a
                        muddle, and the design keeps its gradients for surfaces
                        big enough to show them.

                        Marking selection on a small square of colour rather
                        than on the label keeps the text at full contrast in
                        both states, which a highlighted row never manages. */}
                    <span
                      className={cn(
                        'ease-soft grid size-8 shrink-0 place-items-center rounded-[0.75rem] transition-all duration-200',
                        isActive
                          ? 'bg-accent text-ink'
                          : 'bg-panel-2 text-ink-2 group-hover:text-ink',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
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
            {/* Sits with the account block rather than in the page header:
                it is a preference about the whole app, not about this screen,
                and putting it beside the sign-out control groups it with the
                other things that are about "you" rather than about the data. */}
            <ThemeToggle className="mb-3 ml-1" />
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
          <div className="bg-warn/8 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-6 py-2">
            <Badge tone="warn" icon={<FlaskConical className="size-3.5" aria-hidden />}>
              Fixture data
            </Badge>
            <span className="text-warn/85 text-xs">
              No backend connected · scenario <span className="tabular">{MOCK_SCENARIO}</span>
            </span>
          </div>
        )}

        {/* Always on while a branch is open, and only leaveable by leaving it.
            An admin reading one branch's numbers as the whole estate is the
            failure this control could cause, so the state it puts them in is
            never off-screen. */}
        {scope.agencyName && (
          <div className="border-accent/25 bg-accent/8 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-2">
            <Building2 className="text-accent size-3.5 shrink-0" aria-hidden />
            <span className="text-ink text-xs">
              Working inside <span className="font-medium">{scope.agencyName}</span> — everything
              below is this branch only.
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={scope.leave}>
              Leave branch
            </Button>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1 px-6 py-7">
          {/* Wider than the old 5xl. A measure that suits prose starves a
              dashboard: the charts and the roster both want horizontal room,
              and on the wall display this runs on, a third of the panel sitting
              empty is the most visible thing on screen. Still capped, because
              a table stretched across an ultrawide is unreadable in the other
              direction. */}
          <div key={pathname} className="animate-fade-rise mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
