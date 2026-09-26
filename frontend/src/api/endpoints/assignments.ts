import { fetchJson } from '../client'
import { ApiError, describeApiError } from '../errors'
import type { AgentAssignment, AgentSummary } from '../types'

/**
 * Agent-to-counter assignment - contracts/api.md §5, the three routes after
 * the users block. Which guichet or bureau a MANAGER has put an AGENT on, so
 * AgentQueue can open straight onto that counter's service instead of asking
 * the agent to pick one each session.
 */

/**
 * GET /api/agents/me/assignment - AGENT only, their own.
 * `null` means nobody has put this agent on a counter yet.
 */
export function fetchMyAssignment(signal?: AbortSignal): Promise<AgentAssignment | null> {
  return fetchJson<AgentAssignment | null>(
    { key: 'GET /api/agents/me/assignment', path: '/api/agents/me/assignment', auth: true },
    { signal },
  )
}

/**
 * GET /api/agencies/{agency_id}/agents - ADMIN, or MANAGER for their own
 * agency. Every AGENT account in it, each with their current assignment.
 *
 * Its own route rather than GET /api/users, which stays ADMIN-only - the
 * contract keeps a MANAGER's read this narrow on purpose.
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
 * PATCH /api/agents/{user_id}/assignment - ADMIN, or MANAGER for agents in
 * their own agency. `counter_id: null` clears it; the response is the new
 * assignment, or `null` once cleared.
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

/**
 * Turns an assignment failure into what the board shows a person.
 *
 * The statuses are the contract's own list. 409 is a counter whose service
 * was removed or deactivated since the picker loaded (backend raises it for
 * both); 422 is a counter or agent from another agency (backend also uses
 * 422 when the target account is no longer an AGENT); 403 is a MANAGER
 * reaching outside their agency, raised by backend's scope check.
 */
export function assignmentErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'That did not work.'

  switch (error.status) {
    case 409:
      return 'That counter no longer has an active service, so nobody can be put on it. The list has been refreshed.'
    case 422:
      return 'That agent and that counter are not in the same agency, or the account is no longer an agent.'
    case 404:
      return 'That agent or counter no longer exists. The list has been refreshed.'
    case 403:
      return 'You can only assign agents in your own agency.'
    default:
      return describeApiError(error)
  }
}
