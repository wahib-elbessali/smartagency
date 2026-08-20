import {
  Bell,
  Building2,
  Fan,
  Grid3x3,
  IdCard,
  KeyRound,
  ShieldCheck,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/api/types'
import { canReach } from './access'

/**
 * Every screen in the shell, in the order the navigation shows them.
 *
 * Lives here rather than inside AppShell because two things need it now: the
 * sidebar, and the confirmation that explains what a role change costs someone.
 * That second one is the reason it is worth a module - a warning that says "they
 * will lose access to some screens" is not worth reading, and one that names
 * User accounts and Agencies is.
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
  { to: '/users', label: 'User accounts', icon: ShieldCheck },
  { to: '/climate', label: 'Climate', icon: Fan },
  { to: '/visitors', label: 'Visitor queue', icon: Users },
  { to: '/occupancy', label: 'Occupancy', icon: Grid3x3 },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/controls', label: 'Manual controls', icon: KeyRound },
]

/** The screens a role may reach, by label. */
export function screensFor(role: Role): string[] {
  return SCREENS.filter((screen) => canReach(role, screen.to)).map((screen) => screen.label)
}

/**
 * What moving between two roles opens and closes, named rather than counted.
 *
 * Both lists are usually short and one is usually empty, which is the point:
 * the reader can check the answer against what they meant to do.
 */
export function accessChange(from: Role, to: Role): { gained: string[]; lost: string[] } {
  const before = new Set(screensFor(from))
  const after = new Set(screensFor(to))

  return {
    gained: [...after].filter((label) => !before.has(label)),
    lost: [...before].filter((label) => !after.has(label)),
  }
}
