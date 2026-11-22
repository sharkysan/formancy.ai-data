import type { ChosenAnswer, FormRecord } from '@formancy/data-core'
import type { Outcome, Refusal } from './client.js'
import { reconcile } from './reconcile.js'
import type { Reconciliation } from './reconcile.js'
import { isRecord } from './shapes.js'
import { heard, writeOutcome } from './writes.js'
import type { DeleteOutcome, WriteAnswer } from './writes.js'

/*
 * The chosen records of a page deleted together (0173), as the client
 * reads the answer: each record by the rules every write's answer is read
 * by (`writeOutcome`, 0031), exactly as a delete of it alone would be --
 * deleted, refused, or a deletion nobody here can say happened -- or not
 * sent. The request as a whole is read by the same rules (`heard`): a
 * refusal of it is nothing deleted, and an answer lost on the way is a
 * delete of every record nobody here can say happened, which
 * `reconcileChosen` reads record by record. Nothing is sent again. Kept
 * out of `client.ts`, which only sends it.
 */

/** What a delete of chosen records addressed, as the call knows it: each record with the version its person read, in the order sent. */
export interface ChosenIntent {
  records: Array<{ record: string; version: string }>
}

/**
 * A chosen record the server sent no statement for (0173): the request's
 * deadline passed before it, or a record before it left the connection in
 * doubt. Nothing was done to it; deleting it is a new request.
 */
export interface NotSent {
  ok: false
  status: 0
  code: 'not-sent'
  message: string
  record: string
  version: string
}

/** One chosen record's outcome: what a delete of it alone would resolve to, or not sent. */
export type ChosenRecordOutcome = DeleteOutcome | NotSent

/**
 * A delete of chosen records that was sent and whose outcome nobody here
 * can know (0031): the request's answer was lost, so any of its records
 * may have been deleted. Each is named with the version sent, for
 * `reconcileChosen`; nothing here sends it again.
 */
export interface UnknownChosen {
  /** False, so a host that only checks `ok` treats it as not done, and fails closed. */
  ok: false
  /** The status that answered, or 0 when nothing did. */
  status: number
  code: 'unknown-outcome'
  /** The client's own sentence, or the server's where one came. */
  message: string
  operation: 'delete-chosen'
  /** Each record the request addressed, with the version sent, as the call named them. */
  records: Array<{ record: string; version: string }>
  /** `database`: the data server said so (a 502). `transport`: the answer was lost between page and server. */
  origin: 'database' | 'transport'
}

/**
 * A delete of chosen records the server refused as a whole, nothing
 * deleted: its refusal, and for `duplicate-record` the token it names,
 * one the call addressed.
 */
export type ChosenRefusal = Refusal & { records?: string[] }

/** What `deleteChosen` resolves to: each record's outcome in the order sent; a refusal of the request; or a request nobody here can say happened. */
export type DeleteChosenOutcome = { ok: true; value: ChosenRecordOutcome[] } | ChosenRefusal | UnknownChosen

const LOST_ON_THE_WAY = 'The answer to this deletion of chosen records was lost between this page and the data server. Any of them may have been deleted.'
const NOT_SENT = 'This record was not sent, so it was not deleted: the request stopped before it.'

/** Whether an outcome is an unknown delete of chosen records, rather than a success or a refusal. */
export function isUnknownChosen(outcome: { ok: boolean }): outcome is UnknownChosen {
  if (outcome.ok) return false
  const candidate = outcome as Partial<UnknownChosen>
  return (
    candidate.code === 'unknown-outcome' && candidate.operation === 'delete-chosen' && (candidate.origin === 'database' || candidate.origin === 'transport')
  )
}

/** One record's entry as the server answers it: not sent, or a status and a body. */
function isEntry(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value['sent'] === false || (value['sent'] === true && typeof value['status'] === 'number' && 'body' in value)
}

/** A 2xx that is the server's: an entry for every record addressed, and nothing else is the server saying what it did. */
function doneFor(intent: ChosenIntent): (body: unknown) => boolean {
  return (body) => isRecord(body) && Array.isArray(body['records']) && body['records'].length === intent.records.length && body['records'].every(isEntry)
}

/**
 * The outcome of a delete of chosen records, from what arrived: 0031's
 * rules for the request -- a 2xx counting only with an entry for every
 * record addressed, a 4xx or a 503 `unavailable` a refusal, anything else
 * lost -- and, for each record the server sent, 0031's rules for a delete
 * of it alone (`writeOutcome`), so a record is read as its delete alone
 * would be. An unknown request names every record with its version, from
 * the call's own arguments, which the transport cannot lose.
 */
export function deleteChosenOutcome(answer: WriteAnswer, intent: ChosenIntent): DeleteChosenOutcome {
  const outcome = heard<ChosenAnswer, UnknownChosen>(answer, doneFor(intent), (status, said) => ({
    ok: false,
    status,
    code: 'unknown-outcome',
    message: said?.message ?? LOST_ON_THE_WAY,
    operation: 'delete-chosen',
    records: intent.records.map(({ record, version }) => ({ record, version })),
    origin: said === undefined ? 'transport' : 'database',
  }))
  if (isUnknownChosen(outcome)) return outcome
  if (!outcome.ok) {
    const named = answer.answered && isRecord(answer.body) ? answer.body['records'] : undefined
    if (!Array.isArray(named)) return outcome
    const addressed = new Set(intent.records.map(({ record }) => record))
    return { ...outcome, records: named.filter((record): record is string => typeof record === 'string' && addressed.has(record)) }
  }
  return {
    ok: true,
    value: outcome.value.records.map((entry, index): ChosenRecordOutcome => {
      const { record, version } = intent.records[index] as ChosenIntent['records'][number]
      if (!entry.sent) return { ok: false, status: 0, code: 'not-sent', message: NOT_SENT, record, version }
      return writeOutcome({ answered: true, status: entry.status, body: entry.body }, { operation: 'delete', record, version })
    }),
  }
}

/**
 * What one read of each record says about a delete of chosen records whose
 * answer was lost (0031), in the order sent: each read as a deletion of it
 * alone whose answer was lost is (`reconcile`) -- `unchanged`, still at the
 * version sent, so not deleted; `changed`, moved on, so not deleted by
 * this request and changed by somebody; `absent`, gone, deleted by this
 * request or another; or the read's own refusal. One read at a time, so a
 * page of them asks the server no harder than a page of single reads. Never
 * a resend: a person decides, with this in front of them.
 */
export async function reconcileChosen(
  read: (formId: string, record: string) => Promise<Outcome<FormRecord>>,
  formId: string,
  unknown: UnknownChosen,
): Promise<Array<{ record: string; reconciliation: Reconciliation }>> {
  const found: Array<{ record: string; reconciliation: Reconciliation }> = []
  for (const { record, version } of unknown.records) {
    const one = {
      ok: false,
      status: unknown.status,
      code: 'unknown-outcome',
      message: unknown.message,
      operation: 'delete',
      record,
      version,
      origin: unknown.origin,
    } as const
    found.push({ record, reconciliation: await reconcile(read, formId, one) })
  }
  return found
}
