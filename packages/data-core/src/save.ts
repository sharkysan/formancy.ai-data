import type { FieldError, FormRecord } from './records/plan-types.js'
import type { RuntimeRefusal } from './runtime.js'

/*
 * A save of a record with the rows of its together children (0155), as the
 * runtime plane carries it: declared once, beside `runtime.ts`, so the
 * server that answers it (`routes/runtime-save.ts`) and the client that
 * sends it (`saves.ts`) compile against one shape (0029). data-core plans
 * it (`planSave`).
 */

/** One change to a row of a together child: a new row with the ref the page minted for it, or a row by its token and the version its person read. */
export type SaveChange =
  | { create: { ref: string; answers: Record<string, unknown> } }
  | { update: { record: string; version: string; answers: Record<string, unknown> } }
  | { delete: { record: string; version: string } }

/** A save's record: a create, or an update that may change nothing. */
export type SaveRecordChange =
  { create: { answers: Record<string, unknown> } } | { update: { record: string; version: string; answers: Record<string, unknown> } }

/** `POST /v1/forms/:id/records/save` (0155): a record, and the rows of its children saved with it. */
export interface SaveBody {
  record: SaveRecordChange
  /** Each together child the save changes: the child form, its lookup that references this record, and the changes, in the order sent. */
  rows: Array<{ form: string; field: string; changes: SaveChange[] }>
}

/**
 * 200: the record as the save left it -- read by its key after every row's
 * step -- and each child and each of its changes as stored, in the order
 * sent: a new row with the ref the page minted for it, an updated row, or
 * a deleted row's token as the database held its key.
 */
export interface SavedRecord {
  record: FormRecord
  rows: Array<{ form: string; field: string; changes: Array<{ ref: string; row: FormRecord } | { row: FormRecord } | { deleted: string }> }>
}

/** Which part of a save a refusal is about: the record, a child as a whole, or one row, named by what the page sent -- its token, or a new row's `ref`. */
export type SavePart =
  { record: true } | { form: string; field: string } | { form: string; field: string; record: string } | { form: string; field: string; ref: string }

/** A save's refusal, with what it is about. */
export interface SaveRefusal extends RuntimeRefusal {
  /** The part a refusal is about; absent when it concerns the save as a whole. */
  at?: SavePart
  /** 422 `invalid-values`: every part's field errors at once, so a person fixes them all. */
  parts?: Array<{ at: SavePart; fieldErrors: FieldError[] }>
  /** 422 `too-few-rows` / `too-many-rows`: the child, its bound, and how many rows the save would leave it. */
  rows?: { form: string; field: string; min: number; max: number; held: number }
}
