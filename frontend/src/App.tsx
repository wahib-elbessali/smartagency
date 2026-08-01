import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { Alerts } from '@/screens/Alerts'
import { Climate } from '@/screens/Climate'
import { EmployeePresence } from '@/screens/EmployeePresence'
import { ManualControls } from '@/screens/ManualControls'
import { Occupancy } from '@/screens/Occupancy'
import { VisitorQueue } from '@/screens/VisitorQueue'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/presence" replace />} />
        <Route path="presence" element={<EmployeePresence />} />
        <Route path="climate" element={<Climate />} />
        <Route path="visitors" element={<VisitorQueue />} />
        <Route path="occupancy" element={<Occupancy />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="controls" element={<ManualControls />} />
        <Route path="*" element={<Navigate to="/presence" replace />} />
      </Route>
    </Routes>
  )
}
