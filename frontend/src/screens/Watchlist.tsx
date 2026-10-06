import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ScanFace, Trash2 } from 'lucide-react'
import { fetchAgencies } from '@/api/endpoints/agencies'
import {
  addToWatchlist,
  fetchWantedThreshold,
  fetchWatchlist,
  removeFromWatchlist,
  setWantedThreshold,
} from '@/api/endpoints/watchlist'
import { ApiError, describeApiError } from '@/api/errors'
import type { WantedPerson, WantedThresholdUpdate } from '@/api/types'
import { useSession } from '@/auth/SessionContext'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { PhotoField, photoError } from '@/components/PhotoField'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel'
import { Screen } from './Screen'

/**
 * Who the wanted-person detector is looking for, and how sure it has to be.
 * Added 2026-09-27 on backend/app/api/wanted.py (see api/endpoints/watchlist.ts).
 *
 * WHY IT EXISTS. The Alerts screen already shows a watchlist hit, face photo
 * and all, but nothing in the dashboard could say who is ON the list. This
 * is that list: add a person with one photo, see who is on it, take them
 * off. A separate gallery from employee face enrollment, deliberately, so a
 * member of staff and a wanted person can never be mixed up.
 *
 * WHAT IT DOES NOT SHOW. No photo, ever: the backend never returns one, and
 * a wall of wanted faces on a dashboard is not something to build by
 * accident. The list is names, how many photos each has, and when they were
 * added. Every read and change is audited by the backend.
 *
 * ONE PHOTO PER NAME, FROM HERE. The gateway refuses a name already on the
 * list (409), so "add another photo for the same person" is not possible
 * through it; the dialog says so rather than offering it.
 *
 * THE THRESHOLD IS A SIMILARITY, NOT A PERCENTAGE. The score a face has to
 * reach against a watchlist photo, in the AI service's own unit - shown as
 * the number it is, the same way the Alerts screen renders a hit as
 * "similarity 0.61". Lowering it below the service's measured default is
 * allowed and comes back with a warning about false accusations, which is
 * shown. A change applies on the next detection cycle, not instantly, and
 * the AI service forgets it on restart - both said on screen.
 *
 * Roles: SECURITY reads the list and the threshold; changing either is
 * ADMIN and MANAGER. A MANAGER's list is their own agency's.
 */
