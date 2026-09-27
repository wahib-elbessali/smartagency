import type { EmployeeFace } from '@/api/types'
import { ApiError } from '@/api/errors'
import { listEmployees } from './employeeStore'
import { AGENCY_ID } from './fixtures/people'

/**
 * The employee face gallery, for mock mode - backend/app/api/face_recognition.py
 * in front of the AI service's /face, keyed by employee id as the backend
 * enrolls it. Agency scoping is in fixtures/faces.ts.
 *
 *   404  an employee that does not exist
 *   422  an inactive employee, or a file that is not an image (or empty)
 *   413  a photo over 10 MB
 *
 * One Casablanca employee starts enrolled with two photos, so the screen has
 * both states to show from the first load.
 */

const MAX_BYTES = 10 * 1024 * 1024

let gallery: Map<string, number> | null = null

function seed(): Map<string, number> {
  if (gallery === null) {
    gallery = new Map()
    const first = listEmployees().find((employee) => employee.agency_id === AGENCY_ID)
    if (first) gallery.set(first.id, 2)
  }
  return gallery
}

function employeeOr404(employeeId: string) {
  const employee = listEmployees().find((candidate) => candidate.id === employeeId)
  if (!employee) throw new ApiError('http', 'Employe introuvable', 404)
  return employee
}

function toFace(employeeId: string, count: number): EmployeeFace {
  const employee = employeeOr404(employeeId)
  return {
    employee_id: employee.id,
    employee_name: `${employee.first_name} ${employee.last_name}`,
    agency_id: employee.agency_id,
    enrolled: true,
    embeddings_count: count,
  }
}

/** Enrolled employees only, optionally one agency's. */
export function listFaces(agencyId: string | null): EmployeeFace[] {
  const known = new Set(listEmployees().map((employee) => employee.id))
  return [...seed().entries()]
    .filter(([id]) => known.has(id))
    .map(([id, count]) => toFace(id, count))
    .filter((face) => agencyId === null || face.agency_id === agencyId)
}

export function agencyOfEmployee(employeeId: string): string {
  return employeeOr404(employeeId).agency_id
}

export function enrollFace(employeeId: string, image: File | null): EmployeeFace {
  const employee = employeeOr404(employeeId)
  if (!employee.is_active) {
    throw new ApiError('http', "Impossible d'enroler un employe inactif", 422)
  }
  if (!image || !image.type.startsWith('image/')) {
    throw new ApiError('http', 'Le fichier doit etre une image', 422)
  }
  if (image.size > MAX_BYTES) throw new ApiError('http', 'Image trop volumineuse', 413)
  if (image.size === 0) throw new ApiError('http', 'Image vide', 422)
  const count = (seed().get(employeeId) ?? 0) + 1
  seed().set(employeeId, count)
  return toFace(employeeId, count)
}

export function deleteFace(employeeId: string): void {
  employeeOr404(employeeId)
  seed().delete(employeeId)
}

/** Tests only - module state would otherwise leak between them. */
export function resetFaceStore(): void {
  gallery = null
}
