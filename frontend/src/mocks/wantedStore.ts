import type {
  WantedDeleted,
  WantedPerson,
  WantedThreshold,
  WantedThresholdUpdate,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { AGENCY_ID } from './fixtures/people'

/**
 * The watchlist and its threshold, for mock mode - backend/app/api/wanted.py
 * in front of the AI service's /wanted, with the refusals of both:
 *
 *   422  a name outside 1-80 of [A-Za-z0-9 ._+-], or a file that is not an image
 *   413  a photo over 10 MB
 *   409  a name already on the list (the AI gallery is one for the site)
 *   404  removing a name the caller's agency does not own
 *   422  a threshold outside [0.25, 1] or a face size outside [16, 1000]
 *
 * The seeded person is the one the scripted wanted stream flags
 * (aiStreams.ts), so the Alerts screen and this list describe the same site.
 *
 * The threshold answer is the gateway's full model on PUT too. The real
 * gateway would 502 there today (the AI service's PUT answer is missing
 * fields the model requires); reproducing a bug would only hide the screen's
 * real behaviour, so it is raised with backend instead.
 */

const NAME_RE = /^[A-Za-z0-9 ._+-]{1,80}$/
const MAX_BYTES = 10 * 1024 * 1024
const STARTUP = { threshold: 0.5, min_face_px: 30 }
const FLOOR = 0.25

let people: WantedPerson[] | null = null
let config = { ...STARTUP }
let counter = 0

function seed(): WantedPerson[] {
  if (people === null) {
    people = [
      {
        id: 'w1000000-0000-4000-8000-000000000001',
        agency_id: AGENCY_ID,
        name: 'MAROUANE-B-2024-114',
        embeddings_count: 2,
        created_at: '2026-09-20T09:15:00Z',
      },
    ]
  }
  return people
}

/** Everyone for an ADMIN (agencyId null), one agency's otherwise. */
export function listWatchlist(agencyId: string | null): WantedPerson[] {
  return seed()
    .filter((person) => agencyId === null || person.agency_id === agencyId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => ({ ...person }))
}

export function addToWatchlist(
  agencyId: string,
  rawName: string,
  image: File | null,
): WantedPerson {
  const name = rawName.trim()
  if (!NAME_RE.test(name)) {
    throw new ApiError(
      'http',
      'name doit contenir 1 a 80 caracteres alphanumeriques ou . _ + -',
      422,
    )
  }
  if (seed().some((person) => person.name === name)) {
    throw new ApiError('http', 'Cette personne est deja dans la liste', 409)
  }
  if (!image || !image.type.startsWith('image/')) {
    throw new ApiError('http', 'Le fichier doit etre une image', 422)
  }
  if (image.size > MAX_BYTES) throw new ApiError('http', 'Image trop volumineuse', 413)
  if (image.size === 0) throw new ApiError('http', 'Image vide', 422)

  counter += 1
  const person: WantedPerson = {
    id: `w-mock-${counter}`,
    agency_id: agencyId,
    name,
    embeddings_count: 1,
    created_at: new Date().toISOString(),
  }
  seed().push(person)
  return { ...person }
}

export function removeFromWatchlist(name: string, agencyId: string | null): WantedDeleted {
  const list = seed()
  const index = list.findIndex(
    (person) => person.name === name && (agencyId === null || person.agency_id === agencyId),
  )
  if (index === -1) throw new ApiError('http', 'Personne introuvable dans votre liste', 404)
  const [removed] = list.splice(index, 1)
  return { name, agency_id: removed.agency_id, embeddings_removed: removed.embeddings_count }
}

export function getThreshold(): WantedThreshold {
  const list = seed()
  return {
    ...config,
    startup_default: { ...STARTUP },
    floor: FLOOR,
    watchlist_size: list.length,
    embeddings_total: list.reduce((sum, person) => sum + person.embeddings_count, 0),
    applies_within_seconds: 2,
    warnings: [],
  }
}

export function setThreshold(body: WantedThresholdUpdate): WantedThreshold {
  if (body.threshold == null && body.min_face_px == null) {
    throw new ApiError('http', 'threshold ou min_face_px est obligatoire', 422)
  }
  const warnings: string[] = []
  if (body.threshold != null) {
    if (body.threshold < FLOOR || body.threshold > 1) {
      throw new ApiError(
        'http',
        `threshold must be in [${FLOOR}, 1.0] -- below that, open-set matching false-alarms constantly`,
        422,
      )
    }
    if (body.threshold < STARTUP.threshold) {
      warnings.push(
        `${body.threshold} is below the measured default ${STARTUP.threshold}, raising the false-accusation rate`,
      )
    }
  }
  if (body.min_face_px != null && (body.min_face_px < 16 || body.min_face_px > 1000)) {
    throw new ApiError('http', 'min_face_px must be in [16, 1000]', 422)
  }
  const previous = { ...config }
  config = {
    threshold: body.threshold ?? config.threshold,
    min_face_px: body.min_face_px ?? config.min_face_px,
  }
  return { ...getThreshold(), previous, warnings }
}

/** Tests only - module state would otherwise leak between them. */
export function resetWantedStore(): void {
  people = null
  config = { ...STARTUP }
  counter = 0
}
