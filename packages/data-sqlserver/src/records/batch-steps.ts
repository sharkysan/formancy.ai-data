import type { RecordConcurrency, RecordTarget, RecordValue } from '@formancy/data-core'
import { exactText } from '../sql/filters.js'
import { quoteName, quoteTable } from '../sql/quote.js'
import { canonicalText, fromText, isExactKey } from '../sql/values.js'
import type { ExactKey } from '../sql/values.js'
import { digestOf, factsOf } from './definition.js'

/*
 * What each step of a write batch carries on SQL Server, shared by the batch
 * every single write runs in (`writeBatch`, statements.ts) and the batch a
 * save of a record with its rows runs in (save-batch.ts, 0155): the
 * adapter's own errors, the check that the transaction is still the batch's,
 * the definition's guard (0041), the INSTEAD OF guard, the text-stored
 * checks and the version read back after a step's triggers. One copy of
 * each, so the two batches cannot hold a write to two rules; if they ever
 * disagreed, these are where it would show.
 *
 * A user error number is anybody's -- a customer's trigger may THROW 51701
 * too -- so errors.ts and save.ts take one as the adapter's only when its
 * message is exactly the adapter's.
 */

/** Raised when a text column did not store the text it was sent: a varchar whose code page lacks a character, or that drops trailing spaces. */
export const TEXT_NOT_STORED = 51701
/** Its message: the index of the written value, in the request's order. */
export const TEXT_NOT_STORED_MESSAGE = /^formancy: text not stored as sent: ([0-9]+)$/
/** Raised when an update matched more than one row: an identity that is not a key. */
export const NOT_ONE_ROW = 51702
export const NOT_ONE_ROW_MESSAGE = 'formancy: the identity matched more than one row'
/** Raised when an enabled INSTEAD OF trigger decides what the write stores. An account that cannot see the table is refused before, by the definition's check (0041). */
export const DECIDED_BY_TRIGGER = 51703
export const DECIDED_BY_TRIGGER_MESSAGE = 'formancy: an INSTEAD OF trigger decides what this write stores'
/** Raised when a trigger ended the write's transaction and began another. */
export const TRANSACTION_REPLACED = 51704
export const TRANSACTION_REPLACED_MESSAGE = 'formancy: a trigger ended the transaction of the write and began another'
/** Raised from CATCH when the error came after a trigger had ended the write's transaction: it may have committed (0031). */
export const TRANSACTION_ENDED = 51705
export const TRANSACTION_ENDED_MESSAGE = 'formancy: a trigger ended the transaction of the write and then raised an error'
/** Raised when the table's definition is not the one the write was decided over (0041), after the statement or in CATCH. */
export const DEFINITION_MOVED = 51706
export const DEFINITION_MOVED_MESSAGE = 'formancy: table definition moved'
/** Raised when a delete's account cannot see every key that refers to a table the delete reaches, or one acts on the delete that it was not decided over (0050, 0051). */
export const REACH_MOVED = 51707
export const REACH_MOVED_MESSAGE = 'formancy: what refers to the table moved'
/** Raised when a delete's account may not DELETE from a table past the root the delete reaches (0051). */
export const REACH_UNDELETABLE = 51708
export const REACH_UNDELETABLE_MESSAGE = 'formancy: this account may not delete from a table the delete reaches'
/** A change from a date that ended a version and inserted no next one (0113): rolled back. */
export const NEXT_NOT_INSERTED = 51709
export const NEXT_NOT_INSERTED_MESSAGE = 'formancy: a change from a date ended a version and inserted no next one'
/** A step of a save that changed no row (0155): a row stale, gone or declined, or the record not found by its key at the end. Rolled back, and explained by a read after. */
export const STEP_UNCHANGED = 51721
export const STEP_UNCHANGED_MESSAGE = 'formancy: a step changed no row'
/** A child's count outside its bounds once the save's steps ran (0155): rolled back. */
export const COUNT_OUTSIDE = 51722
export const COUNT_OUTSIDE_MESSAGE = 'formancy: a count is outside its bounds'
/** The record is not one a child's lookup filter admits for a create (`within`, 0155): rolled back. */
export const NOT_WITHIN = 51723
export const NOT_WITHIN_MESSAGE = 'formancy: the record is not one these rows may reference'
/** The save passed its deadline before a step (0155): rolled back, before COMMIT was sent. */
export const PAST_DEADLINE = 51724
export const PAST_DEADLINE_MESSAGE = 'formancy: the save passed its deadline'
/** An action's run that moved no record (0160): stale, gone or ended, told apart by a read after. Rolled back, the routine not called. */
export const ACTION_UNMOVED = 51731
export const ACTION_UNMOVED_MESSAGE = 'formancy: the run moved no record'
/** The routine's definition is not the one the run was decided over (0160), just before the EXEC: rolled back, not called. */
export const ROUTINE_MOVED = 51732
export const ROUTINE_MOVED_MESSAGE = 'formancy: routine definition moved'
/** An argument whose parameter counts code-page bytes did not read back as it was given (0159, 0160): rolled back, not called. */
export const ARGUMENT_CHANGED = 51733
/** Its message: the index of the argument, in the routine's order. */
export const ARGUMENT_CHANGED_MESSAGE = /^formancy: an argument did not reach its parameter as given: ([0-9]+)$/
/** The procedure returned a status other than 0 (0159, 0160): rolled back. */
export const ROUTINE_STATUS = 51734
export const ROUTINE_STATUS_MESSAGE = 'formancy: the procedure returned a status other than 0'
/**
 * The account may not EXECUTE the procedure (0160), as HAS_PERMS_BY_NAME
 * answers just before the EXEC: rolled back, not called. Asked, because a
 * 229 at the EXEC names the procedure in ERROR_PROCEDURE() as one inside it
 * does (measured, actions.integration.test.ts).
 */
