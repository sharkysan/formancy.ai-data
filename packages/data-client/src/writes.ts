import type { FormRecord } from '@formancy/data-core'
import type { Outcome } from './client.js'
import { isFormRecord, isNullableString, isRecord, refusalOf } from './shapes.js'

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
  operation: 'create' | 'update'
  /** Update: the token sent. Create: the token the server says it would have, or null. */
  record: string | null
  /** Update: the version sent -- saving again with exactly it is stored at most once. Create: null. */
  version: string | null
  /** `database`: the data server said so (its 502). `transport`: the answer was lost between page and server. */
  origin: 'database' | 'transport'
}

/** What `create` and `update` resolve to. */
export type WriteOutcome = Outcome<FormRecord> | UnknownWrite

/** Whether an outcome is an unknown write, rather than a success or a refusal. */
export function isUnknownWrite(outcome: { ok: boolean }): outcome is UnknownWrite {
  if (outcome.ok) return false
  const candidate = outcome as Partial<UnknownWrite>
  return candidate.code === 'unknown-outcome' && (candidate.origin === 'database' || candidate.origin === 'transport')
}

/** What a write addressed, as the call knows it: the transport can lose an answer, never the call's own arguments. */
export interface WriteIntent {
  operation: 'create' | 'update'
  record: string | null
  version: string | null
}

/** What arrived for a write: nothing, or a status and the body as JSON (undefined when unreadable or not JSON). */
export type WriteAnswer = { answered: false } | { answered: true; status: number; body: unknown }

const LOST_ON_THE_WAY = 'The answer to this save was lost between this page and the data server. It may have been saved.'

function lost(intent: WriteIntent, status: number): UnknownWrite {
  return { ok: false, status, code: 'unknown-outcome', message: LOST_ON_THE_WAY, ...intent, origin: 'transport' }
}

/**
 * The outcome of a write, from what arrived, in this order:
 *
 * 1. Nothing arrived -- `fetch` rejected -- or the body is unreadable or not
 *    JSON, at any status: lost on the way. A proxy's page is not the data
 *    server's answer, and the request may have reached it.
 * 2. A 2xx with a record is the record stored; any other 2xx was lost.
 * 3. The data server's 502 `unknown-outcome` with a sentence: the database
 *    lost the answer. What was addressed comes from the body, or the call.
 * 4. A 4xx with a sentence is the server's refusal: nothing was written.
 *    This is 0028's 422 `refused`, 409 `stale`, 401 and 403 -- and a rate
 *    limit's 429, which carries a sentence and no code.
 * 5. A 503 `unavailable` with a sentence: the database was not reached.
 * 6. Anything else -- a 500, another 502 or 504 -- was lost.
 */
export function writeOutcome(answer: WriteAnswer, intent: WriteIntent): WriteOutcome {
  if (!answer.answered) return lost(intent, 0)
  const { status, body } = answer
  if (!isRecord(body)) return lost(intent, status)
  if (status >= 200 && status <= 299) return isFormRecord(body) ? { ok: true, value: body } : lost(intent, status)
  const message = body['message']
  if (typeof message !== 'string') return lost(intent, status)
  if (status === 502 && body['code'] === 'unknown-outcome') {
    const record = isNullableString(body['record']) ? body['record'] : intent.record
    const version = isNullableString(body['version']) ? body['version'] : intent.version
    return { ok: false, status, code: 'unknown-outcome', message, operation: intent.operation, record, version, origin: 'database' }
  }
  if (status >= 400 && status <= 499) return refusalOf(status, body)
  if (status === 503 && body['code'] === 'unavailable') return refusalOf(status, body)
  return lost(intent, status)
}
