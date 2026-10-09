import { createHmac } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'

/**
 * One operational audit event: who asked the runtime plane for what, against
 * which published version, and how it ended (plan section 12).
 *
 * Never a value. Not an answer, not a field, not a record: an audit log that
 * copied business data would be a second copy of the customer's database with
 * none of its permissions. The record is named by a keyed hash, or not at all.
 */
export interface AuditEvent {
  at: string
  /** The verified host actor, or `null` for a request that never authenticated. */
  actor: string | null
  operation: 'form' | 'read' | 'create' | 'update' | 'lookup-query' | 'lookup-resolve'
  form: string
  /** The published version the request was served from, when it got that far. */
  formVersion: number | null
  status: number
  /** `ok`, or the stable code the response carried. */
  outcome: string
  /**
   * A keyed hash of the record token, or `null`. Keyed, because a record token
   * spells its key and a key is often small — customer 7 — so a plain hash
   * could be reversed by trying every number. Without an audit key the server
   * cannot make one that resists that, so it records nothing rather than a
   * reference that only looks redacted.
   */
  record: string | null
}

/**
 * Where events go. A port: the default writes a structured log line; a
 * deployment that needs a durable trail supplies its own.
 *
 * A sink that throws does not fail the request — by the time the event exists,
 * the write it describes has committed or not, and refusing to answer would
 * only hide which. The failure is logged instead. That is the limitation 0023
 * writes down: this is an operational trail, not evidence.
 */
export type AuditSink = (event: AuditEvent) => void | Promise<void>

/** Events as structured log lines, one per request. */
export function logAuditSink(log: FastifyBaseLogger): AuditSink {
  return (event) => {
    log.info({ audit: event }, 'audit')
  }
}

/** The keyed hash a record is named by: the first 32 hex characters of HMAC-SHA-256. */
export function recordReference(key: string | undefined, token: string | undefined): string | null {
  if (key === undefined || token === undefined || token === '') return null
  return createHmac('sha256', key).update(token, 'utf8').digest('hex').slice(0, 32)
}