export const ROUTINE_DENIED = 51735
export const ROUTINE_DENIED_MESSAGE = 'formancy: this account may not execute the routine'
/**
 * Every number above, the ones the batches raise for themselves, a save's
 * and a run's among them: errors.ts reads none of them as a deployment's reason for the
 * person, whatever its message (0156). batch-steps.test.ts fails when a
 * number exported here is left out of it.
 */
export const OWN_NUMBERS: readonly number[] = [
  TEXT_NOT_STORED,
  NOT_ONE_ROW,
  DECIDED_BY_TRIGGER,
  TRANSACTION_REPLACED,
  TRANSACTION_ENDED,
  DEFINITION_MOVED,
  REACH_MOVED,
  REACH_UNDELETABLE,
  NEXT_NOT_INSERTED,
  STEP_UNCHANGED,
  COUNT_OUTSIDE,
  NOT_WITHIN,
  PAST_DEADLINE,
  ACTION_UNMOVED,
  ROUTINE_MOVED,
  ARGUMENT_CHANGED,
  ROUTINE_STATUS,
  ROUTINE_DENIED,
]

/** One column of what a statement returns: its name in the result, its type in a table variable, and the SQL that computes it. */
export interface Selected {
  name: string
  declared: string
  expression: string
}

/** A row's version as a statement returns it: a rowversion's 8 bytes, or a version column's decimal text. */
export function versionOf(concurrency: RecordConcurrency, source: string): Selected {
  const column = `${source}${quoteName(concurrency.column)}`
  return concurrency.kind === 'rowversion'
    ? { name: '[version]', declared: 'binary(8)', expression: column }
    : { name: '[version]', declared: 'nvarchar(20)', expression: `convert(nvarchar(20), ${column})` }
}

/** A value a write assigns — an insert's VALUES or an update's SET — and the SQL it was bound as. */
export interface Assigned {
  value: RecordValue
  sql: string
}

/** What finds a written row again: the key its OUTPUT captures as text, the variables the text is held in, and the statements. */
export interface Refind {
  captured: Selected[]
  declared: string[]
  statements: string[]
}

