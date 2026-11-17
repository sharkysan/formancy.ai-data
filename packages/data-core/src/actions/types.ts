import type { FormSchema } from '@formancy/spec'
import type { ApiValue } from '../codecs/codec.js'
import type { RowFilters } from '../lookup/types.js'
import type { NormalizedType, ObjectRef } from '../metadata.js'
import type { DescribedTable, RecordConcurrency, RecordFailure, RecordTarget, RecordValue, Through } from '../records/types.js'
import type { RoutineMeta, RoutineRef } from '../routines.js'

/*
 * An action (0159): a routine the deployment keeps in its database, bound
 * by an administrator to a form and run over the open record, or over a
 * selection of a page's records (0165). What the request asks for, what
 * the bindings keep, what the planner hands an adapter, and the port both
 * adapters run it through (0160).
 */

/**
 * Where a routine's parameter takes its value from, as the generation
 * request names it. Database names, as the request names every column, so
 * a regeneration does not depend on a field key the generator may renumber.
 *
 * - `field`: the column a column field of the form is bound to, as the
 *   record stores it. The value never leaves the database: the call reads
 *   it from the row the run locked. The person must be able to read the
 *   field (`validatePolicy`).
 * - `key`: a column of the record's identity, which a person may always
 *   pass: the token is the address they already hold.
 * - `input`: a field of the action's dialog, by its key, typed by the
 *   parameter.
 * - `attribute`: one of the verified context's attributes (0011).
 * - `actor`: the verified actor's id.
 */
export type ParameterSource = { field: string } | { key: string } | { input: string } | { attribute: string } | { actor: 'id' }

/** One parameter of the routine and where its value comes from. */
export interface ParameterChoice {
  /** As the catalog spells it: SQL Server's with its `@`. */
  parameter: string
  from: ParameterSource
}

/**
 * What an action runs over: `record`, the open record, exactly one; or
 * `selection`, the records a person chose of the one page a list shows,
 * from one to `LIST_PAGE_SIZE`, all in one transaction, each locked in key
 * order and the routine called once for each, all or nothing (0165). A
 * bundle from before 0165 binds `record` alone.
 */
export type ActionScope = 'record' | 'selection'

/** Every scope, in the one order the generator reads them. */
export const ACTION_SCOPES: readonly ActionScope[] = ['record', 'selection']

/**
 * An action an administrator asks the generator to bind (0159): a name
 * unique in the form, the routine, what it runs over, and where each of
 * its parameters comes from.
 */
export interface ActionChoice {
  /** Lower-case letters, digits and hyphens, starting with a letter or a digit, at most 64. */
  name: string
  routine: RoutineRef
  scope: ActionScope
  parameters: ParameterChoice[]
}

/** A parameter's source as the bindings keep it: the request's, with the field key a `field` source's column is bound to. */
export type BoundSource =
  | { kind: 'field'; field: string; column: string }
  | { kind: 'key'; column: string }
  | { kind: 'input'; input: string }
  | { kind: 'attribute'; attribute: string }
  | { kind: 'actor' }

/** One parameter of a bound routine, in the order the routine declares it: its name, its type as the snapshot recorded it, and its source. */
export interface ActionParameter {
  parameter: string
  /** The engine's own identity for the type (0158): the adapter spells the cast from its closed table by this, and from nothing else. */
  typeId: string
  /**
   * As the database spells the type, for a person reading a report and
   * for what the normalised type does not say: SQL Server's datetime and
   * smalldatetime, whose precision is not their scale (`fitProblem`).
   * Never put in a statement.
   */
  databaseType: string
  type: NormalizedType
  from: BoundSource
}

/**
 * How a run moves the record's version, so that a save read before the
 * run is stale after it (0015): a version column incremented, or a
 * rowversion's touch column set to itself (0155), which moves the
 * rowversion. The generator names it, from the form's own concurrency.
 */
export type ActionMove = { kind: 'increment'; column: string } | { kind: 'touch'; column: string }

/**
 * An action as the bindings keep it (0159): what the generator wrote, and
 * what `generatedProblems` compares at every write but a restore, so a
 * client other than the studio cannot bind a routine through presentation.
 *
 * `dialog` is the form a person answers before a run, one field per
 * `input` source, generated and stored as the base is and served as
 * stored (0030); `null` where no parameter comes from an input.
 */
export interface ActionBinding {
  name: string
  routine: RoutineRef
  /** What the run calls: a PostgreSQL function, a SQL Server procedure. */
  kind: RoutineMeta['kind']
  scope: ActionScope
  parameters: ActionParameter[]
  move: ActionMove
  dialog: FormSchema | null
}

/** A routine as a request's description reads it, with the adapter's own token for the catalog facts it read (0041): what a run is decided over. */
export type DescribedRoutine = Pick<RoutineMeta, 'ref' | 'kind' | 'parameters' | 'effects' | 'returns' | 'result' | 'reach'> & {
  definition: string
}

/** One record a run addresses: its key, typed, and the version its person read. */
export interface ActionRecord {
  key: RecordValue[]
  expectedVersion: string
}

/**
 * Where a parameter's value comes from in the statement an adapter
 * builds: a column of the row the run locked, which never leaves the
 * database, or a value bound as a parameter -- canonical, as a codec
 * returned it (0008).
 */
export type ArgumentSource = { kind: 'column'; column: string } | { kind: 'value'; value: ApiValue }

/** One argument of the call, in the routine's order: the parameter's name and type, and where its value comes from. */
export interface ActionArgument {
  parameter: string
  typeId: string
  type: NormalizedType
  from: ArgumentSource
}

/**
 * A run, planned (0159): the one request an adapter will run, as one
 * transaction that locks the records under the person's filters and
 * throughs, at the versions they read, moves each version, then calls the
 * routine once per record. Typed and canonical, so both adapters receive
 * the same request for the same answers.
 */
