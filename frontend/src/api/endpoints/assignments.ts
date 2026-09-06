import { fetchJson } from '../client'
import type { AgentAssignment, AgentSummary } from '../types'

/**
 * PROPOSED CONTRACT - not in contracts/api.md.
 *
 *   GET /api/agents/me/assignment
 *   Roles: AGENT (reads only their own)
 *   Response: AgentAssignment | null - null means nobody has put this agent
 *   on a counter yet.
 *
 * Built ahead of the backend (2026-09-05, at the user's direction) so
 * AgentQueue can read which counter a MANAGER assigned, instead of asking the
 * agent to pick their own service each session. Wired against a mock
 * (mocks/assignmentStore.ts) with the same shape this would return for real.
 * Whoever builds the actual endpoint should add its entry to
 * contracts/api.md - this comment is not a substitute for that, only a
 * head start on what the frontend already expects.
 */
export function fetchMyAssignment(signal?: AbortSignal): Promise<AgentAssignment | null> {
  return fetchJson<AgentAssignment | null>(
    { key: 'GET /api/agents/me/assignment', path: '/api/agents/me/assignment', auth: true },
    { signal },
  )
}

/**
 * PROPOSED CONTRACT - not in contracts/api.md.
 *
 *   GET /api/agencies/{agency_id}/agents
 *   Roles: ADMIN, MANAGER
 *   Response: AgentSummary[] - every AGENT account in this agency, each with
 *   their current assignment.
 *
 * Deliberately its own route rather than a reuse of GET /api/users, which is
 * ADMIN-only (contracts/api.md §5) and would give a MANAGER a wider read than
 * this app grants them anywhere else. Built (2026-09-05, at the user's
 * direction) so the visitor queue board can offer a MANAGER a way to assign
 * their own agents and see how each one's line is doing.
 */
export function fetchAgents(agencyId: string, signal?: AbortSignal): Promise<AgentSummary[]> {
  return fetchJson<AgentSummary[]>(
    {
      key: 'GET /api/agencies/{id}/agents',
      path: `/api/agencies/${agencyId}/agents`,
      auth: true,
    },
    { signal },
  )
}

/**
 * PROPOSED CONTRACT - not in contracts/api.md.
 *
 *   PATCH /api/agents/{user_id}/assignment
 *   Roles: ADMIN, MANAGER
 *   Request body: { "counter_id": "COUNTER_UUID" | null }
 *   Response: AgentAssignment | null
 *
 * `counter_id: null` clears the assignment, the same convention
 * CounterServiceAssignment already uses for clearing a counter's service.
 */
export function assignAgent(
  userId: string,
  counterId: string | null,
  signal?: AbortSignal,
): Promise<AgentAssignment | null> {
  return fetchJson<AgentAssignment | null>(
    {
      key: 'PATCH /api/agents/{id}/assignment',
      path: `/api/agents/${userId}/assignment`,
      method: 'PATCH',
      auth: true,
    },
    { signal, body: { counter_id: counterId } },
  )
}
