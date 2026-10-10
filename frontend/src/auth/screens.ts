import {
  Armchair,
  Bell,
  Building2,
  Camera,
  Cpu,
  Fan,
  Grid3x3,
  IdCard,
  KeyRound,
  Layers,
  Pentagon,
  Ruler,
  UserCheck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
/**
 * Every screen in the shell, in the order the navigation shows them.
 *
 * Lives here rather than inside AppShell so the list and the rule that filters
 * it (access.ts) sit together, and neither has to be found from the other.
 */
/**
 * Which sidebar section a screen sits in. Every screen a role can open is on
 * the sidebar - grouped, not hidden: an earlier pass moved the set-up screens
 * into Settings and nobody could find them. Live is what is watched through
 * the day; Organisation is who and where; Setup is what is configured once.
 */
export type ScreenGroup = 'live' | 'organisation' | 'setup'

export interface ScreenEntry {
  to: string
  label: string
  icon: LucideIcon
  group: ScreenGroup
  /** One line, shown in search results and on the Help screen. */
  description: string
}

export const SCREENS: readonly ScreenEntry[] = [
  {
    to: '/presence',
    label: 'Employee presence',
    icon: UserCheck,
    group: 'live',
    description: 'Who badged in today, and when.',
  },
  {
    to: '/employees',
    label: 'Employees',
    icon: IdCard,
    group: 'organisation',
    description: 'Staff records and attendance history.',
  },
  {
    to: '/agencies',
    label: 'Agencies',
    icon: Building2,
    group: 'organisation',
    description: 'Branches, and the way into one branch.',
  },
  {
    to: '/services',
    label: 'Services',
    icon: Layers,
    group: 'organisation',
    description: 'What visitors can take a ticket for.',
  },
  {
    to: '/users',
    label: 'User accounts',
    icon: UserCog,
    group: 'organisation',
    description: 'Logins, roles and branch access.',
  },
  {
    to: '/climate',
    label: 'Climate',
    icon: Fan,
    group: 'live',
    description: 'Temperature, humidity and air quality.',
  },
  {
    to: '/visitors',
    label: 'Visitor queue',
    icon: Users,
    group: 'live',
    description: 'Tickets waiting, being served and done.',
  },
  {
    to: '/occupancy',
    label: 'Occupancy',
    icon: Grid3x3,
    group: 'live',
    description: 'How many people are in each zone.',
  },
  {
    to: '/zones',
    label: 'Zones',
    icon: Pentagon,
    group: 'setup',
    description: 'Draw the areas the cameras count.',
  },
  /* Its own icon: presence and staffing measure different things (a badge
     at the door vs an occupied counter) and must not read as one screen. */
  {
    to: '/staffing',
    label: 'Counter staffing',
    icon: Armchair,
    group: 'live',
    description: 'Which counters are manned right now.',
  },
  {
    to: '/calibration',
    label: 'Calibration',
    icon: Ruler,
    group: 'setup',
    description: 'Map camera pixels to floor distances.',
  },
  {
    to: '/alerts',
    label: 'Alerts',
    icon: Bell,
    group: 'live',
    description: 'Live security alerts from the cameras.',
  },
  {
    to: '/cameras',
    label: 'Cameras',
    icon: Camera,
    group: 'live',
    description: 'Live feeds and detector thresholds.',
  },
  {
    to: '/devices',
    label: 'IoT devices',
    icon: Cpu,
    group: 'setup',
    description: 'Sensors, readers and their thresholds.',
  },
  {
    to: '/controls',
    label: 'Manual controls',
    icon: KeyRound,
    group: 'setup',
    description: 'Doors, locks and motors.',
  },
]

/** The sidebar sections, in order. SCREENS is already ordered within each. */
export const SCREEN_SECTIONS: readonly { group: ScreenGroup; title: string }[] = [
  { group: 'live', title: 'Live' },
  { group: 'organisation', title: 'Organisation' },
  { group: 'setup', title: 'Setup' },
]
