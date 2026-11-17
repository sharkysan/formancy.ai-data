import type { FormRecord, RecordDeleted } from '@formancy/data-core'
import type { Outcome, Refusal } from './client.js'
import { isFormRecord, isNullableString, isRecord, isRecordDeleted, refusalOf } from './shapes.js'

/*
 * What the answer to a write says happened (0031). A read that went wrong
 * changed nothing and may be asked again; a write may have been stored by
 * the time anything went wrong, and sending it again may store it twice. So
 * a write's answer is known -- stored, or refused -- only when the data
 * server says which; everything else is an unknown write, never a refusal,
 * which a host would show as "not saved". Nothing here sends anything again.
 */

/** A write that was sent and whose outcome nobody here can know: the host reconciles it, nothing retries it. */
export interface UnknownWrite {
  /** False, so a host that only checks `ok` treats it as not done, and fails closed. */
  ok: false
  /** The status that answered, or 0 when nothing did. */
  status: number
  code: 'unknown-outcome'
  /** The server's sentence when the database lost the answer; the client's own when the page lost it. */
  message: string
  /** `delete` since 0050, `supersede` -- a change from a date -- since 0113, `save` -- a record with its rows -- since 0155. */
  operation: 'create' | 'update' | 'delete' | 'supersede' | 'save'
  /** Update, delete and supersede: the token sent. Create: the token the server says it would have, or null. Save: the record's, as an update's or a create's. */
  record: string | null
  /**
   * Update and delete: the version sent -- saving again with exactly it is
   * stored at most once, and deleting again with it deletes nothing else.
   * Create: null. Save: the record's version sent over a saved record,
   * which every save moves, and null for a save that creates it.
   */
  version: string | null
  /** `database`: the data server said so (its 502). `transport`: the answer was lost between page and server. */
  origin: 'database' | 'transport'
}

/** What `create` and `update` resolve to. */
export type WriteOutcome = Outcome<FormRecord> | UnknownWrite

/** What `delete` resolves to (0050): the server's deletion answer, a refusal, or a deletion nobody here can say happened. */
export type DeleteOutcome = Outcome<RecordDeleted> | UnknownWrite

/** Whether an outcome is an unknown write, rather than a success or a refusal. */
export function isUnknownWrite(outcome: { ok: boolean }): outcome is UnknownWrite {
  if (outcome.ok) return false
  const candidate = outcome as Partial<UnknownWrite>
  return candidate.code === 'unknown-outcome' && (candidate.origin === 'database' || candidate.origin === 'transport')
}

/** What a write addressed, as the call knows it: the transport can lose an answer, never the call's own arguments. */
export interface WriteIntent {
  operation: 'create' | 'update' | 'delete' | 'supersede' | 'save'
  record: string | null
  version: string | null
}

/** What arrived for a write: nothing, or a status and the body as JSON (undefined when unreadable or not JSON). */
export type WriteAnswer = { answered: false } | { answered: true; status: number; body: unknown }

const LOST_ON_THE_WAY = 'The answer to this save was lost between this page and the data server. It may have been saved.'
const DELETION_LOST_ON_THE_WAY = 'The answer to this deletion was lost between this page and the data server. It may have been deleted.'

function lost(intent: WriteIntent, status: number): UnknownWrite {
  return {
    ok: false,
    status,
    code: 'unknown-outcome',
    message: intent.operation === 'delete' ? DELETION_LOST_ON_THE_WAY : LOST_ON_THE_WAY,
    ...intent,
    origin: 'transport',
  }
}

/**
 * The outcome of a write, from what arrived, in this order:
 *
 * 1. Nothing arrived -- `fetch` rejected -- or the body is unreadable or not
 *    JSON, at any status: lost on the way. A proxy's page is not the data
 *    server's answer, and the request may have reached it.
 * 2. A 2xx with a record is the record stored -- for a delete, a 2xx with
 *    the deleted row's token and `deleted: true` is the record deleted
 *    (0050); for a save, a 2xx in the shape `stored` holds, the record and
 *    its rows as stored (0155); any other 2xx was lost.
 * 3. The data server's 502 `unknown-outcome` with a sentence: the database
 *    lost the answer. What was addressed comes from the body, or the call.
 * 4. A 4xx with a sentence is the server's refusal: nothing was written.
 *    This is 0028's 422 `refused`, 409 `stale`, 401 and 403 -- and a rate
 *    limit's 429, which carries a sentence and no code -- and 0156's 422
 *    `declined`, whose sentence is the deployment's own reason, passed on by
 *    the server as its trigger worded it. A trigger function's own SQL at
 *    fault on PostgreSQL is a 422 `refused` since 0156, where it was a 500,
 *    which this read as an unknown write over one certainly rolled back.
 * 5. A 503 `unavailable` with a sentence: the database was not reached.
 * 6. Anything else -- a 500, another 502 or 504 -- was lost.
 */
export function writeOutcome(answer: WriteAnswer, intent: WriteIntent & { operation: 'delete' }): DeleteOutcome
export function writeOutcome(answer: WriteAnswer, intent: WriteIntent & { operation: 'create' | 'update' | 'supersede' }): WriteOutcome
export function writeOutcome<T>(
  answer: WriteAnswer,
  intent: WriteIntent & { operation: 'save' },
  stored: (body: unknown) => body is T,
): Outcome<T> | UnknownWrite
export function writeOutcome(
  answer: WriteAnswer,
  intent: WriteIntent,
  stored?: (body: unknown) => boolean,
): WriteOutcome | DeleteOutcome | Outcome<unknown> | UnknownWrite {
  const done = stored ?? (intent.operation === 'delete' ? isRecordDeleted : isFormRecord)
  return heard(answer, done, (status, said) => {
    if (said === undefined) return lost(intent, status)
    const record = isNullableString(said.body['record']) ? said.body['record'] : intent.record
    const version = isNullableString(said.body['version']) ? said.body['version'] : intent.version
    return { ok: false, status, code: 'unknown-outcome', message: said.message, operation: intent.operation, record, version, origin: 'database' }
  })
}

/**
 * `writeOutcome`'s rules, in its order, for the answer to anything that
 * may have written -- a write, or a run of an action (0161) -- whatever
 * its unknown outcome says: one reading of 0031, so a write and a run
 * cannot tell one answer apart two ways. `done` is the 2xx that counts;
 * `unknown` makes the outcome nobody here can know, from the transport
 * (`said` undefined) or from the data server's 502 with its sentence;
 * `passing` the codes of a 503 that is the server saying nothing was done.
 */
export function heard<T, U>(
  answer: WriteAnswer,
  done: (body: unknown) => boolean,
  unknown: (status: number, said?: { message: string; body: Record<string, unknown> }) => U,
  passing: readonly string[] = ['unavailable'],
): { ok: true; value: T } | Refusal | U {
  if (!answer.answered) return unknown(0)
  const { status, body } = answer
  if (!isRecord(body)) return unknown(status)
  if (status >= 200 && status <= 299) return done(body) ? { ok: true, value: body as T } : unknown(status)
  const message = body['message']
  if (typeof message !== 'string') return unknown(status)
  if (status === 502 && body['code'] === 'unknown-outcome') return unknown(status, { message, body })
  if (status >= 400 && status <= 499) return refusalOf(status, body)
  if (status === 503 && typeof body['code'] === 'string' && passing.includes(body['code'])) return refusalOf(status, body)
  return unknown(status)
}
