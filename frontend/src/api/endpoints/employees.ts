import { fetchJson } from '../client'
import type { Employee } from '../types'

/**
 * GET /api/employees
 *
 * Role-scoped by the backend, not by us: "ADMIN sees all employees. MANAGER
 * sees only employees from its agency." So the frontend must not filter by
 * agency itself - it would silently double-filter and hide rows an ADMIN is
 * entitled to see.
 */
export function fetchEmployees(signal?: AbortSignal): Promise<Employee[]> {
  return fetchJson<Employee[]>(
    { key: 'GET /api/employees', path: '/api/employees', auth: true },
    { signal },
  )
}
