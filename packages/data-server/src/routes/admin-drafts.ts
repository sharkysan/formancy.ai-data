import type { DriftReport, ReassignedKey } from '@formancy/data-core'
import type { HostIdentity } from '@formancy/data-identity'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { BundleV2 } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import { createDrafts, UnreadableDraftError } from '../drafts.js'
import type { Draft, DraftState } from '../drafts.js'
import { administrationOf, callerOf, draftRefuses, refusalFor } from '../governance.js'
import type { Caller, DraftRefuses } from '../governance.js'
import { FORM_ID } from '../published.js'
import { conflictOver } from '../publishing.js'
import type { Refusal } from '../publishing.js'
import { readKeysConfirmed } from '../reassigned.js'
import { adminTrail, draftOf } from './admin-audit.js'
import type { Discover, Refuse } from './admin.js'
import { gate } from './admin-gate.js'
import type { GateSentences } from './admin-gate.js'

/** What `POST /v1/forms/:id/drafts` answers: the draft's number, and the drift between its snapshot and the database that let it through. */
export interface DraftSubmission {
  draft: number
  state: 'pending'
  drift: DriftReport
}

/** One draft waiting in `GET /v1/drafts`, with what this caller may not do with it. */
export interface QueuedDraft {
  form: string
  draft: number
  expectedBase: number | null
  submittedBy: string
  title: string
  refuses: DraftRefuses
}

/**
 * What `GET /v1/drafts` answers: every pending draft, by form in codepoint
 * order and by number within a form -- the order they were submitted in;
 * an entry holds no time, so there is no order across forms to give -- and
 * the forms whose drafts cannot be read, which hide no other form's.
 */
export interface DraftQueue {
  drafts: QueuedDraft[]
  unreadable: string[]
}

/** What `GET /v1/forms/:id/drafts/:draft` answers. */
export interface DraftRead {
  form: string
  draft: number
  state: DraftState
  expectedBase: number | null
  submittedBy: string
  /** When a rejection names it: who rejected it, and whether that was its submitter withdrawing it. A published draft can carry one, written while its approval wrote the version (0065). */
  rejectedBy?: string
  withdrawn?: boolean
  keysConfirmed: ReassignedKey[]
  bundle: BundleV2
  /** The form's newest version now. */
  current: number | null
  refuses: DraftRefuses
}

/** What `POST …/approval` answers: the version written, and the drift that allowed it. */
export interface Approval {
  version: number
  drift: DriftReport
}

/** What `POST …/rejection` answers; `withdrawn` when the submitter took it back. */
export interface DraftRejection {
  draft: number
  state: 'rejected'
  withdrawn: boolean
}

