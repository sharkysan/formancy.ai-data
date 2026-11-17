import type { ActionDone } from '@formancy/data-core'
import type { Refusal } from './client.js'
import { isRecord } from './shapes.js'
import { heard } from './writes.js'
import type { WriteAnswer } from './writes.js'

/*
 * A run of an action over the open record (0161), or over a selection of
 * a page's records (0165), as the client reads its answer: by the rules
 * every write's answer is read by (`heard`, 0031) -- known only when the
 * data server says what happened, unknown otherwise, never sent again --
 * with a run's own three. Done is the tokens of every record it
 * addressed; PostgreSQL's run past its deadline, which the database
 * stopped and rolled back, is the server saying nothing was done, as a 503
 * `unavailable` is (0160); and a refusal about some of the records names
 * them, each one the call addressed. Kept out of `client.ts`, which only
 * sends it.
 */

/** What a run addressed, as the call knows it: the action, and each record with the version its person read. */
export interface ActionIntent {
  action: string
  records: Array<{ record: string; version: string }>
}

/**
 * A run that was sent and whose outcome nobody here can know (0031): the
 * host reconciles it by the records' versions -- a run moves every one it
 * addresses, so running it again from the versions sent is refused as
 * changed if the first committed -- and nothing here runs it again.
 */
export interface UnknownAction {
  /** False, so a host that only checks `ok` treats it as not done, and fails closed. */
  ok: false
  /** The status that answered, or 0 when nothing did. */
  status: number
  code: 'unknown-outcome'
  /** The server's sentence when the database lost the answer; the client's own when the page lost it. */
  message: string
  operation: 'action'
  /** The action run, as the call named it. */
  action: string
  /** Each record the run addressed, with the version sent, as the call named them. */
  records: Array<{ record: string; version: string }>
  /** `database`: the data server said so (its 502). `transport`: the answer was lost between page and server. */
  origin: 'database' | 'transport'
}

/**
 * A run the server refused, nothing done (0165): its refusal, and where
 * the server named which records it is about -- `not-found`, `stale`,
 * `version-ended`, `duplicate-record` -- those records, each a token the
 * call addressed. A name the call did not address is no answer to it,
 * and is dropped: a page reads again only records it holds.
 */
export type ActionRefusal = Refusal & { records?: string[] }

/** What `runAction` resolves to: the records it addressed, by their tokens as the database holds them; a refusal; or a run nobody here can say happened. */
export type ActionOutcome = { ok: true; value: ActionDone } | ActionRefusal | UnknownAction

const RUN_LOST_ON_THE_WAY = 'The answer to this action was lost between this page and the data server. It may have run.'

/** Whether an outcome is an unknown run, rather than a success or a refusal. */
export function isUnknownAction(outcome: { ok: boolean }): outcome is UnknownAction {
  if (outcome.ok) return false
  const candidate = outcome as Partial<UnknownAction>
  return candidate.code === 'unknown-outcome' && candidate.operation === 'action' && (candidate.origin === 'database' || candidate.origin === 'transport')
}

/** A run's 2xx: a token for every record it addressed, and nothing else is the server saying it ran. */
function doneFor(intent: ActionIntent): (body: unknown) => boolean {
  return (body) =>
    isRecord(body) &&
    Array.isArray(body['records']) &&
    body['records'].length === intent.records.length &&
    body['records'].every((record) => typeof record === 'string')
}

/**
 * The outcome of a run, from what arrived: 0031's rules, a 2xx counting
 * only with a token for every record addressed, and a 503 `unavailable` or
 * `action-timeout` a refusal. An unknown run names what the call
 * addressed, the action and each record with its version, from the call's
 * own arguments, which the transport cannot lose.
 */
export function actionOutcome(answer: WriteAnswer, intent: ActionIntent): ActionOutcome {
  const outcome = heard<ActionDone, UnknownAction>(
    answer,
    doneFor(intent),
    (status, said) => ({
      ok: false,
      status,
      code: 'unknown-outcome',
      message: said?.message ?? RUN_LOST_ON_THE_WAY,
      operation: 'action',
      action: intent.action,
      records: intent.records.map(({ record, version }) => ({ record, version })),
      origin: said === undefined ? 'transport' : 'database',
    }),
    ['unavailable', 'action-timeout'],
  )
  if (outcome.ok || isUnknownAction(outcome) || !answer.answered || !isRecord(answer.body)) return outcome
  const named = answer.body['records']
  if (!Array.isArray(named)) return outcome
  const addressed = new Set(intent.records.map(({ record }) => record))
  return { ...outcome, records: named.filter((record): record is string => typeof record === 'string' && addressed.has(record)) }
}