export default function Watchlist() {
  const { user } = useSession()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'
  const canEdit = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const people = useQuery({
    queryKey: ['watchlist'],
    queryFn: ({ signal }) => fetchWatchlist(signal),
  })
  const agencies = useQuery({
    queryKey: ['agencies'],
    queryFn: ({ signal }) => fetchAgencies(signal),
    enabled: isAdmin,
  })
  const agencyName = useMemo(
    () => new Map((agencies.data ?? []).map((agency) => [agency.id, agency.name])),
    [agencies.data],
  )

  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<WantedPerson | null>(null)

  const add = useMutation({
    mutationFn: (entry: { name: string; image: File; agencyId: string | null }) =>
      addToWatchlist(entry),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      await queryClient.invalidateQueries({ queryKey: ['wantedThreshold'] })
      setAdding(false)
    },
  })
  const remove = useMutation({
    mutationFn: (person: WantedPerson) => removeFromWatchlist(person.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      await queryClient.invalidateQueries({ queryKey: ['wantedThreshold'] })
      setRemoving(null)
    },
  })

  const rows = people.data ?? []

  return (
    <Screen
      title="Watchlist"
      description="The people the wanted-person detector looks for, and how close a match has to be."
      actions={
        canEdit && (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add person
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Panel as="section">
          <PanelHeader>
            <h2 className="text-ink text-sm font-semibold">On the list</h2>
            <p className="text-ink-3 mt-1 text-xs">
              Names only. Photos are enrolled into the detector and never shown here.
            </p>
          </PanelHeader>
          <AsyncBoundary
            isPending={people.isPending}
            error={people.error}
            isEmpty={rows.length === 0}
            emptyMessage="Nobody is on the watchlist. The detector has no one to look for."
            forbiddenMessage="The watchlist is for administrators, managers and security."
            onRetry={() => void people.refetch()}
            skeletonRows={3}
          >
            <PanelBody>
              <ul className="space-y-2">
                {rows.map((person) => (
                  <li
                    key={person.id}
                    className="border-line bg-panel-2 flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <ScanFace className="text-ink-3 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink truncate text-sm font-medium">{person.name}</p>
                      <p className="text-ink-3 text-xs">
                        {person.embeddings_count} photo{person.embeddings_count === 1 ? '' : 's'} ·
                        added{' '}
                        {new Date(person.created_at).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {isAdmin && agencyName.get(person.agency_id)
                          ? ` · ${agencyName.get(person.agency_id)}`
                          : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${person.name}`}
                        onClick={() => setRemoving(person)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </PanelBody>
          </AsyncBoundary>
        </Panel>

        <ThresholdPanel canEdit={canEdit} />
      </div>

      <Dialog
        open={adding}
        title="Add to the watchlist"
        description="One clear photo showing exactly one face."
        onClose={() => {
          setAdding(false)
          add.reset()
        }}
      >
        {adding && (
          <AddForm
            isAdmin={isAdmin}
            agencies={agencies.data ?? []}
            takenNames={new Set(rows.map((person) => person.name))}
            pending={add.isPending}
            error={add.error}
            onCancel={() => {
              setAdding(false)
              add.reset()
            }}
            onSubmit={(values) => add.mutate(values)}
          />
        )}
      </Dialog>

      <Dialog
        open={removing !== null}
        title="Remove from the watchlist"
        description="The detector stops looking for this person straight away."
        onClose={() => {
          setRemoving(null)
          remove.reset()
        }}
      >
        {removing && (
          <div>
            <p className="text-ink-2 text-sm leading-relaxed">
              <span className="text-ink font-medium">{removing.name}</span> and all{' '}
              {removing.embeddings_count} of their enrolled photo
              {removing.embeddings_count === 1 ? '' : 's'} will be removed. There is no removing
              just one photo.
            </p>
            {remove.error != null && (
              <p
                role="alert"
                className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
              >
                {remove.error instanceof ApiError
                  ? describeApiError(remove.error)
                  : 'Could not remove this person.'}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setRemoving(null)}>Keep</Button>
              <Button
                variant="primary"
                disabled={remove.isPending}
                onClick={() => remove.mutate(removing)}
              >
                {remove.isPending ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Screen>
  )
}

const NAME_RE = /^[A-Za-z0-9 ._+-]{1,80}$/

function nameError(name: string, taken: Set<string>): string | undefined {
  const trimmed = name.trim()
  if (trimmed.length === 0) return undefined
  if (!NAME_RE.test(trimmed)) return 'Letters, digits, spaces and . _ + - only, up to 80.'
  if (taken.has(trimmed)) return 'Already on the list. A second photo cannot be added from here.'
  return undefined
}

function AddForm({
  isAdmin,
  agencies,
  takenNames,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  isAdmin: boolean
  agencies: Array<{ id: string; name: string }>
  takenNames: Set<string>
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (values: { name: string; image: File; agencyId: string | null }) => void
}) {
  const [name, setName] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? '')
  const invalidName = nameError(name, takenNames)
  const ready =
    name.trim().length > 0 &&
    !invalidName &&
    image !== null &&
    !photoError(image) &&
    (!isAdmin || agencyId !== '')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !image) return
    onSubmit({ name: name.trim(), image, agencyId: isAdmin ? agencyId : null })
  }

  return (
    <form onSubmit={submit}>
      <div className="space-y-4">
        <Field
          id="wanted_name"
          label="Name or reference"
          required
          error={invalidName}
          hint="How an alert will name them — a case reference works as well as a name."
        >
          {(props) => (
            <input
              {...props}
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>

        {isAdmin && (
          <Field id="wanted_agency" label="Branch" required hint="The branch that owns this entry.">
            {(props) => (
              <select {...props} value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <PhotoField
          id="wanted_photo"
          label="Photo"
          required
          file={image}
          onChange={setImage}
          hint="One face, clearly visible. Up to 10 MB."
        />
      </div>

      {error != null && (
        <p
          role="alert"
          className="border-warn/30 bg-warn/8 text-warn mt-4 rounded-lg border p-3 text-sm"
        >
          {error instanceof ApiError
            ? error.status === 409
              ? 'That name is already on the watchlist, possibly from another branch.'
              : describeApiError(error)
            : 'Could not add this person.'}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready || pending}>
          {pending ? 'Adding…' : 'Add to watchlist'}
        </Button>
      </div>
    </form>
  )
}

/**
 * The match threshold and minimum face size. Same "draft is null until
 * typed" pattern as the weapon threshold on the Cameras screen, so Save has
 * nothing to do until something changed.
 */
function ThresholdPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const threshold = useQuery({
    queryKey: ['wantedThreshold'],
    queryFn: ({ signal }) => fetchWantedThreshold(signal),
  })
  const [draftThreshold, setDraftThreshold] = useState<string | null>(null)
  const [draftFace, setDraftFace] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const save = useMutation({
    mutationFn: (body: WantedThresholdUpdate) => setWantedThreshold(body),
    onSuccess: async (saved) => {
      setWarnings(saved.warnings ?? [])
      setDraftThreshold(null)
      setDraftFace(null)
      /* Read back with a GET - see setWantedThreshold. */
      await queryClient.invalidateQueries({ queryKey: ['wantedThreshold'] })
    },
  })

  const data = threshold.data
  const floor = data?.floor ?? 0.25
  const shownThreshold = draftThreshold ?? (data ? String(data.threshold) : '')
  const shownFace = draftFace ?? (data ? String(data.min_face_px) : '')

  const thresholdError = (() => {
    if (draftThreshold === null) return undefined
    const v = Number(draftThreshold)
    if (!Number.isFinite(v)) return 'Enter a number.'
    if (v < floor || v > 1) return `Between ${floor} and 1.`
    return undefined
  })()
  const faceError = (() => {
    if (draftFace === null) return undefined
    const v = Number(draftFace)
    if (!Number.isInteger(v)) return 'A whole number of pixels.'
    if (v < 16 || v > 1000) return 'Between 16 and 1000.'
    return undefined
  })()

  const body: WantedThresholdUpdate = {}
  if (draftThreshold !== null && Number(draftThreshold) !== data?.threshold) {
    body.threshold = Number(draftThreshold)
  }
  if (draftFace !== null && Number(draftFace) !== data?.min_face_px) {
    body.min_face_px = Number(draftFace)
  }
  const changed = Object.keys(body).length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!changed || thresholdError || faceError) return
    save.mutate(body)
  }

  return (
    <Panel as="section">
      <PanelHeader>
        <h2 className="text-ink text-sm font-semibold">How close a match has to be</h2>
        <p className="text-ink-3 mt-1 text-xs leading-relaxed">
          A similarity score, not a percentage. Higher means fewer, surer matches; lower catches
          more and accuses more wrongly. One value for the whole site.
        </p>
      </PanelHeader>
      <PanelBody>
        {threshold.isError ? (
          <p role="alert" className="text-warn text-sm">
            {threshold.error instanceof ApiError
              ? describeApiError(threshold.error)
              : 'Could not load the threshold.'}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field
              id="wanted_threshold"
              label="Match threshold"
              error={thresholdError}
              hint={
                data ? `Between ${floor} and 1. Default ${data.startup_default.threshold}.` : ''
              }
            >
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={floor}
                  max={1}
                  step={0.01}
                  inputMode="decimal"
                  value={shownThreshold}
                  disabled={!canEdit || threshold.isPending}
                  onChange={(e) => setDraftThreshold(e.target.value)}
                />
              )}
            </Field>
            <Field
              id="wanted_min_face"
              label="Smallest face, in pixels"
              error={faceError}
              hint={
                data
                  ? `Faces smaller than this are not matched at all. Default ${data.startup_default.min_face_px}.`
                  : ''
              }
            >
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={16}
                  max={1000}
                  step={1}
                  inputMode="numeric"
                  value={shownFace}
                  disabled={!canEdit || threshold.isPending}
                  onChange={(e) => setDraftFace(e.target.value)}
                />
              )}
            </Field>
            {canEdit && (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!changed || !!thresholdError || !!faceError || save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
            {save.error != null && (
              <p role="alert" className="text-warn text-sm">
                {save.error instanceof ApiError
                  ? describeApiError(save.error)
                  : 'Could not save the threshold.'}
              </p>
            )}
            {warnings.map((warning) => (
              <p
                key={warning}
                role="status"
                className="border-warn/30 bg-warn/8 text-warn rounded-lg border p-3 text-sm"
              >
                {warning}
              </p>
            ))}
          </form>
        )}
        {data && (
          <p className="text-ink-3 mt-3 text-xs leading-relaxed">
            {data.watchlist_size} {data.watchlist_size === 1 ? 'person' : 'people'},{' '}
            {data.embeddings_total} photo{data.embeddings_total === 1 ? '' : 's'} in the detector —
            more photos means more chances for any face to match wrongly. A change applies within{' '}
            {data.applies_within_seconds} s, and the detector goes back to its defaults if it
            restarts.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}
