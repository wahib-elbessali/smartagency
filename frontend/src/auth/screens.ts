import {
  Bell,
  Building2,
  Cpu,
  Fan,
  Grid3x3,
  IdCard,
  KeyRound,
  Layers,
  ShieldCheck,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
/**
 * Every screen in the shell, in the order the navigation shows them.
 *
 * Lives here rather than inside AppShell so the list and the rule that filters
 * it (access.ts) sit together, and neither has to be found from the other.
 */
export interface ScreenEntry {
  to: string
  label: string
  icon: LucideIcon
}

export const SCREENS: readonly ScreenEntry[] = [
  { to: '/presence', label: 'Employee presence', icon: UserCheck },
  { to: '/employees', label: 'Employees', icon: IdCard },
  { to: '/agencies', label: 'Agencies', icon: Building2 },
  { to: '/services', label: 'Services', icon: Layers },
  { to: '/users', label: 'User accounts', icon: ShieldCheck },
  { to: '/climate', label: 'Climate', icon: Fan },
  { to: '/visitors', label: 'Visitor queue', icon: Users },
  { to: '/occupancy', label: 'Occupancy', icon: Grid3x3 },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/devices', label: 'IoT devices', icon: Cpu },
  { to: '/controls', label: 'Manual controls', icon: KeyRound },
]
