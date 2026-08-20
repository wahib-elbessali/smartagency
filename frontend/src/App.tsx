import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { RequireAuth } from '@/auth/RequireAuth'
import { useSession } from '@/auth/SessionContext'
import { landingPathFor } from '@/auth/landing'
import { SkeletonRows } from '@/components/ui/Skeleton'

/**
 * Screens are lazy so each becomes its own chunk. Six screens in one bundle
 * means opening the alerts view downloads the heatmap and every chart library
 * it will eventually pull in - on a wall display that is a slow first paint for
 * no reason.
 */
const EmployeePresence = lazy(() => import('@/screens/EmployeePresence'))
const Climate = lazy(() => import('@/screens/Climate'))
const VisitorQueue = lazy(() => import('@/screens/VisitorQueue'))
const Occupancy = lazy(() => import('@/screens/Occupancy'))
const Alerts = lazy(() => import('@/screens/Alerts'))
const ManualControls = lazy(() => import('@/screens/ManualControls'))
const Employees = lazy(() => import('@/screens/Employees'))
const Agencies = lazy(() => import('@/screens/Agencies'))
const Users = lazy(() => import('@/screens/Users'))
const Login = lazy(() => import('@/screens/Login'))

function RouteFallback() {
  return (
    <div className="max-w-2xl">
      <span className="sr-only" role="status" aria-live="polite">
        Loading screen
      </span>
      <SkeletonRows rows={3} />
    </div>
  )
}

/**
 * The one place a role becomes a starting screen.
 *
 * Login sends you to "/" rather than working the role out itself, so the map
 * has a single home and the sign-in screen keeps knowing nothing about roles.
 * It renders inside RequireAuth, so `user` is already resolved here.
 */
function Landing() {
  const { user } = useSession()
  return <Navigate to={landingPathFor(user?.role)} replace />
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Landing />} />
          {/* Every route below is registered for everyone and filtered by role
              in AppShell, which owns both the navigation and the URL guard
              (auth/access.ts). Routing stays a map of what exists; who may see
              it is one table rather than a condition repeated nine times. */}
          <Route path="presence" element={<EmployeePresence />} />
          <Route path="employees" element={<Employees />} />
          <Route path="agencies" element={<Agencies />} />
          <Route path="users" element={<Users />} />
          <Route path="climate" element={<Climate />} />
          <Route path="visitors" element={<VisitorQueue />} />
          <Route path="occupancy" element={<Occupancy />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="controls" element={<ManualControls />} />
          {/* An unknown path is not a reason to show someone a screen their
              role is refused from, so it resolves the same way "/" does. */}
          <Route path="*" element={<Landing />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
