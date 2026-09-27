import { registerMock, registerMockWriter } from '../registry'
import type { EmployeeFace } from '@/api/types'
import { ApiError } from '@/api/errors'
import { requestUser } from '../currentUser'
import * as store from '../faceStore'

/**
 * GET /api/employees/faces, POST|DELETE /api/employees/{id}/face -
 * backend/app/api/face_recognition.py. A MANAGER reads their own agency's
 * enrolled employees and is refused (403) any other agency's employee; an
 * ADMIN sees everyone. Roles (ADMIN, MANAGER) are the /api/employees rule in
 * mocks/roles.ts, which these paths already fall under.
 */

function managerAgency(): string | null {
  const user = requestUser()
  return user && user.role !== 'ADMIN' ? user.agency_id : null
}

function employeeIdFrom(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 2] ?? ''
}

function ensureEmployeeScope(employeeId: string): void {
  const own = managerAgency()
  if (own !== null && store.agencyOfEmployee(employeeId) !== own) {
    throw new ApiError('http', 'Acces limite a votre agence', 403)
  }
}

registerMock<EmployeeFace[]>('GET /api/employees/faces', {
  normal: () => store.listFaces(managerAgency()),
  empty: () => [],
  large: () => store.listFaces(managerAgency()),
})

registerMockWriter('POST /api/employees/{id}/face', (body, path) => {
  const employeeId = employeeIdFrom(path)
  ensureEmployeeScope(employeeId)
  const image = (body as FormData).get('image')
  return store.enrollFace(employeeId, image instanceof File ? image : null)
})

registerMockWriter('DELETE /api/employees/{id}/face', (_body, path) => {
  const employeeId = employeeIdFrom(path)
  ensureEmployeeScope(employeeId)
  store.deleteFace(employeeId)
  return undefined
})
