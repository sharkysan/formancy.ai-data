import type { FastifyRequest } from 'fastify'
import { auditedForm } from '../audit.js'
import type { AdminAuditEvent, AdminOperation, AuditBase } from '../audit.js'

/**
 * The audit name of every administrator route, keyed `METHOD url` (0033).
 * A route registered on the plane without an entry here stops the server
 * from starting; `admin-audit.test.ts` sends every route the router holds
 * and fails on an entry no route has.
 */
export const ADMIN_OPERATIONS: Readonly<Record<string, AdminOperation>> = {
  'GET /v1/connections': 'connection-list',
  'POST /v1/connections/:id/test': 'connection-test',
  'GET /v1/connections/:id/metadata': 'discovery',
  'POST /v1/form-proposals': 'proposal',
  'POST /v1/forms/:id/versions': 'publish',
  'GET /v1/forms/:id/versions': 'version-list',
  'GET /v1/forms/:id/versions/latest': 'version-latest',
  'GET /v1/forms/:id/versions/:version': 'version-read',
  'POST /v1/forms/:id/drift': 'drift',
  'POST /v1/forms/:id/regenerations': 'regeneration',
  'POST /v1/forms/:id/restorations': 'restore',
}

/**
 * What a route has established for the event beyond its path, set at the
 * point it is established: a name from a body once the body is read, a
 * version once it is loaded or written. Never what was sent. A connection
 * set here is still recorded only if the allowlist knows it (`describeAdmin`).
 */
export interface AdminTrail {
  connection?: string
  form?: string
  formVersion?: number
  expectedBase?: number | null
  restoredFrom?: number
}

declare module 'fastify' {
  interface FastifyRequest {
    adminAudit?: AdminTrail
  }
}

/** The request's trail, begun on first use: a refusal before any route ran has none, and needs none. */
export function adminTrail(request: FastifyRequest): AdminTrail {
  request.adminAudit ??= {}
  return request.adminAudit
}

/**
 * The administrator's event: the shared base, the trail, and the path's own
 * names, each recorded only once it is known to be a name.
 *
 * A connection, from the path, a body or a stored bundle, is recorded only
 * when `known` -- the allowlist -- has it: a connection id is a name, never an
 * address (0019), and a connection string pasted where a name goes, with a
 * token or without, would otherwise put a host and a password in the trail.
 * Checked here, where every event is made, so no route can forget it.
 */
export function describeAdmin(known: (connection: string) => boolean) {
  return (request: FastifyRequest, base: AuditBase<AdminOperation>): AdminAuditEvent => {
    const trail = request.adminAudit ?? {}
    const url = request.routeOptions.url ?? ''
    const id = (request.params as { id?: unknown }).id
    const path = typeof id === 'string' ? id : undefined
    const connection = trail.connection ?? (url.startsWith('/v1/connections/:id') ? path : undefined)
    return {
      at: base.at,
      plane: 'admin',
      actor: base.actor,
      operation: base.operation,
      connection: connection !== undefined && known(connection) ? connection : null,
      form: auditedForm(trail.form ?? (url.startsWith('/v1/forms/:id') ? path : undefined)),
      formVersion: trail.formVersion ?? null,
      expectedBase: trail.expectedBase ?? null,
      restoredFrom: trail.restoredFrom ?? null,
      status: base.status,
      outcome: base.outcome,
    }
  }
}
