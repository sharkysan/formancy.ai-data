import type { HostIdentity } from '@formancy/data-identity'
import type { AdminOperation } from './audit.js'

/*
 * Who may do what on the administrator's plane (0065). Without review,
 * every administrator may do everything, as before. Under review -- with
 * publisher roles set (`publisher-roles.ts`) -- nobody writes a version
 * directly: an administrator submits a draft, and a publisher who did not
 * submit it approves it. Restoring a version stays one publisher's action,
 * alone.
 *
 * Browsing a connection's rows (0099) is a grant of its own, review or
 * not: a holder of a browse role may, and nobody else.
 *
 * `refusalFor` is the one decision. The plane's preHandler asks it for
 * every route, and a draft's routes ask it again with the draft in hand;
 * the administration answer and each draft's `refuses` are derived from
 * it, so what the studio is told it may do and what a route then answers
 * cannot say different things.
 */

/**
 * What an operation needs:
 *
 * - `administrator`: any administrator, review or not;
 * - `reviewed`: writes a version directly -- any administrator without
 *   review, nobody under it (`review-required`): the draft is the way;
 * - `publisher`: any administrator without review, a publisher under it
 *   (`publisher-required`). Approving a draft also needs a publisher other
 *   than its submitter (`own-draft`); rejecting one is also its own
 *   submitter's, which is a withdrawal.
 * - `browser`: an administrator holding a browse role, review or not
 *   (`browse-role-required`, 0099); with no browse role set, nobody.
 */
export type Grant = 'administrator' | 'reviewed' | 'publisher' | 'browser'

/**
 * Every operation of the plane, classified: an operation added to
 * `AdminOperation` without a grant here does not type-check.
 */
export const GRANTS: Readonly<Record<AdminOperation, Grant>> = {
  'connection-list': 'administrator',
  'connection-test': 'administrator',
  discovery: 'administrator',
  proposal: 'administrator',
  publish: 'reviewed',
  'version-list': 'administrator',
  'version-latest': 'administrator',
  'version-read': 'administrator',
  drift: 'administrator',
  // It answers a draft to review and writes nothing (admin-evolution.ts).
  regeneration: 'administrator',
  restore: 'publisher',
  // An import under review is a draft: its file is submitted, and approved like any other (0062).
  import: 'reviewed',
  administration: 'administrator',
  'draft-queue': 'administrator',
  'draft-read': 'administrator',
  'draft-submit': 'administrator',
  'draft-approve': 'publisher',
  'draft-reject': 'publisher',
  // It reads a connection's rows, which publishing a form never needed (0099).
  browse: 'browser',
}

export type GovernanceCode = 'review-required' | 'publisher-required' | 'own-draft' | 'browse-role-required'

/** A refusal governance decides: always 403, a stable code, and the sentence for it, written once. */
export interface GovernanceRefusal {
  status: 403
  code: GovernanceCode
  message: string
}

export const REFUSALS: Readonly<Record<GovernanceCode, GovernanceRefusal>> = {
  'review-required': {
    status: 403,
    code: 'review-required',
    message: 'This deployment reviews publication: submit this version as a draft, and a publisher other than you approves it.',
  },
  'publisher-required': {
    status: 403,
    code: 'publisher-required',
    message: "This needs a publisher role: restoring a version, and approving or rejecting someone else's draft, are a publisher's.",
  },
  'own-draft': {
    status: 403,
    code: 'own-draft',
    message: 'You submitted this draft: a publisher other than you approves it.',
  },
  'browse-role-required': {
    status: 403,
    code: 'browse-role-required',
    message: "Reading a connection's rows needs a browse role, which this deployment gives to nobody or not to you.",
  },
}

/** The operations whose refusal depends on the draft: their routes ask once the draft is read, so an unknown one is 404 first. */
export const DECIDED_ON_THE_DRAFT: ReadonlySet<AdminOperation> = new Set<AdminOperation>(['draft-approve', 'draft-reject'])

/** Who is asking, as governance reads them: the token's `sub`, whether they publish, and whether they browse. */
export interface Caller {
  id: string
  /** True without review, where every administrator publishes; under it, whether a role of theirs is a publisher role. */
  publisher: boolean
  /** Whether a role of theirs is a browse role (0099); false for everybody when none is set. */
  browser: boolean
}

/**
 * The caller a verified identity is, under `publisherRoles` -- `undefined`
 * for no review -- and `browseRoles` -- `undefined` for nobody. Never
 * anything a body says.
 */
export function callerOf(identity: HostIdentity, publisherRoles: ReadonlySet<string> | undefined, browseRoles?: ReadonlySet<string>): Caller {
  const roles = identity.actor.roles
  return {
    id: identity.actor.id,
    publisher: publisherRoles === undefined || roles.some((role) => publisherRoles.has(role)),
    browser: browseRoles !== undefined && roles.some((role) => browseRoles.has(role)),
  }
}

/**
 * Whether `caller` may do `operation`, or the refusal: the one decision.
 * Without review nothing is refused but a browse. `draft` is the draft addressed, for
 * approval and rejection; without one, what the grant alone refuses.
 */
export function refusalFor(operation: AdminOperation, caller: Caller, review: boolean, draft?: { submittedBy: string }): GovernanceRefusal | undefined {
  const grant = GRANTS[operation]
  // Before review: browsing is its own grant, whether publication is reviewed or not.
  if (grant === 'browser') return caller.browser ? undefined : REFUSALS['browse-role-required']
  if (!review) return undefined
  if (grant === 'administrator') return undefined
  if (grant === 'reviewed') return REFUSALS['review-required']
  const own = draft !== undefined && draft.submittedBy === caller.id
  // A submitter may take back their own draft, publisher or not.
  if (operation === 'draft-reject' && own) return undefined
  if (!caller.publisher) return REFUSALS['publisher-required']
  // Four eyes: whatever roles they hold, nobody approves what they submitted.
  if (operation === 'draft-approve' && own) return REFUSALS['own-draft']
  return undefined
}

/** A refusal as the answers carry it: the code and the sentence the route would answer with. */
export type Refused = Pick<GovernanceRefusal, 'code' | 'message'>

const carried = (refusal: GovernanceRefusal | undefined): Refused | undefined =>
  refusal === undefined ? undefined : { code: refusal.code, message: refusal.message }

/** What `GET /v1/administration` answers: whether this deployment reviews, whether the caller publishes, and every operation the grant alone refuses them. */
export interface Administration {
  review: boolean
  publisher: boolean
  refuses: Partial<Record<AdminOperation, Refused>>
}

/** The administration answer for `caller`, derived from `refusalFor` without a draft. */
export function administrationOf(caller: Caller, review: boolean): Administration {
  const refuses: Partial<Record<AdminOperation, Refused>> = {}
  for (const operation of Object.keys(GRANTS) as AdminOperation[]) {
    const refused = carried(refusalFor(operation, caller, review))
    if (refused !== undefined) refuses[operation] = refused
  }
  return { review, publisher: caller.publisher, refuses }
}

/** What a caller may not do with one draft: approve it, reject it -- or, their own, withdraw it. */
export interface DraftRefuses {
  approve?: Refused
  reject?: Refused
}

/** What a draft's read and the queue say `caller` may not do with it, derived from `refusalFor` with the draft. */
export function draftRefuses(caller: Caller, review: boolean, draft: { submittedBy: string }): DraftRefuses {
  const approve = carried(refusalFor('draft-approve', caller, review, draft))
  const reject = carried(refusalFor('draft-reject', caller, review, draft))
  return { ...(approve === undefined ? {} : { approve }), ...(reject === undefined ? {} : { reject }) }
}
