import { isUnknownWrite } from '@formancy/data-client'
import type { SaveOutcome, SaveRecordChange, WriteOutcome } from '@formancy/data-client'
import type { TakenRows } from './save-set.js'
import type { SaveResult } from './session.js'

/*
 * Where a record's session meets the rows saved with it (0155): what the
 * session asks of them when its record is saved, and the save's answer as
 * the record's own write would have had it. The session decides the
 * record's part, as for a save alone (session.ts); the rows' set decides
 * theirs (save-set.ts).
 */

/** What a press of the record's Save says while another pane's save of the same rows holds them: still out, or lost where it created the record. */
export type RowsHeld = 'busy' | 'held' | null

/**
 * What a record's save carries besides its own answers (0155): the rows of
 * its together children, which the page holds until the record's Save --
 * one set for every pane of the record, so one pane's save of them out, or
 * lost where it created the record, holds a press in any pane of it.
 */
export interface WithRows {
  /** Whether the record's next save goes with its rows: a row changed, or a new record a together child requires rows of. */
  carries(record: string | undefined): boolean
  /** Whether a save of the record's rows from any pane holds them now: what the pane that sent it said it holds, asked as the press is made. */
  held(record: string | undefined): RowsHeld
  /** A pane's save of the record's rows sent: `holds` says, each time it is asked, whether that save holds them still. */
  holding(record: string | undefined, holds: () => RowsHeld): void
  /** The guard's owners of the record's rows (0047): what a request that drops them names, or spares. */
  owners(record: string | undefined): string[]
  /** A save created `record`: every row held for a new record is its own now, whether or not that save carried it. */
  created(record: string): void
  /** Each new or changed row's form submitted, and the rows' changes taken as they are; null where a row's form refused, which is opened. */
  take(record: string | undefined): TakenRows | null
  send(record: SaveRecordChange, taken: TakenRows): Promise<SaveOutcome>
  /** The answer applied to the rows as they were taken, and the record's result said with them. */
  settle(outcome: SaveOutcome, taken: TakenRows, result: SaveResult): SaveResult
  /** Every row's draft dropped and the rows listed again: the record as stored, loaded. */
  reload(record: string | null): void
  /** The rows listed again, each change kept at the version it was read at: Keep my line changes. */
  keep(record: string): Promise<void>
}

/** A save's answer as the record's write alone would have had it: the record, or a refusal with the record's own field errors. */
export function recordOutcome(outcome: SaveOutcome): WriteOutcome {
  if (outcome.ok) return { ok: true, value: outcome.value.record }
  if (isUnknownWrite(outcome)) return outcome
  const own = outcome.parts?.find((part) => 'record' in part.at && part.at.record === true)?.fieldErrors
  return { ok: false, status: outcome.status, code: outcome.code, message: outcome.message, ...(own === undefined ? {} : { fieldErrors: own }) }
}
