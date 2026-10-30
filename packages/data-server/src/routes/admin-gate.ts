import type { DriftReport, ReassignedKey } from '@formancy/data-core'
import type { FastifyReply } from 'fastify'
import type { BundleV2 } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import { keysRefusal, servable, storable } from '../publishing.js'
import type { Servable } from '../publishing.js'
import { adminTrail } from './admin-audit.js'
import type { Discover, Refuse } from './admin.js'

/** What the gate needs from the plane. */
export interface GateSteps {
  store: ConfigurationStore
  /** Whether this deployment's allowlist has a connection by that name. */
  allowlisted: (connection: string) => boolean
  discover: Discover
  refuse: Refuse
}

/** The sentences a route refuses in, saying what could not be done: imported, submitted, approved. */
export interface GateSentences {
  /** For a connection the allowlist does not have. */
  unknown: (connection: string) => string
  /** For a connection pointed at another engine than the bundle's bindings were made for. */
  otherEngine: (connection: string, database: string, bound: string) => string
  /** For drift that blocks. */
  incompatible: string
  /** What the operator's log says when drift throws for a validated bundle. */
  failed: string
}

/** The gate's answer: the bundle and the drift that let it through, or a refusal already sent. */
export type Gated = { ok: true; bundle: BundleV2; drift: DriftReport } | { ok: false }

/**
 * Whether `document` may be written over `expectedBase` as a version of
 * form `id`, against this deployment's database as it is now, in the order
 * an import has always asked (0062): what a publish checks (`storable`);
 * the database discovered, 503 when it cannot be; restore's gate
 * (`servable`), refusing another engine and a change that blocks; and
 * 0039's keys against the base, where a stale base is the conflict first.
 * An import, a draft's submit and its approval each run it, so "a version
 * this server would write and this database can serve" is one decision
 * whoever asks. The compare-and-swap is the caller's: the write itself,
 * or for a submit, a draft.
 */
export async function gate(
  steps: GateSteps,
  reply: FastifyReply,
  id: string,
  expectedBase: number | null,
  document: unknown,
  confirmed: readonly ReassignedKey[],
  sentences: GateSentences,
): Promise<Gated> {
  const { store, allowlisted, discover, refuse } = steps
  const trail = adminTrail(reply.request)
  const checked = storable(document, id, allowlisted, sentences.unknown)
  if (!checked.ok) {
    if (checked.connection !== undefined) trail.connection = checked.connection
    await refuse(reply, checked.refusal.status, checked.refusal.code, checked.refusal.message, checked.refusal.extra)
    return { ok: false }
  }
  const bundle = checked.bundle
  trail.connection = bundle.connection

  const current = await discover(bundle.connection, reply)
  if (current === undefined) return { ok: false }

  let served: Servable
  try {
    served = servable(bundle, current)
  } catch (error) {
    reply.log.error({ form: id, error: (error as Error).message }, sentences.failed)
    await refuse(reply, 500, 'internal', "This could not be completed; the operator's log says why.")
    return { ok: false }
  }
  if (!served.ok && served.code === 'other-engine') {
    await refuse(reply, 422, 'other-engine', sentences.otherEngine(bundle.connection, served.database, served.bound))
    return { ok: false }
  }
  if (!served.ok) {
    await refuse(reply, 409, 'incompatible', sentences.incompatible, { changes: served.changes })
    return { ok: false }
  }

  const keys = await keysRefusal(store, id, expectedBase, bundle, confirmed, reply.log)
  if (keys !== undefined) {
    await refuse(reply, keys.status, keys.code, keys.message, keys.extra)
    return { ok: false }
  }
  return { ok: true, bundle, drift: served.drift }
}
