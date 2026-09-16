import type { AgentAssignment, AgentSummary } from '@/api/types'
import { ApiError } from '@/api/errors'
import { getService } from './serviceStore'
import { COUNTERS } from './ticketStore'
import { listUsers } from './userStore'

/**
 * PROPOSED, mock-only: which counter each agent has been put on by their
 * manager. Nothing on the real backend stores this yet - checked
 * backend/app/models/entities.py, neither User nor Employee carries a
 * service or counter - so this stands in for it until a real endpoint exists.
 * See api/types.ts's AgentAssignment/AgentSummary and
 * api/endpoints/assignments.ts for the shape this is built against.
 *
 * Keyed by user id, not employee id: the assignment is about the account
 * calling tickets, not the person behind it.
 */
const SEED: Record<string, string | null> = {
  /* Nadia Cherkaoui, the seeded AGENT fixture (currentUser.ts), pre-assigned
     to Guichet 1 so the screen has a real "already assigned" state to show
     from the first load, not just after using the new control below. */
  'u1000000-0000-4000-8000-000000000005': 'c1000000-0000-4000-8000-000000000001',
}

let assignments: Record<string, string | null> = { ...SEED }

export function getMyAssignment(userId: string): AgentAssignment | null {
  const counterId = assignments[userId]
  if (!counterId) return null

  const counter = COUNTERS.find((c) => c.id === counterId)
  if (!counter || !counter.service_id) return null

  const service = getService(counter.service_id)
  return {
    counter_id: counter.id,
    counter_name: counter.name,
    service_id: service.id,
    service_name: service.name,
  }
}

/**
 * Every AGENT account in one agency, with their current assignment.
 *
 * Deliberately built off userStore rather than a separate agent list: an
 * agent is just a User with role AGENT, and GET /api/users is ADMIN-only
 * (contracts/api.md §5) - narrower than what a MANAGER needs here, which is
 * why this reads as its own proposed endpoint rather than reusing that one.
 */
export function listAgentSummaries(agencyId: string): AgentSummary[] {
  return listUsers()
    .filter((u) => u.role === 'AGENT' && u.agency_id === agencyId)
    .map((u) => ({ user_id: u.id, full_name: u.full_name, assignment: getMyAssignment(u.id) }))
}

/** `counterId: null` clears the assignment. */
export function assignAgent(userId: string, counterId: string | null): AgentAssignment | null {
  if (counterId !== null && !COUNTERS.some((c) => c.id === counterId)) {
    throw new ApiError('http', 'Guichet introuvable', 404)
  }
  assignments[userId] = counterId
  return getMyAssignment(userId)
}

/** Tests only - module state would otherwise leak between them. */
export function resetAssignmentStore(): void {
  assignments = { ...SEED }
}