const NOTHING: Refind = { captured: [], declared: [], statements: [] }

/**
 * The row a step wrote, found again by its identity as the statement wrote
 * it, a generated one included: OUTPUT captures each key column as canonical
 * text into `written`, the table variable, and the text is held in
 * variables named from `prefix` -- `@i0` for a write alone, one name per
 * step in a save -- and converted back as a bound key is, so the row is
 * found exactly as a later statement names it. Through variables rather
 * than a join on the table variable, whose column would bring the
 * database's collation into the comparison and conflict with a key
 * column's own (468). A key column of another kind -- a time or an instant,
 * whose text is cut short, a boolean or a float, which do not travel as
 * text -- cannot be found again: `undefined`.
 */
export function capturedKey(
  target: RecordTarget,
  written: string,
  prefix: string,
): (Refind & { found: (alias: string) => string[]; variables: ReadonlyMap<string, string> }) | undefined {
  const keys = target.identity.map((column, index) => ({
    name: column.name,
    column: quoteName(column.name),
    type: column.type,
    variable: `@${prefix}i${String(index)}`,
    captured: `[i${String(index)}]`,
  }))
  const exact = (key: (typeof keys)[number]): key is (typeof keys)[number] & { type: ExactKey } => isExactKey(key.type)
  if (keys.length === 0 || !keys.every(exact)) return undefined
  return {
    captured: keys.map((key) => ({ name: key.captured, declared: 'nvarchar(max)', expression: canonicalText(key.type, `inserted.${key.column}`) })),
    declared: [`declare ${keys.map((key) => `${key.variable} nvarchar(max)`).join(', ')};`],
    statements: [`select ${keys.map((key) => `${key.variable} = ${key.captured}`).join(', ')} from ${written};`],
    found: (alias) => keys.map((key) => `${alias}.${key.column} = ${fromText(key.type, key.variable)}`),
    variables: new Map(keys.map((key) => [key.name, fromText(key.type, key.variable)])),
  }
}

/**
 * Reads the version back from the row itself, after the statement and its
 * AFTER triggers and before the commit. OUTPUT saw the row before a trigger
 * that touches it — an audit column, a version the application's own trigger
 * moves — changed its version again; a token taken from OUTPUT would be stale
 * before anyone held it, and refuse the next save. The row is found by
 * `capturedKey`; a target with no identity, a key that cannot be found
 * again, or no version keeps the version the statement saw.
 */
export function versionAfterTriggers(target: RecordTarget, written: string, prefix: string): Refind {
  const key = target.concurrency === null ? undefined : capturedKey(target, written, prefix)
  if (key === undefined || target.concurrency === null) return NOTHING
  const version = versionOf(target.concurrency, '[stored].')
  return {
    captured: key.captured,
    declared: key.declared,
    statements: [
      ...key.statements,
      `update [written] set [version] = ${version.expression} from ${written} as [written] cross join ${quoteTable(target.table)} as [stored] where ${key.found('[stored]').join(' and ')};`,
    ],
  }
}

/**
 * Whether an INSTEAD OF trigger decides what this write stores. Such a
 * trigger runs in place of the statement, and OUTPUT returns the row as if
 * the statement had run — the identity 0, the values before the trigger
 * changed them, a row for an update that changed nothing — so nothing the
 * batch reads says what the trigger stored, and the write is refused.
 *
 * Asked of the catalog after the statement, so a table that is not there has
 * already failed it as schema-changed (208), and after the definition's
 * check, so a table the account writes but cannot see in the catalog --
 * denied VIEW DEFINITION, `object_id` NULL to it -- has already failed that
 * as a moved definition (51706): its facts are NULL. Whether a trigger
 * decides such a write cannot be told, and it is refused either way: fail
 * closed. Before 0041 this check refused it itself, by `object_id` being
 * NULL; that branch could no longer be reached and is gone. The table's
 * name is bound, as `object_id` reads it.
 */
