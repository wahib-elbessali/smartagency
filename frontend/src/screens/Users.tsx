import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
  updateUserAgency,
  updateUserRole,
} from '@/api/endpoints/users'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchEmployees } from '@/api/endpoints/employees'
import { ApiError, describeApiError } from '@/api/errors'
import { ROLES, type Role, type UserAccount, type UserCreate } from '@/api/types'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { UserForm } from './UserForm'
import { Screen } from './Screen'

/**
 * User account administration. ADMIN only - the entire /api/users router is,
 * so a MANAGER who can administer employees still gets a 403 here and sees the
 * refusal state rather than an error.
 *
 * An account is only a login. The person, their card and their attendance
 * history are the employee record, which is why employees come first and why
 * an account can exist with nothing linked to it.
 *
 * Role and agency are changed inline, one control per request, because the
 * backend gives each its own PATCH route and each has a side effect: promoting
 * to ADMIN clears the agency, and moving the agency moves the linked employee
 * with it. Rolling them into the edit dialog would mean firing three writes on
 * one Save and leaving an account half-changed when the second failed.
 */

const ROLE_TONE: Record<Role, Tone> = {
  ADMIN: 'danger',
  MANAGER: 'info',
  SECURITY: 'warn',
  AGENT: 'neutral',
  TECHNICIAN: 'neutral',
}

/** Maps the refusals the two PATCH routes can produce. */
function inlineErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'Could not apply that change.'
  if (error.status === 422) {
    return 'Rejected: an admin must have no agency, and every other role must have one.'
  }
  return describeApiError(error)
}

function deleteErrorMessage(error: unknown): string | null {
  if (error == null) return null
  if (!(error instanceof ApiError)) return 'Could not delete.'
  /* "Un ADMIN ne peut pas supprimer son propre compte" - the row's own button
     is disabled, so this is the backstop for a stale session, not the path. */
  if (error.status === 400) return 'You cannot delete your own account.'
  return describeApiError(error)
}

