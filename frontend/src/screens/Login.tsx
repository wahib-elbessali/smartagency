import { type FormEvent, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useSession } from '@/auth/SessionContext'
import { ApiError, describeApiError } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Panel, PanelBody } from '@/components/ui/Panel'

export default function Login() {
  const { signIn } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signIn({ username, password })
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
    <div className="bg-canvas flex min-h-screen items-center justify-center px-6">
      <div className="animate-fade-rise w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <ShieldCheck className="text-accent size-5" aria-hidden />
          <span className="text-ink font-semibold tracking-tight">SmartAgency</span>
        </div>

        <Panel>
          <PanelBody className="py-6">
            <h1 className="text-ink text-base font-semibold">Sign in</h1>
            <p className="text-ink-3 mt-1 text-sm">Building security dashboard.</p>

            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="username" className="text-ink-2 mb-1.5 block text-sm">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
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