interface ReviewOptions {
  store: ConfigurationStore
  /** The roles that publish, or `undefined`: no review, and the administration answer alone. */
  publisherRoles: ReadonlySet<string> | undefined
  /** The roles that browse (0099), or `undefined`: nobody. Read for the administration answer alone. */
  browseRoles: ReadonlySet<string> | undefined
  allowlisted: (connection: string) => boolean
  discover: Discover
  refuse: Refuse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The sentence a version keeps its connection's name in: true of a studio's draft and of an imported file, which the server cannot tell apart. */
const unknown = (name: string) => `No connection is called ${name} in this deployment: a version keeps its connection's name, which each deployment's allowlist resolves to its own database.`

const sentences = (cannot: string, failed: string): GateSentences => ({
  unknown,
  otherEngine: (connection, database, bound) => `${cannot}: connection ${connection} is a ${database} database here, and the version is bound to ${bound}. A form's bindings belong to one engine.`,
  incompatible: `${cannot}: the database differs from the one this version was generated from in a way it cannot serve.`,
  failed,
})

const SUBMIT = sentences('This draft cannot be submitted', 'a draft failed where it cannot')

const INTERNAL = "This could not be completed; the operator's log says why."

/** What a draft's base was, as a sentence says it. */
const over = (base: number | null) => (base === null ? 'as the first version' : `over version ${String(base)}`)

/**
 * Publication under review (0065), on the administrator plane: registered
 * by `adminRoutes` after its role check and its governance gate, so both
 * cover every route here.
 *
 * `GET /v1/administration` is always registered, and says whether the
 * deployment reviews and what this caller may not do. The draft routes are
 * registered only under review: without it they are not routes, and the
 * router answers 404. A submit runs what an approval runs short of the
 * four eyes and the write, and an approval runs it all again against the
 * database as it is then (`gate`).
 */
export function reviewRoutes(app: FastifyInstance, options: ReviewOptions): void {
  const { store, publisherRoles, refuse } = options
  const review = publisherRoles !== undefined
  // The preHandler set it before any handler runs, refusing a request without one.
  const caller = (request: FastifyRequest): Caller => callerOf(request.identity as HostIdentity, publisherRoles, options.browseRoles)
  const send = (reply: FastifyReply, refusal: Refusal) => refuse(reply, refusal.status, refusal.code, refusal.message, refusal.extra)

  app.get('/v1/administration', async (request) => administrationOf(caller(request), review))

  if (!review) return
  const drafts = createDrafts(store)
  const steps = { store, allowlisted: options.allowlisted, discover: options.discover, refuse }

  /** Why `form`'s drafts, or the versions a draft is checked against and written to, could not be read or written, for the operator: the form and entry of one that does not validate, and never for the caller. */
  function unread(log: FastifyBaseLogger, form: string | undefined, error: unknown): void {
    if (error instanceof UnreadableDraftError) log.error({ form: error.form, entry: error.entry, problems: error.problems }, 'a draft entry does not validate, and is not served')
    else log.error({ form, error: (error as Error).message }, 'the drafts or the versions could not be read or written')
  }

  /** Something no caller can put right -- a draft edited on disk, a store that cannot be read: logged for the operator, 500 for the caller. */
  function internal(reply: FastifyReply, form: string | undefined, error: unknown) {
    unread(reply.log, form, error)
    return refuse(reply, 500, 'internal', INTERNAL)
  }

  /** The draft a path names, its trail written, or a reply already sent: 400 for no draft's number, 404 for no such draft. */
  async function addressed(request: FastifyRequest<{ Params: { id: string; draft: string } }>, reply: FastifyReply): Promise<Draft | undefined> {
    const { id } = request.params
    const number = draftOf(request.params.draft)
    if (number === undefined) {
      await refuse(reply, 400, 'invalid-request', 'A draft is a whole number from 1.')
      return undefined
    }
    const trail = adminTrail(request)
    trail.draft = number
    let found: Draft | undefined
    try {
      found = FORM_ID.test(id) ? (await drafts.of(id)).find((each) => each.draft === number) : undefined
    } catch (error) {
      await internal(reply, id, error)
      return undefined
    }
    if (found === undefined) {
      await refuse(reply, 404, 'unknown-draft', `${id} has no draft ${String(number)}.`)
      return undefined
    }
    trail.expectedBase = found.expectedBase
    trail.connection = found.bundle.connection
    return found
  }

  /** The 409 for a draft that is no longer pending, or `undefined` for one that is. */
  function decided(reply: FastifyReply, draft: Draft): FastifyReply | undefined {
    const name = `Draft ${String(draft.draft)} of ${draft.form}`
    if (draft.state === 'rejected') {
      return refuse(reply, 409, 'rejected', draft.rejection?.withdrawn === true ? `${name} was withdrawn by its submitter: submit it again for review.` : `${name} was rejected: submit it again for review.`)
    }
    if (draft.state === 'published') return refuse(reply, 409, 'published', `${name} is published already, as version ${String((draft.expectedBase ?? 0) + 1)}.`)
    if (draft.state === 'stale') {
      return refuse(reply, 409, 'stale', `${name} was submitted ${over(draft.expectedBase)}, and version ${String(draft.current)} is the newest now: nothing can approve it. Submit it again over the newest version.`, { current: draft.current })
    }
    return undefined
  }

  app.post<{ Params: { id: string } }>('/v1/forms/:id/drafts', async (request, reply) => {
    const id = request.params.id
    const body = request.body
    // The publish's and the import's body; a `submittedBy` in it is not read.
    if (!FORM_ID.test(id)) return refuse(reply, 400, 'invalid-request', 'A form id is lower-case letters, digits, dot, hyphen or underscore.')
    if (!isRecord(body) || !('expectedBase' in body) || !(body['expectedBase'] === null || Number.isSafeInteger(body['expectedBase'])) || !isRecord(body['bundle'])) {
      return refuse(reply, 400, 'invalid-request', 'Expected { expectedBase: the version you edited, or null for the first, bundle, keysConfirmed? }.')
    }
    const expectedBase = body['expectedBase'] as number | null
    const trail = adminTrail(request)
    trail.expectedBase = expectedBase
    const confirmed = readKeysConfirmed(body['keysConfirmed'])
    if (confirmed === undefined) {
      return refuse(reply, 400, 'invalid-request', 'Expected keysConfirmed, when sent, to list { field, was, now } as a refusal 422 keys-reassigned lists them in keys.')
    }
    try {
      // Inside the try: the gate reads the versions store, which can fail as the drafts store can.
      const gated = await gate(steps, reply, id, expectedBase, body['bundle'], confirmed, SUBMIT)
      if (!gated.ok) return reply
      // Over a version that is not the newest, it could never be approved: the conflict a publish answers.
      const current = await store.latest(id)
      if (current !== expectedBase) return send(reply, conflictOver(current))
      // A form whose drafts cannot be read takes no new one: it could not be read either.
      await drafts.of(id)
      const draft = await drafts.submit(id, { expectedBase, bundle: gated.bundle, keysConfirmed: confirmed, submittedBy: caller(request).id })
      trail.draft = draft
      return reply.code(201).send({ draft, state: 'pending', drift: gated.drift } satisfies DraftSubmission)
    } catch (error) {
      return internal(reply, id, error)
    }
  })

  app.get('/v1/drafts', async (request, reply) => {
    const who = caller(request)
    const queued: QueuedDraft[] = []
    const unreadable: string[] = []
    let forms: string[]
    try {
      forms = await drafts.forms()
    } catch (error) {
      return internal(reply, undefined, error)
    }
    // One form whose drafts cannot be read is named, and hides no other form's.
    for (const form of forms) {
      try {
        for (const draft of await drafts.of(form)) {
          if (draft.state !== 'pending') continue
          queued.push({ form, draft: draft.draft, expectedBase: draft.expectedBase, submittedBy: draft.submittedBy, title: draft.bundle.form.title, refuses: draftRefuses(who, true, draft) })
        }
      } catch (error) {
        unread(request.log, form, error)
        unreadable.push(form)
      }
    }
    return { drafts: queued, unreadable } satisfies DraftQueue
  })

  app.get<{ Params: { id: string; draft: string } }>('/v1/forms/:id/drafts/:draft', async (request, reply) => {
    const draft = await addressed(request, reply)
    if (draft === undefined) return reply
    const { rejection, ...read } = draft
    return {
      ...read,
      ...(rejection === undefined ? {} : { rejectedBy: rejection.by, withdrawn: rejection.withdrawn }),
      refuses: draftRefuses(caller(request), true, draft),
    } satisfies DraftRead
  })

  app.post<{ Params: { id: string; draft: string } }>('/v1/forms/:id/drafts/:draft/approval', async (request, reply) => {
    const draft = await addressed(request, reply)
    if (draft === undefined) return reply
    const refused = refusalFor('draft-approve', caller(request), true, draft)
    if (refused !== undefined) return send(reply, refused)
    const state = decided(reply, draft)
    if (state !== undefined) return state
    const name = `Draft ${String(draft.draft)} cannot be approved`
    try {
      const gated = await gate(steps, reply, draft.form, draft.expectedBase, draft.bundle, draft.keysConfirmed, sentences(name, 'an approval failed where it cannot'))
      if (!gated.ok) return reply
      // Asked again just before the write: a rejection made while the database was asked decides first.
      const now = (await drafts.of(draft.form)).find((each) => each.draft === draft.draft)
      if (now?.state === 'rejected') return decided(reply, now)
      // The draft's bundle and nothing else: who approved it is the trail's.
      const outcome = await store.publish(draft.form, draft.expectedBase, draft.bundle)
      if (!outcome.ok) return send(reply, conflictOver(outcome.current))
      adminTrail(request).formVersion = outcome.version
      return reply.code(201).send({ version: outcome.version, drift: gated.drift } satisfies Approval)
    } catch (error) {
      return internal(reply, draft.form, error)
    }
  })

  app.post<{ Params: { id: string; draft: string } }>('/v1/forms/:id/drafts/:draft/rejection', async (request, reply) => {
    const draft = await addressed(request, reply)
    if (draft === undefined) return reply
    const who = caller(request)
    const refused = refusalFor('draft-reject', who, true, draft)
    if (refused !== undefined) return send(reply, refused)
    // Only a pending draft is decided: a stale one is out of the queue already, since nothing can approve it.
    const state = decided(reply, draft)
    if (state !== undefined) return state
    try {
      await drafts.reject(draft.form, draft.draft, who.id)
    } catch (error) {
      return internal(reply, draft.form, error)
    }
    return reply.code(201).send({ draft: draft.draft, state: 'rejected', withdrawn: who.id === draft.submittedBy } satisfies DraftRejection)
  })
}
