import type { FormSchema } from '@formancy/spec'
import type { ApiValue } from '../codecs/codec.js'
import type { RowFilters } from '../lookup/types.js'
import type { NormalizedType } from '../metadata.js'
import type { RecordConcurrency, RecordTarget, RecordValue, Through } from '../records/types.js'
import type { RoutineMeta, RoutineRef } from '../routines.js'

/*
 * An action (0159): a routine the deployment keeps in its database, bound
 * by an administrator to a form and run over the open record. What the
 * request asks for, what the bindings keep, and what the planner hands an
 * adapter. Nothing runs one yet: the port and both adapters' run are a
 * later record's, and so are the route, the client and the pages.
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
 * An action an administrator asks the generator to bind (0159): a name
 * unique in the form, the routine, and where each of its parameters comes
 * from. `scope` is `record`, the open record; a selection of records is a
 * later record's.
 */
export interface ActionChoice {
  /** Lower-case letters, digits and hyphens, starting with a letter or a digit, at most 64. */
  name: string
  routine: RoutineRef
  scope: 'record'
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
  scope: 'record'
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
