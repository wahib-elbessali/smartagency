import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { RequireAuth } from '@/auth/RequireAuth'
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
          <Route index element={<Navigate to="/presence" replace />} />
          <Route path="presence" element={<EmployeePresence />} />
          <Route path="employees" element={<Employees />} />
          {/* Same reasoning as /users below: readable by admins and managers,
              and anyone else meets the refusal state rather than a dead link. */}
          <Route path="agencies" element={<Agencies />} />
          {/* Reachable by anyone signed in, and answers with the refusal state
              for a non-admin. Hiding it would make a 403 look like a broken
              link instead of a permissions boundary. */}
          <Route path="users" element={<Users />} />
          <Route path="climate" element={<Climate />} />
          <Route path="visitors" element={<VisitorQueue />} />
          <Route path="occupancy" element={<Occupancy />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="controls" element={<ManualControls />} />
          <Route path="*" element={<Navigate to="/presence" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