export default function Users() {
  const { user } = useSession()
  const queryClient = useQueryClient()

  const users = useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => fetchUsers(signal),
  })

  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
  })

  /* Only for the optional employee link in the create form. */
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => fetchEmployees(signal),
  })

  const [editing, setEditing] = useState<UserAccount | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<UserAccount | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const closeForm = () => {
    setCreating(false)
    setEditing(null)
    save.reset()
  }

  const save = useMutation({
    mutationFn: (values: UserCreate) => {
      if (!editing) return createUser(values)

      /* PUT accepts neither role nor agency, so they are dropped rather than
         sent and ignored. An empty password box means "leave it alone", which
         is an omitted key - sending "" would be a 422 on min_length=8. */
      return updateUser(editing.id, {
        full_name: values.full_name,
        email: values.email,
        ...(values.password === '' ? {} : { password: values.password }),
        employee_id: values.employee_id ?? null,
      })
    },
    onSuccess: async () => {
      await refresh()
      closeForm()
    },
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => updateUserRole(id, role),
    onSuccess: refresh,
  })

  const changeAgency = useMutation({
    mutationFn: ({ id, agencyId }: { id: string; agencyId: string | null }) =>
      updateUserAgency(id, agencyId),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (account: UserAccount) => deleteUser(account.id),
    onSuccess: async () => {
      await refresh()
      setConfirmingDelete(null)
    },
  })

  const rows = useMemo(() => users.data ?? [], [users.data])
  const formOpen = creating || editing !== null
  const inlineError = inlineErrorMessage(changeRole.error ?? changeAgency.error)

  return (
    <Screen
      title="User accounts"
      description="Who can sign in, what they may reach, and which employee they are."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" aria-hidden />
          Add account
        </Button>
      }
    >
      <AsyncBoundary
        isPending={users.isPending}
        error={users.error}
        isEmpty={rows.length === 0}
        emptyMessage="No accounts yet."
        forbiddenMessage="User accounts are managed by administrators only. Ask an administrator if you need access."
        onRetry={() => void users.refetch()}
        skeletonRows={6}
      >
        <Panel as="section">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink text-sm font-semibold">All accounts</h2>
              <span className="text-ink-3 tabular text-xs">
                {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
              </span>
            </div>
          </PanelHeader>

          {inlineError && (
            <div className="border-line border-b px-5 py-3">
              <p role="alert" className="text-warn text-sm">
                {inlineError}
              </p>
            </div>
          )}

          <PanelBody className="px-0 py-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  User accounts, with their role, agency and linked employee
                </caption>
                <thead>
                  <tr className="text-ink-3 border-line border-b text-left text-xs">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Account
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Role
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Agency
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Employee
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((account) => {
                    const isSelf = account.id === user?.id
                    /* An ADMIN cannot be moved to any other role, and cannot be
                       given an agency either: PATCH /role validates the new role
                       against their existing (null) agency, and PATCH /agency
                       validates a new agency against their existing (ADMIN)
                       role. There is no order that works, so both controls are
                       locked rather than offering an action that always 422s. */
                    const locked = account.role === 'ADMIN'

                    return (
                      <tr
                        key={account.id}
                        className="border-line/70 hover:bg-panel-2/60 ease-soft border-b transition-colors duration-150 last:border-b-0"
                      >
                        <th scope="row" className="px-5 py-3 text-left font-normal">
                          <div className="flex items-center gap-3">
                            <Avatar name={account.full_name} />
                            <div className="min-w-0">
                              <div className="text-ink flex items-center gap-2 truncate font-medium">
                                {account.full_name}
                                {isSelf && (
                                  <span className="text-ink-3 text-xs font-normal">(you)</span>
                                )}
                              </div>
                              <div className="text-ink-3 truncate text-xs">{account.email}</div>
                            </div>
                          </div>
                        </th>

                        <td className="px-5 py-3">
                          {locked ? (
                            <Badge tone={ROLE_TONE.ADMIN}>ADMIN</Badge>
                          ) : (
                            <select
                              aria-label={`Role for ${account.full_name}`}
                              className="border-line bg-panel-2 text-ink rounded-lg border px-2 py-1 text-xs"
                              value={account.role}
                              disabled={changeRole.isPending}
                              onChange={(e) =>
                                changeRole.mutate({ id: account.id, role: e.target.value as Role })
                              }
                            >
                              {ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        <td className="px-5 py-3">
                          {locked ? (
                            <span
                              className="text-ink-3 text-xs"
                              title="An admin is global. Assigning an agency is rejected."
                            >
                              Global
                            </span>
                          ) : (
                            <select
                              aria-label={`Agency for ${account.full_name}`}
                              className="border-line bg-panel-2 text-ink rounded-lg border px-2 py-1 text-xs"
                              value={account.agency_id ?? ''}
                              disabled={changeAgency.isPending}
                              onChange={(e) =>
                                changeAgency.mutate({
                                  id: account.id,
                                  agencyId: e.target.value === '' ? null : e.target.value,
                                })
                              }
                            >
                              {(agencies.data ?? []).map((agency) => (
                                <option key={agency.id} value={agency.id}>
                                  {agency.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        <td className="text-ink-2 px-5 py-3">
                          {account.employee ? (
                            <span>
                              {account.employee.first_name} {account.employee.last_name}
                            </span>
                          ) : (
                            <span className="text-ink-3" title="This login is not tied to a person">
                              Not linked
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(account)}
                              aria-label={`Edit ${account.full_name}`}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isSelf}
                              title={isSelf ? 'You cannot delete your own account' : undefined}
                              onClick={() => setConfirmingDelete(account)}
                              aria-label={`Delete ${account.full_name}`}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </PanelBody>
        </Panel>
      </AsyncBoundary>

      <Dialog
        open={formOpen}
        title={editing ? 'Edit account' : 'Add account'}
        description={
          editing
            ? 'Role and agency are changed from the table, one at a time.'
            : 'An account is a login. Link it to an employee to connect it to a card.'
        }
        onClose={closeForm}
      >
        {formOpen && (
          <UserForm
            user={editing}
            agencies={agencies.data ?? []}
            employees={employees.data ?? []}
            pending={save.isPending}
            error={save.error}
            onCancel={closeForm}
            onSubmit={(values) => save.mutate(values)}
          />
        )}
      </Dialog>

      <Dialog
        open={confirmingDelete !== null}
        title="Delete this account?"
        onClose={() => {
          setConfirmingDelete(null)
          remove.reset()
        }}
      >
        {confirmingDelete && (
          <div>
            {/* Unlike an employee, this destroys no history. Saying so is the
                point: the two confirmations look alike and mean very different
                things, and overstating this one teaches people to click past
                the one that matters. */}
            <div className="border-line bg-panel-2 flex gap-3 rounded-lg border p-3.5">
              <AlertTriangle className="text-ink-3 mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="text-sm leading-relaxed">
                <p className="text-ink font-medium">
                  {confirmingDelete.full_name} will no longer be able to sign in.
                </p>
                <p className="text-ink-2 mt-1">
                  {confirmingDelete.employee
                    ? `Their employee record (${confirmingDelete.employee.first_name} ${confirmingDelete.employee.last_name}) and its attendance history are not touched, and their card keeps working.`
                    : 'No employee record is linked, so nothing else changes.'}
                </p>
              </div>
            </div>

            {remove.error !== null && (
              <p
                role="alert"
                className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
              >
                {deleteErrorMessage(remove.error)}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setConfirmingDelete(null)
                  remove.reset()
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(confirmingDelete)}
              >
                {remove.isPending ? 'Deleting…' : 'Delete account'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Screen>
  )
}
