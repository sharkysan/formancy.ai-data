import type { RecordFailureCode } from '@formancy/data-core'
import { REFUSAL_LONGEST, REFUSAL_PREFIX } from '@formancy/data-core'

/*
 * A refusal the deployment words for the person (0156), written once for
 * both adapters' failures suites.
 *
 * Each suite creates DECLINING_TABLE as the fixture's owner, in a schema of
 * its own outside every scope another suite discovers, in its engine's DDL:
 * an item's notes by version -- item_no and valid_from its key, valid_to
 * NULL while a version is open, note, and a version column -- and
 * DECLINING_SAID beside it, holding DECLINING_MESSAGES. A trigger raises the
 * message of the note a row is written with, or deleted with: PostgreSQL's
 * BEFORE trigger with RAISE EXCEPTION USING MESSAGE (P0001), before the row
 * is kept; SQL Server's AFTER trigger with THROW 50001, whose error the
 * write batch's CATCH rolls back and raises again as it was. A note with no
 * message is written. The messages are data, inserted bound, so neither
 * dialect quotes them.
 *
 * A delete is offered only where a version proves the record (0050), which
 * a key of item and date does not, so the delete case is about
 * DECLINING_REMOVABLE: an identity, a note and a version column, under the
 * same trigger. Each suite inserts the rows its update, change and delete
 * cases address before DECLINING_MESSAGES, so the trigger lets the owner
 * insert a row whose delete it then refuses. It generates three forms as
 * the owner -- the table's records, its versions (0113), and the removable
 * table's records -- and sends each case as the planner plans it, as the
 * server sends it, then reads the tables as the owner: in every case
 * nothing is written.
 */

/** Where each suite creates the tables, and the messages their trigger raises. */
export const DECLINING_TABLE = { schema: 'declining', name: 'declining' } as const
export const DECLINING_REMOVABLE = { schema: 'declining', name: 'removable' } as const
export const DECLINING_SAID = { schema: 'declining', name: 'said' } as const

/** The reason a person reads when the deployment declines a write of the record. */
const CLOSED = 'The books for this period are closed.'
/** The reason the person reads beside the Note field. */
const NOTES_CLOSED = 'Notes are closed for this period.'
/** A reason of every code unit the bound lets through. */
const LONGEST = 'x'.repeat(REFUSAL_LONGEST - REFUSAL_PREFIX.length)

/** What the trigger raises for each note it refuses, by note; any other note is written. */
export const DECLINING_MESSAGES: Readonly<Record<string, string>> = {
  closed: `${REFUSAL_PREFIX}${CLOSED}`,
  // The delete case's row is inserted noted `kept` before this message is.
  kept: `${REFUSAL_PREFIX}${CLOSED}`,
  column: `formancy: refused [note]: ${NOTES_CLOSED}`,
  unprefixed: CLOSED,
  control: `${REFUSAL_PREFIX}${CLOSED}\nAsk the office.`,
  longest: `${REFUSAL_PREFIX}${LONGEST}`,
  overlong: `${REFUSAL_PREFIX}${LONGEST}x`,
  cut: `${REFUSAL_PREFIX}${'x'.repeat(4000)}`,
}

/** What the port answers a case with: its code, and on `declined` the reason and the column the message named. */
export interface DeclineAnswer {
  readonly code: RecordFailureCode
  readonly reason?: string
  readonly column?: string
}

/**
 * The shared expectations, by case. `declineCase(name)` is each one's id.
 *
 * - `insert`, `update`, `supersede`, `delete`: a create noted `closed`, an
 *   update of a row's note to `closed`, a change from a date whose next
 *   version is noted `closed`, and a delete of DECLINING_REMOVABLE's row
 *   noted `kept` -- whose message is `closed`'s, inserted after the row
 *   was -- are each `declined`
 *   with the reason exactly as written after the prefix.
 * - `column`: `formancy: refused [note]: ` names the column, and the reason
 *   is the rest; the server puts it beside the field bound to note.
 * - `unprefixed`: the same reason without the prefix is `refused`, as every
 *   trigger's error was before 0156.
 * - `control`: the prefix with a line break in the reason is `refused`.
 * - `longest`: a message of REFUSAL_LONGEST code units, the prefix included,
 *   reaches the person whole: on SQL Server, THROWn through the write batch.
 * - `overlong`: one code unit more is `refused`, though it arrives whole: on
 *   SQL Server a longer message arrives cut to that length, and a cut one
 *   cannot be told from it.
 * - `cut`: a message past what THROW carries, which arrives on SQL Server
 *   as its first 2,044 code units and `...`, is `refused`, never shown cut.
 */
export const DECLINE_PARITY = {
  insert: { note: 'closed', answer: { code: 'declined', reason: CLOSED } },
  update: { note: 'closed', answer: { code: 'declined', reason: CLOSED } },
  supersede: { note: 'closed', answer: { code: 'declined', reason: CLOSED } },
  delete: { note: 'kept', answer: { code: 'declined', reason: CLOSED } },
  column: { note: 'column', answer: { code: 'declined', reason: NOTES_CLOSED, column: 'note' } },
  unprefixed: { note: 'unprefixed', answer: { code: 'refused' } },
  control: { note: 'control', answer: { code: 'refused' } },
  longest: { note: 'longest', answer: { code: 'declined', reason: LONGEST } },
  overlong: { note: 'overlong', answer: { code: 'refused' } },
  cut: { note: 'cut', answer: { code: 'refused' } },
} as const satisfies Readonly<Record<string, { note: string; answer: DeclineAnswer }>>

export type DeclineCase = keyof typeof DECLINE_PARITY
