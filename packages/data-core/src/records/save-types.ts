import type { ApiValue } from '../codecs/codec.js'
import type { RowFilters } from '../lookup/types.js'
import type { ObjectRef } from '../metadata.js'
import type { SavePart } from '../save.js'
import type { FieldError, MembershipCheck, PlanRefusal } from './plan-types.js'
import type {
  DeleteRequest,
  InsertRequest,
  RecordColumn,
  RecordConcurrency,
  RecordFailure,
  RecordRead,
  RecordTarget,
  RecordValue,
  Through,
  UpdateRequest,
} from './types.js'

/*
 * A save of a record with the rows of its together children (0155), as an
 * adapter receives it (`RecordAdapter.save`), and what `planSave` answers.
 * Each step is today's request for one record; what is new is the order,
 * the pin to the record, the touch, `within` and the counts, which both
 * adapters run as one transaction and the shared cases hold alike
 * (`SAVE_PARITY`, `@formancy/data-fixtures`).
 */

/**
 * A save of a record's rows alone (0155): its version moves, guarded by the
 * version its person read, under the record's update filters and every
 * through, as an update of it would be -- so another save of the record's
 * rows waits on its row and then finds the version moved, `stale`.
 */
export interface TouchRequest {
  target: RecordTarget & { concurrency: RecordConcurrency }
  key: readonly RecordValue[]
  expectedVersion: string
  filters: RowFilters
  through: readonly Through[]
  definition: string
  /** A rowversion table's confirmed touch column (`ConcurrencyBinding.touch`), set to itself. `null` for a version column, which is incremented. */
  touch: string | null
}

/**
 * One column of a child's foreign key onto the record: with the record's
 * key value where it is known -- a saved record's token, a key the person
 * typed -- bound like any other value; or the record's identity column
 * whose value the record's own step returns, only where the database
 * numbers it (`numbersKey`): an integer or a uuid, both exact kinds.
 */
export type ParentColumn = { column: RecordColumn; value: RecordValue } | { column: RecordColumn; returned: string }

/** The record's own step: a create, an update, or the touch of an update that changes none of its columns. */
export type SaveRecordStep = { kind: 'insert'; request: InsertRequest } | { kind: 'update'; request: UpdateRequest } | { kind: 'touch'; request: TouchRequest }

/**
 * One together child the save changes, and its steps. Every one of them is
 * pinned to the record by `parent`, one pin for the child rather than one
 * per row, so no two copies can disagree: the adapter is to add it to each
 * statement that locates a row -- the update's and the delete's WHERE, and
 * the read that explains one that changed nothing -- write it into each
 * create, and count by it, so another record's row is `not-found` in all of
 * them. What data-core holds is that `parent` carries the record's key;
 * that each statement applies it is the adapters' save's to prove (0155),
 * since no type can make an adapter apply it.
 */

export interface SaveChild {
  table: ObjectRef
  parent: readonly ParentColumn[]
  /**
   * Where the save creates rows of it: the record must be a row of
   * `target` -- the record's own table -- under the child's lookup filter
   * for a create, checked once, before the first create. A through by the
   * together field is that same filter; a through by another field scopes
   * another table, which that field's membership check holds.
   */
  within: { target: ObjectRef; filters: RowFilters } | null
  deletes: readonly DeleteRequest[]
  updates: readonly UpdateRequest[]
  creates: readonly InsertRequest[]
  /** The rows the save leaves it, counted under the child's read filters and throughs, and held to `min` and `max`, which the adapter binds. */
  count: { filters: RowFilters; through: readonly Through[]; min: number; max: number }
}

export interface SaveRequest {
  record: SaveRecordStep
  /** Only the children whose rows the save changes, in codepoint order of form and field. */
  children: readonly SaveChild[]
  /** The record as the save leaves it, read by its key alone after every step: read scope is never a condition of the commit. */
  readBack: { columns: readonly RecordColumn[] }
  /** The server's deadline for the transaction, a whole number of milliseconds from configuration. */
  deadlineMs: number
}

/** One step of a save, as an adapter names the one that failed: the record's, a child's `within`, a row's, a child's count, or the save as a whole. */
export type SaveStep =
  | 'record'
  | { child: number; within: true }
  | { child: number; delete: number }
  | { child: number; update: number }
  | { child: number; create: number }
  | { child: number; count: true }
  | 'save'

/** What an adapter will answer a save with: every row as its step left it and the record read back, or the one step that refused it, with nothing stored. */
export type SaveOutcome =
  | {
      ok: true
      record: Omit<RecordRead, 'ok'>
      children: Array<{ rows: Array<Omit<RecordRead, 'ok'> | { deleted: { values: Record<string, ApiValue>; version: string } }> }>
    }
  | { ok: false; at: SaveStep; failure: RecordFailure }
  | { ok: false; at: { child: number; within: true }; rejected: true }
  | { ok: false; at: { child: number; count: true }; held: number }

/** One step of a planned save, the part of the body it is, and the fields its answer may show: what the route reads an outcome by. */
export interface PlannedSaveStep {
  step: Exclude<SaveStep, 'save'>
  at: SavePart
  fields: readonly string[]
}

/** A save planned: the one request an adapter runs, its steps in order, every lookup selection to recheck before it, and whether the record's step moves its state field (0112). */
export interface SavePlan {
  ok: true
  request: SaveRequest
  steps: PlannedSaveStep[]
  memberships: Array<{ at: SavePart; check: MembershipCheck }>
  moved: boolean | null
}

/** How many rows a save would leave a child, against its bound. */
export interface HeldRows {
  form: string
  field: string
  min: number
  max: number
  held: number
}

/**
 * Why nothing is planned: a part's refusal, answered alone and naming the
 * part where it is one; every part's field errors at once; a row the
 * record's list does not hold, `not-found` at its part, as an update of
 * another record's row is; or a bound a child would be left outside.
 */
export type SavePlanRefusal =
  | (PlanRefusal & { at?: SavePart })
  | { ok: false; code: 'invalid-values'; message: string; parts: Array<{ at: SavePart; fieldErrors: FieldError[] }> }
  | { ok: false; code: 'not-found'; message: string; at: SavePart }
  | { ok: false; code: 'too-few-rows' | 'too-many-rows'; message: string; at: SavePart; rows: HeldRows }

export type PlannedSave = SavePlan | SavePlanRefusal
