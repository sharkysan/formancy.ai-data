import type { FormBindings, PlanRefusalCode, RecordFailure, RuntimeRefusal, UnknownOutcome } from '@formancy/data-core'

export interface HttpRefusal {
  status: number
  /** The body every runtime refusal has, declared once in data-core so the client reads the shape sent here. */
  body: RuntimeRefusal
}

/**
 * A planner or policy refusal as an HTTP answer.
 *
 * Access refusals are 403 and say which rule, never which value: the policy's
 * own messages name keys, columns and attributes only (0011).
 */
export function planRefusal(code: PlanRefusalCode, message: string): HttpRefusal {
  switch (code) {
    case 'operation-denied':
    case 'field-denied':
    case 'missing-attribute':
    case 'over-posting':
    case 'unknown-lookup':
    case 'operation-unavailable':
      return { status: 403, body: { code, message } }
    case 'drift':
      // The bundle's snapshot no longer matches what it was published with: an
      // administrator reviews drift, a person filling in a form cannot.
      return { status: 409, body: { code, message } }
    case 'invalid-context':
      // The host's token verified, and still did not produce a context the
      // policy can read: a deployment problem, not the person's.
      return { status: 403, body: { code, message } }
    case 'invalid-policy':
    case 'invalid-bindings':
      return { status: 500, body: { code, message: 'This form is published with a configuration the server cannot apply.' } }
    case 'invalid-request':
    case 'invalid-record-token':
    case 'invalid-version':
    case 'nothing-to-update':
      return { status: 400, body: { code, message } }
    case 'record-not-read':
      // The update route plans with the record it read and answers a read
      // that failed itself (0040), so only a read that came back as another
      // record's token reaches this -- a key spelled otherwise than the
      // database holds it, under a collation that matched it anyway. Nothing
      // was sent, and a 500 would tell the client it may have been saved.
      return { status: 409, body: { code, message: 'This update could not be compared with the record as read. Nothing was saved.' } }
  }
}

/** The form field a column is bound to, directly or through a lookup, for a field error. */
function fieldOf(bindings: FormBindings, column: string | undefined): string | undefined {
  if (column === undefined) return undefined
  for (const binding of bindings.fields) {
    if (binding.kind === 'column' && binding.column === column) return binding.field
    if (binding.kind === 'lookup' && binding.columns.includes(column)) return binding.field
  }
  return undefined
}

/**
 * A database's refusal as an HTTP answer (0015).
 *
 * Constraint failures become a field error where the engine names a column the
 * form binds, so a person sees the message beside the field. `refused` is
 * 422, because sending it again will be refused the same way; `unavailable`
 * is 503, because it may not be. `unknown-outcome` is not answered here: only
 * a write has one, and the write routes answer it with `unknownOutcome`, which
 * names what was addressed. A read that reported one would be an adapter's
 * bug, and is thrown -- a 500 -- rather than told to a person as "may have
 * been saved" (0031).
 */
export function recordFailure(bindings: FormBindings, failure: RecordFailure): HttpRefusal {
  const field = fieldOf(bindings, failure.column)
  const withField = (status: number, code: string, message: string): HttpRefusal => ({
    status,
    body: field === undefined ? { code, message } : { code, message, fieldErrors: [{ field, code, message }] },
  })
  switch (failure.code) {
    case 'not-found':
      return { status: 404, body: { code: 'not-found', message: 'No such record.' } }
    case 'stale':
      return { status: 409, body: { code: 'stale', message: 'The record changed since it was read. Reload it, review the changes, and save again.' } }
    case 'unique-violation':
      return withField(422, 'unique-violation', 'Another record already has this value.')
    case 'foreign-key-violation':
      return withField(422, 'foreign-key-violation', 'This refers to a record that does not exist, or is still referred to.')
    case 'not-null-violation':
      return withField(422, 'not-null-violation', 'A value is required.')
    case 'check-violation':
      return withField(422, 'check-violation', 'The database does not accept this value.')
    case 'too-long':
      return withField(422, 'too-long', 'This value is longer than the database stores.')
    case 'out-of-range':
      return withField(422, 'out-of-range', 'This value is outside the range the database stores.')
    case 'permission-denied':
      return { status: 403, body: { code: 'permission-denied', message: 'The database connection is not allowed to do this.' } }
    case 'schema-changed':
      return { status: 409, body: { code: 'schema-changed', message: 'The database changed since this form was published.' } }
    case 'refused':
      // A trigger's own error, a write declined, an error the adapter does not
      // know: it will be refused again, so the person is not invited to retry (0028).
      return withField(422, 'refused', 'The database refused this request, and nothing was saved. Sending it again will be refused the same way.')
    case 'unavailable':
      // Unreachable, or a refusal the engine documents as passing: a deadlock, a lock timeout.
      return { status: 503, body: { code: 'unavailable', message: 'The database could not complete this now. Nothing was saved.' } }
    case 'unknown-outcome':
      throw new Error('only a write has an unknown outcome; the write routes answer it with unknownOutcome')
  }
}

/**
 * A write that was sent and whose answer was lost, as an HTTP answer (0031):
 * 502, because something between this server and the database failed, and in
 * words that say it may have been saved. Nothing here sends it again.
 *
 * The sentence never names a value (0011): what was addressed travels in
 * `record` and `version`, for the host to reconcile with. Each sentence says
 * what is safe next. An update is protected by its version (0015). A create
 * whose key the insert named can be read by it. A create whose key the
 * database numbers cannot be found by anything here.
 */
export function unknownOutcome(operation: 'create' | 'update', record: string | null, version: string | null): { status: 502; body: UnknownOutcome } {
  let message: string
  if (operation === 'update') {
    message = 'The connection to the database failed after the change was sent. It may have been saved. Saving again with the same version is safe: it is stored at most once.'
  } else if (record !== null) {
    message = 'The connection to the database failed after the record was sent. It may have been saved: read it before entering it again.'
  } else {
    message = 'The connection to the database failed after the record was sent. It may have been saved, and the database numbers new records, so only a search of your own can tell.'
  }
  return { status: 502, body: { code: 'unknown-outcome', message, operation, record, version } }
}
