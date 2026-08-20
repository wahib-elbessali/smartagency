import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
  updateUserAccess,
} from '@/api/endpoints/users'
import { fetchAgencies } from '@/api/endpoints/agencies'
import { fetchEmployees } from '@/api/endpoints/employees'
import { ApiError, describeApiError } from '@/api/errors'
import { type Role, type UserAccount, type UserCreate } from '@/api/types'
import { useSession } from '@/auth/SessionContext'
import { ASSIGNABLE_ROLES } from '@/auth/access'
import { accessChange } from '@/auth/screens'
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
 * Role and agency are changed inline rather than in the edit dialog, because
 * PUT accepts neither and each has a side effect: promoting to ADMIN clears the
 * agency, and moving the agency moves the linked employee with it.
 *
 * Both controls go through PATCH /access, which sets the pair in one call and
 * validates the result rather than the current state.
 *
 * ONE ADMIN DOES NOT ADMINISTER ANOTHER. An admin owns the system: their role
 * is not changed here on any row, and another admin's account cannot be edited
 * or deleted from this screen either. What is left on a peer admin's row is the
 * fact of it - name, email, and the Global badge.
 *
 * Both rules come from testing (2026-08-20), neither is derivable from the API,
 * and both are stricter than the backend - which commits the demotion happily
 * and lets any admin edit or delete any account except their own. See
 * roleLockReason.
 *
 * It also means this screen no longer uses the ability PR #75 added for issue
 * #71 - moving an admin to another role. The route is still the right one for
 * every other account, because role and agency have to move together, but the
 * branch dialog that #75 needed is gone: nothing can open it any more.
 */

const ROLE_TONE: Record<Role, Tone> = {
  ADMIN: 'danger',
  MANAGER: 'info',
  SECURITY: 'warn',
  AGENT: 'neutral',
  TECHNICIAN: 'neutral',
}

/**
 * Why this account's role cannot be changed here, or null if it can.
 *
 * Every ADMIN row answers with a reason. Reported from testing (2026-08-20):
 * an admin can change roles, but nobody changes an admin's - they own the whole
 * system, and the role control was quietly turning one into a MANAGER in the
 * database. The two wordings differ only because "your own account" is the more
 * useful sentence when the row is yours.
 *
 * Every route under /api/users is ADMIN-only, which is what makes this the one
 * change on the screen with no way back: a demoted admin cannot promote anyone,
 * themselves included, and if they were the last one, account administration
 * leaves the dashboard for good - it returns through a database edit or
 * backend/seed_dev.py, and nothing in the UI.
 *
 * This guards the CONTROL, not the API. PATCH /api/users/{id}/access still
 * performs the demotion for anything calling it directly - Swagger at /docs,
 * curl - because the backend validates only the role/agency pair and has no
 * check of its own. That half is the backend owner's to add.
 */
function roleLockReason(account: UserAccount, selfId: string | undefined): string | null {
  if (account.role !== 'ADMIN') return null
  if (account.id === selfId) {
    return 'This is your own account. An admin owns the whole system, so this role is not changed from here - and moving it would end your access to this screen with nothing left to give it back.'
  }
  return 'An admin owns the whole system, so their role is not changed from here. Delete the account if it should no longer exist.'
}

export interface RoleChange {
  account: UserAccount
  role: Role
}

/**
 * What a role change is about to do, in the words of the thing it does it to.
 *
 * Named screens rather than a general warning: "they will lose access to some
 * things" is a sentence people click past, and "they lose User accounts and
 * Agencies" is one they can check against what they meant. The lists come from
 * the same table the navigation is built from (auth/screens.ts), so this cannot
 * describe an app that does not exist.
 */
