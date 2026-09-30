import type { AgentAssignment, AgentSummary } from '@/api/types'
import { ApiError } from '@/api/errors'
import { getService } from './serviceStore'
import { COUNTERS } from './ticketStore'
import { listUsers } from './userStore'

/**
 * Mock of the agent-assignment routes (contracts/api.md §5): which counter
 * each agent has been put on by their manager. Refuses the way
 * backend/app/api/assignments.py does, detail strings included, so the
 * board's error states can be exercised without a backend. The one refusal
 * it can't reproduce is the 422 agency mismatch - fixture counters carry no
 * agency.
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

  /* The contract only reports an assignment whose point has an ACTIVE
     service - a deactivated one reads as unassigned. */
  const service = getService(counter.service_id)
  if (!service.is_active) return null
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
  const user = listUsers().find((u) => u.id === userId)
  if (!user) throw new ApiError('http', 'Utilisateur introuvable', 404)
  if (user.role !== 'AGENT') {
    throw new ApiError('http', 'L utilisateur doit avoir le role AGENT', 422)
  }

  if (counterId !== null) {
    const counter = COUNTERS.find((c) => c.id === counterId)
    if (!counter) throw new ApiError('http', 'Guichet ou bureau introuvable', 404)
    if (!counter.service_id) {
      throw new ApiError('http', 'Ce guichet n est affecte a aucun service', 409)
    }
    if (!getService(counter.service_id).is_active) {
      throw new ApiError('http', 'Le service du guichet est inactif', 409)
    }
  }

  assignments[userId] = counterId
  return getMyAssignment(userId)
}

/** Tests only - module state would otherwise leak between them. */
export function resetAssignmentStore(): void {
  assignments = { ...SEED }
}
