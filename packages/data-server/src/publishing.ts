import { describeReassigned, diffSnapshots } from '@formancy/data-core'
import type { DriftChange, DriftReport, FormBindings, FormPolicy, MetadataSnapshot, ReassignedKey } from '@formancy/data-core'
import type { FastifyBaseLogger } from 'fastify'
import { generatedProblems } from './bundle-format2.js'
import { validateBundle } from './bundle.js'
import type { BundleV2, PublishedBundle } from './bundle.js'
import { UnparsableVersionError } from './config-store.js'
import type { ConfigurationStore } from './config-store.js'
import { loadVersion } from './published.js'
import { unconfirmedKeys } from './reassigned.js'

/*
 * What a version must be to be written, and what the database must be to
 * serve it: the checks the publish route, the restore route and the import
 * route (0062) share, so that "a version this server would write" and "a
 * version this database can serve" are each one decision. An import is a
 * publish whose bundle came from another store, gated as a restore is.
 */

/** A refusal for the route to send: a status, a stable code, a sentence, and what else the caller can act on. */
export interface Refusal {
  status: number
  code: string
  message: string
  extra?: Record<string, unknown>
}

export type Storable =
  | { ok: true; bundle: BundleV2 }
  /** `connection` once the bundle validated, so the trail can name it whatever refused it after. */
  | { ok: false; refusal: Refusal; connection?: string }

const INVALID = 'The bundle cannot be published.'

/**
 * Whether `document` may be written as a version of form `id`, in the order
 * the publish route has always asked: it validates (0019); it is format 2,
 * which keeps its generation request (0030); its form is `id`; its
 * connection is one `allowlisted` knows; and this server's generator writes
 * its base and bindings from its snapshot and request (0030) -- asked here,
 * at the write, and never on read, so a later generator cannot make a stored
 * version corrupt.
 *
 * `unknown` is the sentence for a connection the allowlist does not know:
 * the import says why a name has to match across deployments.
 */
export function storable(document: unknown, id: string, allowlisted: (connection: string) => boolean, unknown: (connection: string) => string = (connection) => `No connection is called ${connection}.`): Storable {
  const checked = validateBundle(document)
  if (!checked.ok) return { ok: false, refusal: { status: 422, code: 'invalid-bundle', message: INVALID, extra: { problems: checked.problems } } }
  const bundle = checked.bundle
  const refused = (message: string, extra?: Record<string, unknown>): Storable => ({ ok: false, refusal: { status: 422, code: 'invalid-bundle', message, ...(extra === undefined ? {} : { extra }) }, connection: bundle.connection })
  if (bundle.format === 1) return refused(INVALID, { problems: ['publish format 2: since 0030 a version keeps its generation request, generated base and presentation'] })
  if (bundle.form.id !== id) return refused(`The form's id is ${bundle.form.id}, not ${id}.`)
  if (!allowlisted(bundle.connection)) return refused(unknown(bundle.connection))
  const generated = generatedProblems(bundle)
  if (generated.length > 0) return refused(INVALID, { problems: generated })
  return { ok: true, bundle }
}

/**
 * The keys a write over `expectedBase` grants on that the version it
 * replaces bound to something else, and that it does not confirm (0039).
 * Nothing to compare for a first version, or for a base that is not there
 * -- below 1, or past the newest -- which the store's compare-and-swap
 * refuses; nor for a version that does not validate, or whose file does
 * not parse, which is not served (0019), so none of its grants is in
 * effect -- and publishing over it is how it is replaced. Any other
 * failure to read the base throws: a check that cannot answer refuses.
 */
export async function unconfirmedAgainst(store: ConfigurationStore, id: string, expectedBase: number | null, bundle: { bindings: FormBindings; policy: FormPolicy }, confirmed: readonly ReassignedKey[], log: FastifyBaseLogger): Promise<ReassignedKey[]> {
  if (expectedBase === null || expectedBase < 1) return []
  let replaced: Awaited<ReturnType<typeof loadVersion>>
  try {
    replaced = await loadVersion(store, id, expectedBase, log)
  } catch (error) {
    if (!(error instanceof UnparsableVersionError)) throw error
    log.error({ form: id, version: expectedBase }, 'a published version does not parse, and is not compared')
    return []
  }
  return replaced.ok ? unconfirmedKeys(replaced.bundle.bindings, bundle, confirmed) : []
}

/** The conflict a compare-and-swap answers with: somebody wrote `current` first. */
export function conflictOver(current: number | null): Refusal {
  return { status: 409, code: 'conflict', message: 'Somebody published first. Rebase on the current version and try again.', extra: { current } }
}

/**
 * The refusal for a write over `expectedBase` whose keys are not all
 * confirmed (0039), or `undefined` when there is none. Compared with a
 * version somebody has replaced, the keys may say something else, so the
 * conflict is the answer then.
 */
export async function keysRefusal(store: ConfigurationStore, id: string, expectedBase: number | null, bundle: { bindings: FormBindings; policy: FormPolicy }, confirmed: readonly ReassignedKey[], log: FastifyBaseLogger): Promise<Refusal | undefined> {
  const keys = await unconfirmedAgainst(store, id, expectedBase, bundle, confirmed, log)
  if (keys.length === 0) return undefined
  const current = await store.latest(id)
  if (current !== expectedBase) return conflictOver(current)
  return {
    status: 422,
    code: 'keys-reassigned',
    message: `Version ${String(expectedBase)} bound ${keys.map((key) => key.field).join(', ')} to other columns or lookups: confirm the grants on each for what it stands for now, or remove them. A grant is a role on the key's field, or a through that scopes this form's rows by it.`,
    extra: { keys, problems: keys.map(describeReassigned) },
  }
}

export type Servable =
  | { ok: true; drift: DriftReport }
  /** The database is another engine's than the one the bundle's bindings were made for. */
  | { ok: false; code: 'other-engine'; bound: MetadataSnapshot['kind']; database: MetadataSnapshot['kind'] }
  /** Drift blocks: only the blocking changes, which are the reason. */
  | { ok: false; code: 'incompatible'; changes: DriftChange[] }

/**
 * Whether the database as `current` describes it can serve `bundle`, by
 * drift's rules (0010): a blocking change refuses, and a change to review or
 * note is reported and allowed. One gate for a restore and an import, which
 * both put a version already reviewed in front of a database it was not
 * generated from.
 *
 * Another engine is asked first, as its own answer: drift does not compare
 * across engines, and a connection pointed at another engine is the
 * administrator's to put right, not the server's failure. `diffSnapshots`
 * throws for nothing else a validated bundle can hold; anything it does
 * throw is the caller's 500.
 */
export function servable(bundle: PublishedBundle, current: MetadataSnapshot): Servable {
  if (bundle.snapshot.kind !== current.kind) return { ok: false, code: 'other-engine', bound: bundle.snapshot.kind, database: current.kind }
  const drift = diffSnapshots(bundle.snapshot, current, bundle.bindings, bundle.policy)
  if (drift.blocking) return { ok: false, code: 'incompatible', changes: drift.changes.filter((change) => change.severity === 'blocking') }
  return { ok: true, drift }
}
