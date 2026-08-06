import { registerMock } from '../registry'
import type { Agency } from '@/api/types'
import { AGENCY_ID, AGENCY_ID_RABAT } from './people'

/** Field names from GET /api/agencies. `zones` and `counters` stay [] - the
 *  contract shows them empty and never documents an element shape. */
function casablanca(): Agency {
  return {
    id: AGENCY_ID,
    name: 'Agence Casablanca',
    address: 'Casablanca',
    phone: '0522000000',
    opening_time: '08:30:00',
    closing_time: '16:30:00',
    is_active: true,
    zones: [],
    counters: [],
    employees_count: 10,
    devices_count: 2,
    cameras_count: 3,
  }
}

function rabat(): Agency {
  return {
    id: AGENCY_ID_RABAT,
    name: 'Agence Rabat',
    address: 'Rabat',
    phone: '0537000000',
    opening_time: '09:00:00',
    closing_time: '17:00:00',
    is_active: true,
    zones: [],
    counters: [],
    employees_count: 6,
    devices_count: 1,
    cameras_count: 2,
  }
}

registerMock<Agency[]>('GET /api/agencies', {
  normal: () => [casablanca()],
  empty: () => [],
  large: () => [casablanca(), rabat()],
})
