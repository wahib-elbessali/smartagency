import { registerMock } from '../registry'
import type { Employee } from '@/api/types'
import { makeEmployees } from './people'

registerMock<Employee[]>('GET /api/employees', {
  normal: () => makeEmployees(10),
  empty: () => [],
  /* 200 rows: a table that reads fine at 10 can still stutter or overflow here,
     and that is exactly what the 'large' scenario is for. */
  large: () => makeEmployees(200),
})
