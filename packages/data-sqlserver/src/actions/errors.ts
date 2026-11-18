import { runFailure } from '@formancy/data-core'
import type { ActionFailure, ActionRequest } from '@formancy/data-core'
import {
  ACTION_UNMOVED,
  ACTION_UNMOVED_MESSAGE,
  ARGUMENT_CHANGED,
  ARGUMENT_CHANGED_MESSAGE,
  ARGUMENTS_UNREAD,
  ARGUMENTS_UNREAD_MESSAGE,
  DEFINITION_MOVED,
  DEFINITION_MOVED_MESSAGE,
  ROUTINE_DENIED,
  ROUTINE_DENIED_MESSAGE,
  ROUTINE_MOVED,
  ROUTINE_MOVED_MESSAGE,
  ROUTINE_STATUS,
  ROUTINE_STATUS_MESSAGE,
  SELECTION_DUPLICATE,
  SELECTION_DUPLICATE_MESSAGE,
} from '../records/batch-steps.js'
import { passes, refusal } from '../records/errors.js'
import { RUN_STEPS } from './statements.js'

/*
 * What SQL Server's errors mean for an action's run (0160): classified by
 * where they arose, which a single write's are not (records/errors.ts).
 *
 * - The run's own errors first, by number AND exact message, since a user
 *   error number is anybody's: a record not moved, two keys of a selection
 *   the database makes one row (0165), a record locked and then not found
 *   to read its arguments from (0165), the routine's definition moved, an
 *   argument changed on its way, a status other than 0. Then the
 *   write batch's, which a run's lock step carries and records/errors.ts
 *   answers: a moved root, a transaction a trigger or a procedure ended.
 * - What the transaction did, wherever it arose: a deadlock, a lock wait
 *   past LOCK_TIMEOUT (1222) and the rest SQL Server documents as passing
 *   are `unavailable`; 3609 is `unknown-outcome`.
 * - At the EXEC itself, a call that does not resolve is `schema-changed`,
 *   asked before where an error arose: no such procedure (2812), which
 *   ERROR_PROCEDURE() names none for, or one whose parameters the EXEC does
 *   not fit -- one it lacks (201), one it does not have (8145), too many
 *   (8144), any to one that takes none (8146) -- which SQL Server raises in
 *   the procedure's own context, so ERROR_PROCEDURE() names the procedure
 *   called (measured, actions.integration.test.ts). Of those, one the bound
 *   procedure raised calling another badly names the other, and is its
 *   own; one it raised calling itself badly reads as the EXEC's, the cost
 *   of reading the engine's report and no phrase.
 * - Inside a procedure or a trigger -- ERROR_PROCEDURE() names one --
 *   everything else is the deployment's: `declined` under the prefix
 *   (0156), `refused` otherwise, a column missing from the procedure's body
 *   included, never `schema-changed`.
 * - EXECUTE is asked before the EXEC, by HAS_PERMS_BY_NAME, and refused as
 *   the batch's own `permission-denied`: a 229 at the EXEC names the
 *   procedure as one inside it would. An UPDATE refused at the lock is
 *   `permission-denied` too; anything else is translated as a write's
 *   refusal is.
 */

/** A row of the batch's `@failed`: the step it stopped at, SQL Server's number, message and severity, and the procedure it arose in. */
export interface Failed {
  step: number
  number: number
  message: string
  severity: number | null
  procedure: string | null
}

/** No procedure of the name the EXEC called: raised in the batch, so ERROR_PROCEDURE() names none. */
const NO_SUCH_PROCEDURE = 2812

/** An EXEC that does not fit the procedure's parameters, raised in the procedure's context: one it lacks (201), one it does not have (8145), too many (8144), any to one that takes none (8146). */
const UNFITTED: ReadonlySet<number> = new Set([201, 8145, 8144, 8146])

/** Whether the run's EXEC failed to resolve to the bound procedure, by the step, the number and the procedure ERROR_PROCEDURE() named. */
function unresolved(first: Failed, request: ActionRequest): boolean {
  if (first.step !== RUN_STEPS.call) return false
  if (first.number === NO_SUCH_PROCEDURE) return first.procedure === null
  const { schema, name } = request.routine.ref
  return UNFITTED.has(first.number) && first.procedure === `${schema}.${name}`
}