function RoleChangeConfirmation({
  change,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  change: RoleChange
  pending: boolean
  error: unknown
  onCancel: () => void
  onConfirm: () => void
}) {
  const { account, role } = change
  const { gained, lost } = accessChange(account.role, role)

  return (
    <div className="space-y-4">
      <div className="border-line bg-panel-2 rounded-lg border p-3.5 text-sm leading-relaxed">
        {/* No article before the role. "a ADMIN" is wrong, "an ADMIN" and "a
            SECURITY" cannot both come from one rule, and the role names are
            shouted constants rather than English nouns - so the sentence is
            built to not need one. */}
        <p className="text-ink font-medium">
          {account.full_name}&rsquo;s role becomes {role}.
        </p>
        {/* Every role this dialog can reach keeps the branch it has: ADMIN is
            the only one whose agency moves, and it is neither a role you can
            arrive at here nor one you can leave. */}
        <p className="text-ink-2 mt-1">They stay in the same branch.</p>
      </div>

      {(gained.length > 0 || lost.length > 0) && (
        <dl className="space-y-2 text-sm">
          {gained.length > 0 && (
            <div className="flex gap-2">
              <dt className="text-ok shrink-0 font-medium">Gains</dt>
              <dd className="text-ink-2">{gained.join(', ')}</dd>
            </div>
          )}
          {lost.length > 0 && (
            <div className="flex gap-2">
              <dt className="text-warn shrink-0 font-medium">Loses</dt>
              <dd className="text-ink-2">{lost.join(', ')}</dd>
            </div>
          )}
        </dl>
      )}

      {error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn rounded-lg border p-3 text-sm"
        >
          {inlineErrorMessage(error)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={pending} onClick={onConfirm}>
          {pending ? 'Changing…' : `Change to ${role}`}
        </Button>
      </div>
    </div>
  )
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
  const isAdmin = user?.role === 'ADMIN'
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
  /* Chosen from a dropdown, not yet sent. See pickRole. */
  const [confirmingRole, setConfirmingRole] = useState<RoleChange | null>(null)

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

  /* One route for both controls. Each sends the pair it wants to end up with,
     which is exactly what /access validates. */
  const changeAccess = useMutation({
    mutationFn: ({ id, role, agencyId }: { id: string; role: Role; agencyId: string | null }) =>
      updateUserAccess(id, role, agencyId),
    onSuccess: async () => {
      await refresh()
      setConfirmingRole(null)
    },
  })

  const remove = useMutation({
    mutationFn: (account: UserAccount) => deleteUser(account.id),
    onSuccess: async () => {
      await refresh()
      setConfirmingDelete(null)
    },
  })

  const rows = useMemo(() => users.data ?? [], [users.data])

  /**
   * Picking a role ASKS. It does not send anything.
   *
   * A role change is the widest-reaching edit on this screen - it decides which
   * screens someone can open at all - and it used to happen on the way past,
   * from a dropdown, with no step between choosing and committing. Asked for on
   * 2026-08-20 after the demotion that started all this.
   *
   * The dropdown returns to its old value while the dialog is open, because it
   * has not changed anything yet and a control showing the new role would say
   * otherwise. Cancelling therefore needs no undo.
   */
  function pickRole(account: UserAccount, role: Role) {
    if (role === account.role) return
    /* A locked row renders as text rather than a control, so reaching this at
       all means the list moved underneath the click. Checked again because the
       consequence is a lockout rather than a refetch. */
    if (roleLockReason(account, user?.id) !== null) return

    setConfirmingRole({ account, role })
  }

  /**
   * Sends the change the dialog just described.
   *
   * Two cases now that an admin's role is fixed:
   *   -> ADMIN            the agency must become null
   *   -> anything else     they already have an agency, so keep it
   *
   * There is no third case. An account with no agency is an ADMIN - that is the
   * invariant - and an ADMIN never reaches here.
   */
  function commitRole({ account, role }: RoleChange) {
    changeAccess.mutate({
      id: account.id,
      role,
      agencyId: role === 'ADMIN' ? null : account.agency_id,
    })
  }

  const formOpen = creating || editing !== null
  const inlineError = inlineErrorMessage(changeAccess.error)

  return (
    <Screen
      title="User accounts"
      description="Who can sign in, what they may reach, and which employee they are."
      actions={
        /* Hidden for anyone else, the way Agencies hides create and delete.
           POST /api/users is ADMIN-only like the rest of the router, so a
           manager reaching this screen meets the refusal state below - and an
           Add button sitting above that refusal is an offer the API will not
           honour, on the one screen where the boundary is the whole point. */
        isAdmin ? (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add account
          </Button>
        ) : undefined
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
                  <tr className="text-ink-3 tracked border-line/70 border-b text-left text-[10px] font-medium">
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
                    /* An admin has no agency by definition, so there is no
                       agency to pick from here - the role control moves them,
                       and asks for a branch on the way out. */
                    const isAdminRow = account.role === 'ADMIN'
                    const lockReason = roleLockReason(account, user?.id)

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
                          <div className="flex items-center gap-2">
                            {lockReason !== null ? (
                              /* Text, not a disabled dropdown - the same choice
                                 the agency cell makes below. A greyed-out select
                                 still says "this is a value you set here, just
                                 not now", and someone will keep clicking it.
                                 The reason sits in the row instead. */
                              <span
                                className="text-ink text-xs font-medium"
                                title={lockReason}
                                data-testid={`role-locked-${account.id}`}
                              >
                                {account.role}
                              </span>
                            ) : (
                              <select
                                aria-label={`Role for ${account.full_name}`}
                                className="border-line bg-panel-2 text-ink rounded-lg border px-2 py-1 text-xs"
                                value={account.role}
                                disabled={changeAccess.isPending}
                                onChange={(e) => pickRole(account, e.target.value as Role)}
                              >
                                {ASSIGNABLE_ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </select>
                            )}
                            {/* Colour alone would not carry this, and ADMIN is
                                the one role worth spotting at a glance. */}
                            {isAdminRow && <Badge tone={ROLE_TONE.ADMIN}>Global</Badge>}
                          </div>
                          {/* Spelled out under the row rather than left to a
                              tooltip: this is the one control on the screen
                              that is missing on purpose, and "why can I not
                              change this" is otherwise unanswerable without
                              hovering something that looks like plain text. */}
                          {lockReason !== null && (
                            <p className="text-ink-3 mt-1 max-w-[22rem] text-[11px] leading-relaxed">
                              {lockReason}
                            </p>
                          )}
                        </td>

                        <td className="px-5 py-3">
                          {isAdminRow ? (
                            /* Not a disabled control: an admin has no agency to
                               show, and offering one would suggest a value could
                               be set here. Changing the role is what moves them. */
                            <span
                              className="text-ink-3 text-xs"
                              title="An admin is global. Change the role to place them in a branch."
                            >
                              No branch
                            </span>
                          ) : (
                            <select
                              aria-label={`Agency for ${account.full_name}`}
                              className="border-line bg-panel-2 text-ink rounded-lg border px-2 py-1 text-xs"
                              value={account.agency_id ?? ''}
                              disabled={changeAccess.isPending}
                              /* Role stays as it is; only the agency half moves. */
                              onChange={(e) =>
                                changeAccess.mutate({
                                  id: account.id,
                                  role: account.role,
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
                            {/* One admin does not administer another. Their own
                                row keeps Edit - a name, an email and a password
                                are yours to change - and every other control on
                                an admin row is gone: no role, no branch, no
                                edit, no delete. Asked for on 2026-08-20, and
                                stricter than the API, which lets an admin edit
                                and delete any account but their own. */}
                            {(!isAdminRow || isSelf) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditing(account)}
                                aria-label={`Edit ${account.full_name}`}
                              >
                                <Pencil className="size-3.5" aria-hidden />
                              </Button>
                            )}
                            {/* Hidden for another admin, disabled for yourself.
                                The difference is deliberate: deleting yourself
                                is a thing you might reasonably try, and the
                                disabled control with its reason answers it -
                                where deleting a peer admin is not on offer at
                                all. */}
                            {isAdminRow && !isSelf ? null : (
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
                            )}
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
        open={confirmingRole !== null}
        title="Change this role?"
        onClose={() => {
          setConfirmingRole(null)
          changeAccess.reset()
        }}
      >
        {confirmingRole && (
          <RoleChangeConfirmation
            change={confirmingRole}
            pending={changeAccess.isPending}
            error={changeAccess.error}
            onCancel={() => {
              setConfirmingRole(null)
              changeAccess.reset()
            }}
            onConfirm={() => commitRole(confirmingRole)}
          />
        )}
      </Dialog>

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