export function insteadOfGuard(name: string, operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'SUPERSEDE'): string {
  // A change from a date (0113) updates one row and inserts another: a trigger instead of either decides it.
  const events = operation === 'SUPERSEDE' ? "in (N'UPDATE', N'INSERT')" : `= N'${operation}'`
  const deciding =
    'select 1 from sys.triggers as [t] join sys.trigger_events as [e] on [e].[object_id] = [t].[object_id] ' +
    `where [t].[parent_id] = object_id(${name}) and [t].[is_instead_of_trigger] = 1 and [t].[is_disabled] = 0 and [e].[type_desc] ${events}`
  return `if exists (${deciding}) throw ${String(DECIDED_BY_TRIGGER)}, N'${DECIDED_BY_TRIGGER_MESSAGE}', 1;`
}

/** Whether the table's definition is not `definition`: NULL-safe, because `NULL <> x` is not true and a table the catalog no longer shows hashes to NULL. Sets `@d`. */
export function definitionMoved(table: string, definition: string): { set: string; moved: string } {
  return { set: `set @d = ${digestOf(factsOf(table))};`, moved: `@d is null or @d <> ${definition}` }
}

/**
 * Whether the table still has the definition the write was decided over
 * (0041), as a statement that raises 51706 when it has not.
 */
export function definitionGuard(table: string, definition: string): string[] {
  const { set, moved } = definitionMoved(table, definition)
  return [set, `if ${moved} throw ${String(DEFINITION_MOVED)}, N'${DEFINITION_MOVED_MESSAGE}', 1;`]
}

/** The transaction is still the one the batch began, after a statement whose trigger may have ended it and begun another (0031). */
export const SAME_TRANSACTION = `if coalesce(current_transaction_id(), 0) <> @transaction throw ${String(TRANSACTION_REPLACED)}, N'${TRANSACTION_REPLACED_MESSAGE}', 1;`

/** In CATCH: whether the transaction the batch began ended before the error -- a trigger's COMMIT or ROLLBACK -- by reading it before the rollback. */
export const ENDED = 'set @ended = case when coalesce(current_transaction_id(), 0) <> @transaction then 1 else 0 end;'

/** In CATCH, of a transaction a trigger ended: the error is not the refusal it looks like, unless it already says the transaction ended -- 3609, or the batch's own replaced transaction. */
export const ENDED_BY_ANOTHER_ERROR = `@ended = 1 and error_number() <> 3609 and not (error_number() = ${String(TRANSACTION_REPLACED)} and error_message() = N'${TRANSACTION_REPLACED_MESSAGE}')`

/**
 * Every text value a step assigns compared with what its column stored,
 * exactly, and a difference raised as 51701 with the value's index among
 * `assigned`: SQL Server converts nvarchar to a single-byte varchar without
 * an error, a character its code page lacks becoming its "best fit" or `?`
 * (0017), and a varchar created under ANSI_PADDING OFF drops trailing spaces
 * without one (C12, 0028). The stored side is canonical text from OUTPUT, a
 * char(n)'s padding trimmed, so one comparison (`exactText`) serves both
 * lengths, and it is what the statement stored, before any AFTER trigger.
 */
export function textStored(assigned: readonly Assigned[], written: string): { stored: Selected[]; checks: string[] } {
  const guarded = assigned.flatMap(({ value, sql }, index) => (value.type.kind === 'text' && value.value !== null ? [{ value, sql, index }] : []))
  return {
    stored: guarded.map(({ value }, position) => ({
      name: `[w${String(position)}]`,
      declared: 'nvarchar(max)',
      expression: canonicalText(value.type, `inserted.${quoteName(value.name)}`),
    })),
    checks: guarded.map(
      ({ sql, index }, position) =>
        `if exists (select 1 from ${written} where not (${exactText(`[w${String(position)}]`, sql)})) ` +
        `throw ${String(TEXT_NOT_STORED)}, N'formancy: text not stored as sent: ${String(index)}', 1;`,
    ),
  }
}
