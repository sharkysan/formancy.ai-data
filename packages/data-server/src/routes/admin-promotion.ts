import type { DriftReport } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ConfigurationStore } from '../config-store.js'
import { FORM_ID } from '../published.js'
import { conflictOver } from '../publishing.js'
import type { Refusal } from '../publishing.js'
import { readKeysConfirmed } from '../reassigned.js'
import { adminTrail } from './admin-audit.js'
import type { Discover, Refuse } from './admin.js'
import { gate } from './admin-gate.js'
import type { GateSentences } from './admin-gate.js'

/**
 * What `POST /v1/forms/:id/imports` answers (0062): the version written, and
 * the drift between the snapshot the bundle carries and this deployment's
 * database that allowed it -- changes to review or note, never one that
 * blocks.
 */
export interface Importation {
  version: number
  drift: DriftReport
}

interface PromotionOptions {
  store: ConfigurationStore
  /** Whether this deployment's allowlist has a connection by that name. */
  allowlisted: (connection: string) => boolean
  discover: Discover
  refuse: Refuse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What an import refuses in. */
const IMPORT: GateSentences = {
  unknown: (name) =>
    `No connection is called ${name} in this deployment: an import keeps the connection's name, which each deployment's allowlist resolves to its own database.`,
  otherEngine: (connection, database, bound) =>
    `This version cannot be imported: connection ${connection} is a ${database} database here, and the version is bound to ${bound}. A form's bindings belong to one engine.`,
  incompatible: "This version cannot be imported: this deployment's database differs from the one it was published from in a way it cannot serve.",
  failed: 'an import failed where it cannot',
}

/**
 * A published version moved between deployments (0062): the version file
 * another deployment's store wrote -- read there as `GET
 * /v1/forms/:id/versions/:version`, the export -- written here as a new
 * version, after the checks a publish makes and the gate a restore passes.
 * Registered by `adminRoutes` after its role check, so the check covers it.
 *
 * The bundle is written as it came, snapshot and all: what was reviewed
 * there is what runs here, and the runtime's root check (0041) and this
 * deployment's drift compare against that snapshot until a regeneration
 * replaces it. Nothing is renamed: the connection and the form keep their
 * names, because a lookup's source name is made from the connection's, so
 * a renamed connection is another generated base.
 */
export function promotionRoutes(app: FastifyInstance, { store, allowlisted, discover, refuse }: PromotionOptions): void {
  const send = (reply: FastifyReply, refusal: Refusal) => refuse(reply, refusal.status, refusal.code, refusal.message, refusal.extra)

  app.post<{ Params: { id: string } }>('/v1/forms/:id/imports', async (request, reply) => {
    const id = request.params.id
    const body = request.body
    // 1. The body's shape, before anything is checked or a database asked.
    if (!FORM_ID.test(id)) return refuse(reply, 400, 'invalid-request', 'A form id is lower-case letters, digits, dot, hyphen or underscore.')
    const shape = 'Expected { expectedBase: the newest version here, or null for the first, bundle: the version file, keysConfirmed? }.'
    if (
      !isRecord(body) ||
      !('expectedBase' in body) ||
      !(body['expectedBase'] === null || Number.isSafeInteger(body['expectedBase'])) ||
      !isRecord(body['bundle'])
    ) {
      return refuse(reply, 400, 'invalid-request', shape)
    }
    const expectedBase = body['expectedBase'] as number | null
    const trail = adminTrail(request)
    trail.expectedBase = expectedBase
    const confirmed = readKeysConfirmed(body['keysConfirmed'])
    if (confirmed === undefined) {
      return refuse(
        reply,
        400,
        'invalid-request',
        'Expected keysConfirmed, when sent, to list { field, was, now } as an import refused 422 keys-reassigned lists them in keys.',
      )
    }

    // 2 to 7 (admin-gate.ts). What a publish checks: it validates, in format 2, for this form;
    // its connection is a name this allowlist has; and this server's generator writes its base
    // and bindings. Then this deployment's database as it is now; restore's gate, refusing
    // another engine or a change that blocks; and 0039 against this deployment's base, where a
    // stale base is the conflict first.
    const gated = await gate({ store, allowlisted, discover, refuse }, reply, id, expectedBase, body['bundle'], confirmed, IMPORT)
    if (!gated.ok) return reply

    // 8. Compare-and-swap, as every version is written.
    const outcome = await store.publish(id, expectedBase, gated.bundle)
    if (!outcome.ok) return send(reply, conflictOver(outcome.current))
    trail.formVersion = outcome.version
    const importation: Importation = { version: outcome.version, drift: gated.drift }
    return reply.code(201).send(importation)
  })
}