/** 3609: the transaction ended in a trigger or a procedure, after a COMMIT as after a ROLLBACK (0031). */
const ENDED_IN_MODULE = 3609

/**
 * The answer to what the batch recorded in CATCH, `unmoved` where the lock
 * moved fewer records than were sent, which the caller explains by a
 * read. Throws for the batch's refusal of a second row: an identity that
 * is not a key.
 */
export function batchFailure(failed: readonly Failed[], request: ActionRequest): ActionFailure | 'unmoved' {
  const first = failed[0] as Failed
  const own = (number: number, message: string): boolean => first.number === number && first.message === message
  if (failed.some((row) => row.number === DEFINITION_MOVED && row.message === DEFINITION_MOVED_MESSAGE))
    return {
      ok: false,
      code: 'schema-changed',
      message: "The table's definition is not the one this run was decided over; nothing was called, and it was rolled back.",
    }
  if (own(ACTION_UNMOVED, ACTION_UNMOVED_MESSAGE)) return 'unmoved'
  const twice = first.number === SELECTION_DUPLICATE ? SELECTION_DUPLICATE_MESSAGE.exec(first.message)?.[1] : undefined
  if (twice !== undefined)
    return {
      ok: false,
      code: 'duplicate-record',
      message: 'Two keys of the selection name one row under the key’s collation; nothing was called, and the run was rolled back.',
      records: twice.split(',').map(Number),
    }
  if (own(ARGUMENTS_UNREAD, ARGUMENTS_UNREAD_MESSAGE))
    return {
      ok: false,
      code: 'refused',
      message:
        'A record the run locked was not found by its key to read its arguments from: a trigger of the lock removed it or moved its key. Nothing was called, and the run was rolled back.',
    }
  if (own(ROUTINE_MOVED, ROUTINE_MOVED_MESSAGE))
    return {
      ok: false,
      code: 'schema-changed',
      message: 'The routine is not the one this run was decided over, so it was not called; the run was rolled back.',
    }
  if (own(ROUTINE_DENIED, ROUTINE_DENIED_MESSAGE))
    return { ok: false, code: 'permission-denied', message: 'This account may not EXECUTE the routine, so it was not called; the run was rolled back.' }
  if (own(ROUTINE_STATUS, ROUTINE_STATUS_MESSAGE))
    return { ok: false, code: 'refused', message: 'The procedure returned a status other than 0, which refuses the run; it was rolled back (0159).' }
  const changed = first.number === ARGUMENT_CHANGED ? ARGUMENT_CHANGED_MESSAGE.exec(first.message)?.[1] : undefined
  if (changed !== undefined) {
    const parameter = request.routine.arguments[Number(changed)]?.parameter ?? `argument ${changed}`
    return {
      ok: false,
      code: 'refused',
      message: `The value for ${parameter} would not reach it as given: its code page lacks a character, or it drops one. Nothing was called, and the run was rolled back.`,
    }
  }
  if (first.number === ENDED_IN_MODULE)
    return {
      ok: false,
      code: 'unknown-outcome',
      message: 'A procedure or a trigger ended the run’s transaction (3609); it may have committed, and it is not retried.',
    }
  const server = { number: first.number, message: first.message, severity: first.severity ?? undefined }
  // The write batch's own errors, and what passes, keep their meaning wherever they arose.
  const written = runFailure(refusal(server, 'write', []))
  if (passes(first.number) || written.code === 'unknown-outcome') return written
  if (unresolved(first, request))
    return {
      ok: false,
      code: 'schema-changed',
      message: `The EXEC did not resolve to the bound procedure (${String(first.number)}); nothing was called, and the run was rolled back.`,
    }
  if (first.procedure !== null) {
    if (written.code === 'declined') return written
    return {
      ok: false,
      code: 'refused',
      message: `SQL Server refused the run with error ${String(first.number)}, which arose inside ${first.procedure}, a procedure or a trigger; it was rolled back.`,
    }
  }
  return written
}
