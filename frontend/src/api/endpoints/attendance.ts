import { fetchJson } from '../client'
import type { AttendanceRecord } from '../types'

/**
 * GET /api/attendance/today
 *
 * The snapshot the presence screen starts from. WS /ws/attendance then keeps it
 * current - see attendanceMerge.ts for why those two cannot simply be
 * concatenated.
 */
export function fetchAttendanceToday(signal?: AbortSignal): Promise<AttendanceRecord[]> {
  return fetchJson<AttendanceRecord[]>(
    { key: 'GET /api/attendance/today', path: '/api/attendance/today', auth: true },
    { signal },
  )
}
