import type { FormRecord } from '@formancy/data-core'
import type { Outcome, Refusal } from './client.js'
import type { UnknownWrite } from './writes.js'

/**
 * What one read says about an unknown write (0031). Never a resend: the
 * person decides what happens next, with this in front of them.
 *
 * - `unchanged` -- an update's or a deletion's record is still at the
 *   version it sent: for a deletion, deleting again with it is safe. Not
 *   visible yet, which is not "not stored": on PostgreSQL a write orphaned by
 *   a cut can still commit. Saving again with that same version is safe; the
 *   database stores it at most once, and whichever comes second is stale.
 * - `changed` -- an update's or a deletion's record has moved on: this save, or another's.
 * - `present` -- a create whose token was known is there -- or, where records
 *   are deleted, one created again since with the same key, which only a
 *   key people type allows, and only on a rowversion table (0050).
 * - `absent` -- it is not (the read's 404). Creating again is safe: the key
 *   stops a second row, whichever write lands first. A deletion's record
 *   is gone: this deletion's work, or another's, which the version a record
 *   cannot share with another makes one and the same (0050).
 * - `unverifiable` -- a create with no token: the database numbers the key,
 *   or the answer was lost before the server could name one. No request is
 *   made; only the person can tell.
 * - a refusal -- the read's own, which says nothing about the write.
 */
export type Reconciliation =
  | { ok: true; state: 'unchanged'; current: FormRecord }
  | { ok: true; state: 'changed'; current: FormRecord }
  | { ok: true; state: 'present'; current: FormRecord }
  | { ok: true; state: 'absent' }
  | { ok: true; state: 'unverifiable' }
  | Refusal

/** Reads the record an unknown write addressed, through `read`, and says what that shows. */
export async function reconcile(
  read: (formId: string, record: string) => Promise<Outcome<FormRecord>>,
  formId: string,
  unknown: UnknownWrite,
): Promise<Reconciliation> {
  if (unknown.record === null) return { ok: true, state: 'unverifiable' }
  const found = await read(formId, unknown.record)
  if (unknown.operation === 'create') {
    if (found.ok) return { ok: true, state: 'present', current: found.value }
    return found.status === 404 && found.code === 'not-found' ? { ok: true, state: 'absent' } : found
  }
  if (unknown.operation === 'delete' && !found.ok && found.status === 404 && found.code === 'not-found') return { ok: true, state: 'absent' }
  if (!found.ok) return found
  return { ok: true, state: found.value.version === unknown.version ? 'unchanged' : 'changed', current: found.value }
}
