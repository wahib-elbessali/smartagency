import { type FormEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { useSession } from '@/auth/SessionContext'
import { ApiError, describeApiError } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody } from '@/components/ui/Panel'
import { ParticleField } from '@/components/ParticleField'
import { ThemeToggle } from '@/components/ThemeToggle'

interface FromState {
  from?: string
}

export default function Login() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  /* Where RequireAuth bounced us from, so signing in returns you to the screen
     you actually wanted instead of dumping you on the default one.

     Falling back to "/" rather than a named screen: the index route turns the
     signed-in role into a starting screen (auth/landing.ts), which keeps this
     form from having to know that a TECHNICIAN is refused from /presence. */
  const from = (location.state as FromState | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signIn({ email, password })
      void navigate(from, { replace: true })
    } catch (cause) {
      setError(
        cause instanceof ApiError ? describeApiError(cause) : 'Could not sign in. Try again.',
      )
    } finally {
      setPending(false)
    }
  }

  const field =
    'w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-colors duration-150 focus:border-accent/60'

  return (
    /* `relative` and `isolate`: the canvas is positioned against this element
       and the stacking context is closed here, so a negative z-index on the
       field cannot slip behind the page background and disappear. */
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-6">
      <ParticleField className="pointer-events-none absolute inset-0 -z-10 h-full w-full" />

      {/* Top-right, away from the form. The theme control belongs here for the
          same reason it sits by the account block once you are signed in: it
          is about the application rather than about the task in front of you,
          and someone arriving on a wall display at night should be able to
          dim it without signing in first. */}
      <div className="absolute top-6 right-6 z-10">
        <ThemeToggle />
      </div>

      <div className="animate-fade-rise w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <ShieldCheck className="text-accent size-5" aria-hidden />
          <span className="text-ink font-semibold tracking-tight">SmartAgency</span>
        </div>

        {/* The one card the whole screen is about, so it earns the glow. */}
        <Panel glow>
          <PanelBody className="py-6">
            <h1 className="text-ink text-base font-semibold">Sign in</h1>
            <p className="text-ink-3 mt-1 text-sm">Agency operations dashboard.</p>

            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="email" className="text-ink-2 mb-1.5 block text-sm">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  /* type="email" gives the right mobile keyboard and a free
                     format check. autoComplete="username" is correct even on an
                     email field - it is what password managers look for to
                     offer a saved credential. */
                  type="email"
                  autoComplete="username"
                  placeholder="name@agency.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={field}
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="text-ink-2 mb-1.5 block text-sm">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={field}
                  required
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="border-warn/30 bg-warn/8 text-warn rounded-lg border p-3 text-sm"
                >
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" disabled={pending} className="w-full">
                {pending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}
