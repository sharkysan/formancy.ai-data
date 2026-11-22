import { canonicalize } from '@formancy/spec'
import { DUPLICATE_RECORD } from '../actions/plan.js'
import type { DuplicateRecord } from '../actions/plan.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import type { RecordDeleted, RuntimeRefusal, UnknownOutcome } from '../runtime.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import type { PlanRefusal } from './plan-types.js'
import { prepare, refuse } from './prepare.js'
import { decodeRecordKey } from './token.js'

/*
 * The chosen records of a page deleted together (0173), as the runtime
 * plane carries them: each record a delete of its own, planned by
 * `planDelete` exactly as one sent alone is, in its own transaction, in the
 * order sent. What is decided once for the request is here: the body's
 * shape, held to a page, and that no record is named twice. The wire
 * shapes are declared beside it, so the server that answers
 * (`routes/runtime-bulk.ts`) and the client that sends (`chosen.ts`)
 * compile against one shape (0029).
 */

/** `POST /v1/forms/:id/records/delete-chosen` (0173): the chosen records, each by its token and the version its person read, in the page's order. */
export interface ChosenBody {
  records: Array<{ record: string; version: string }>
}

/**
 * What became of one chosen record: what `POST …/records/delete` would
 * have answered for it alone, its status and body -- 200 with the deleted
 * row's token, a refusal, or 502 `unknown-outcome` naming it with its
 * version -- or `sent: false`, a record no statement was sent for, because
 * the deadline passed or a record before it left the connection in doubt.
 */
export type ChosenOutcome = { sent: true; status: number; body: RecordDeleted | RuntimeRefusal | UnknownOutcome } | { sent: false }

/** 200: each chosen record's outcome, in the order sent. */
export interface ChosenAnswer {
  records: ChosenOutcome[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A request's chosen records by their shape alone, or `invalid-request`:
 * from one to a page, `LIST_PAGE_SIZE`, each `{ record, version }` -- the
 * rows of the one page a list shows, never a number of its own, as a run
 * over a selection is held (0165). Read by the route before it reads a
 * write id or asks the store, so a body past a page is refused before any
 * statement. Any other property is not read.
 */
export function readBulkBody(body: unknown): { ok: true; body: ChosenBody } | PlanRefusal {
  const shape = 'Expected { records: [{ record, version }] }.'
  if (!isRecord(body) || !Array.isArray(body['records'])) return refuse('invalid-request', shape)
  const sent = body['records'] as unknown[]
  if (sent.length < 1 || sent.length > LIST_PAGE_SIZE)
    return refuse('invalid-request', `A request names from 1 to ${String(LIST_PAGE_SIZE)} records: the chosen records of the page a list shows.`)
  const records: ChosenBody['records'] = []
  for (const entry of sent) {
    if (!isRecord(entry) || typeof entry['record'] !== 'string' || typeof entry['version'] !== 'string') return refuse('invalid-request', shape)
    records.push({ record: entry['record'], version: entry['version'] })
  }
  return { ok: true, body: { records } }
}

/**
 * The first two positions whose tokens name one key of this form, or
 * `null`: refused 400 `duplicate-record` in a selection's words (0165)
 * before anything is sent, since the second delete of one row is no
 * delete of the record its person chose. A key compared as a run's are,
 * by its decoded parts. A token that names no key of this form, and
 * bindings that cannot be planned from, are no duplicate: each record's
 * own plan refuses them. Two keys only the database's equality makes one
 * -- `a` and `A` under a case-insensitive collation -- are two requests'
 * worth of one row, the second answered `not-found`, which changes
 * nothing.
 */
export function chosenTwice(snapshot: MetadataSnapshot, bindings: FormBindings, records: ChosenBody['records']): DuplicateRecord | null {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return null
  const seen = new Map<string, number>()
  for (const [index, { record }] of records.entries()) {
    const key = decodeRecordKey(ready.prepared.target.identity, record)
    if (!key.ok) continue
    const spelled = canonicalize(key.key.map((part) => part.value))
    const earlier = seen.get(spelled)
    if (earlier !== undefined) return { ok: false, code: 'duplicate-record', message: DUPLICATE_RECORD, records: [earlier, index] }
    seen.set(spelled, index)
  }
  return null
}