export interface ActionRequest {
  action: string
  target: RecordTarget & { concurrency: RecordConcurrency }
  /**
   * In the order the person sent them, each key once: exactly one for an
   * action over the open record, one to `LIST_PAGE_SIZE` for a selection
   * (0165). An adapter locks them in key order, whatever this one is.
   */
  records: ActionRecord[]
  filters: RowFilters
  through: Through[]
  /** A form over versions (0113): the column a version ends at, NULL while it is open; a run acts on the open version alone. */
  open?: string
  move: ActionMove
  routine: { ref: RoutineRef; kind: RoutineMeta['kind']; arguments: ActionArgument[] }
  /** The `definition`s of the descriptions the run was decided over: it runs only while the table and the routine still have them (0041). */
  definitions: { table: string; routine: string }
}

/**
 * Why a run did not commit, as a stable code (0160). Every one but
 * `unknown-outcome` says the transaction did not commit: nothing the run
 * or the routine did is kept.
 *
 * - `not-found`, `stale`, `version-ended`: the record is not inside the
 *   person's filters and throughs, its version is not the one sent, or the
 *   version sent has ended (0113) -- told apart by a read after the
 *   rollback, as a failed update is (0015). The routine was not called.
 * - `schema-changed`: the root's definition is not the one the run was
 *   decided over (0041), the routine's is not, or the call did not resolve
 *   to it. The routine was not called, or not as bound.
 * - `permission-denied`: the account may not move the version, lock what
 *   a through reaches, or EXECUTE the routine.
 * - `declined`: the routine, or a trigger, refused in words of the
 *   deployment's own (0156): `reason` is for the person and nobody else.
 * - `refused`: the routine, or a trigger, raised an error of any other kind
 *   -- whatever its code, a missing column of the routine's body included,
 *   since the body is not what the form was published over -- or a SQL
 *   Server procedure returned a status other than 0, or an argument did
 *   not reach its parameter as it was given.
 * - `unavailable`: no connection, or the database said the transaction
 *   could not complete now -- a deadlock, a lock not granted in time.
 * - `action-timeout`: PostgreSQL stopped a statement of the run at the
 *   run's deadline (57014), or nothing of it remained for the call.
 * - `unknown-outcome`: the answer was lost after the run was sent, a
 *   SQL Server run passed its deadline, or a procedure ended the
 *   transaction itself. It may have committed, and it is never sent again.
 * - `duplicate-record`: two keys of a selection that the database's own
 *   equality makes one row -- `a` and `A` under a case-insensitive key
 *   collation on SQL Server -- found once both were locked, and rolled back
 *   before any call (0165). Two tokens of one key are the planner's
 *   refusal, before anything is sent.
 *
 * `not-found`, `stale`, `version-ended` and `duplicate-record` name the
 * records they are about (`records`); every other code is about the run.
 */
export type ActionFailureCode =
  | 'not-found'
  | 'stale'
  | 'version-ended'
  | 'duplicate-record'
  | 'schema-changed'
  | 'permission-denied'
  | 'declined'
  | 'refused'
  | 'unavailable'
  | 'action-timeout'
  | 'unknown-outcome'

export interface ActionFailure {
  ok: false
  code: ActionFailureCode
  /** A sentence for a log: the code, where it arose, a column or a routine by name. Never a value, an answer, nor a `declined` reason. */
  message: string
  /** `declined` only: the deployment's sentence for the person, never logged and never audited (0156). */
  reason?: string
  /** `declined` only: the column `formancy: refused [column]: ` names, which may be no column of the form. */
  column?: string
  /**
   * `not-found`, `stale`, `version-ended` and `duplicate-record`: which
   * records it is about, by their positions in `ActionRequest.records`, in
   * that order (0165). The route names them by the tokens sent.
   */
  records?: number[]
}

/**
 * What a run answers (0160): each record it addressed, by its key as the
 * statement that moved it read it, canonical, so a token answered is the
 * row's own; or why nothing was kept. Never a version: the routine may move
 * it after the run did.
 */
export type ActionOutcome = { ok: true; records: Array<Record<string, ApiValue>> } | ActionFailure

/** The root and the routine as one statement described them (0041), or why they could not be: `schema-changed` for either not described. */
export type DescribedAction = { ok: true; table: DescribedTable; routine: DescribedRoutine } | RecordFailure

/**
 * The action half of the database port (0160), which both adapters
 * implement and one set of shared cases holds alike (`ACTION_PARITY`,
 * `@formancy/data-fixtures`).
 *
 * `describe` reads the root and the routine in one statement, each with
 * the adapter's own token for the catalog facts it read (`definition`),
 * which a run is decided over and guarded by.
 *
 * `run` is one transaction that locks each record under the person's
 * filters and throughs at the version they read -- every record of a
 * selection in key order, so two runs over overlapping selections wait
 * for each other rather than deadlock on them (0165) -- holds each
 * through's target for the run, moves the version
 * (`ActionRequest.move`), then calls the routine once per record moved,
 * only while the root and the routine still have the definitions it was
 * decided over -- or nothing: any record's refusal, the routine's
 * included, rolls back every record. It is sent
 * once and never again, and takes no signal: a run goes on after its
 * client leaves, as a write does (0031). `deadlineMs` is the server's, a
 * whole number of milliseconds from configuration. A database refusal is an
 * `ActionFailure`; a request no planner makes is thrown before anything is
 * sent.
 */
export interface ActionAdapter {
  describe(table: ObjectRef, routine: RoutineRef): Promise<DescribedAction>
  run(request: ActionRequest, deadlineMs: number): Promise<ActionOutcome>
}
