import type { ApiValue } from '../codecs/codec.js'
import type { DriftChange } from '../drift/types.js'
import type { LookupConfig, RowFilters } from '../lookup/types.js'
import type { PolicyRefusalCode } from '../policy/types.js'
import type { InsertRequest, ReadRequest, UpdateRequest } from './types.js'

/**
 * Why the planner produced no request, as a stable code.
 *
 * The policy's codes pass through unchanged, so an API maps one vocabulary.
 * The planner's own:
 *
 * - `drift` — the snapshot is not the one the bindings were generated from.
 *   Nothing in the bindings can be trusted to mean what it meant. Or the
 *   database as it is now stops this operation for the form as published
 *   (0041): its table, as the request described it, has changed in a way
 *   drift review's root families stop.
 * - `invalid-bindings` — bindings that do not say what their own snapshot
 *   says: a column it lacks or types differently, an identity that is not a
 *   key, a column bound twice, a concurrency column of the wrong kind, a
 *   lookup its foreign key does not support.
 * - `operation-unavailable` — the form does not offer it: no create, no
 *   update, no confirmed concurrency, or no key a record token can carry.
 * - `invalid-request` — answers that are not an object of field keys.
 * - `invalid-record-token` — a record token that does not name a record of
 *   this form, spelled as its key holds it.
 * - `invalid-version` — an expected version this target's concurrency could
 *   never have returned.
 * - `nothing-to-update` — an update whose answers change no column.
 * - `record-not-read` — an update carrying an instant or a time the actor
 *   may read, planned without the record as read, or with another record's:
 *   both adapters read those cut to formancy's shape, and only that read
 *   tells an unedited one from a change (0040). A caller's mistake, never a
 *   person's.
 */
export type PlanRefusalCode =
  | PolicyRefusalCode
  | 'drift'
  | 'invalid-bindings'
  | 'operation-unavailable'
  | 'invalid-request'
  | 'invalid-record-token'
  | 'invalid-version'
  | 'nothing-to-update'
  | 'record-not-read'

export interface PlanRefusal {
  ok: false
  code: PlanRefusalCode
  /** A sentence for a log. It names fields, columns and attributes, never a value. */
  message: string
  /**
   * On a `drift` refusal of the database as it is now (0041), the changes
   * that block, for the server's log. Their messages name columns and types,
   * so they never reach the person: the sentence above is what they are told.
   */
  drift?: DriftChange[]
}

/** One answer that cannot be written, by field key. The codec's code where a codec refused it. */
export interface FieldError {
  field: string
  code: string
  /** A sentence a form can show. It never echoes the value. */
  message: string
}

/** Every field whose answer cannot be written, in the form's order, so a person fixes them all at once. */
export interface InvalidValues {
  ok: false
  code: 'invalid-values'
  message: string
  fieldErrors: FieldError[]
}

/**
 * A lookup selection the planner decoded and could not judge: whether the row
 * it names is one this actor may reference is a question for the database.
 *
 * The caller asks `LookupAdapter.rejects(config, tokens, filters)` before it
 * writes, and refuses the request with `rejectedSelection(field)` when the
 * answer is not empty. A token is a reference, not a permission (0012): a
 * well-formed token can name another tenant's row, and only a query under the
 * actor's filters can tell.
 */
export interface MembershipCheck {
  field: string
  config: LookupConfig
  tokens: readonly [string]
  filters: RowFilters
}

export type PlannedRead =
  | {
      ok: true
      request: ReadRequest
      /** The field keys the actor may see, for `toFormAnswers`. */
      fields: string[]
    }
  | PlanRefusal

export type PlannedInsert =
  | {
      ok: true
      request: InsertRequest
      /** The field keys the actor may see in what the insert returns; empty for an actor who may create and not read. */
      fields: string[]
      /** Every lookup selection to recheck under the actor's filters before the insert runs. */
      memberships: MembershipCheck[]
    }
  | InvalidValues
  | PlanRefusal

export type PlannedUpdate =
  | {
      ok: true
      request: UpdateRequest
      fields: string[]
      memberships: MembershipCheck[]
    }
  | InvalidValues
  | PlanRefusal

/** A record as a form receives it. */
export interface FormRecord {
  /**
   * The record token that addresses it in the next read or update, or `null`
   * when it has no address: a key value is NULL, which a nullable unique key
   * can hold, or the key does not fit in a token.
   */
  record: string | null
  /** The version to send back with an update, or `null` when the target has no concurrency. */
  version: string | null
  /** One answer per readable field, in the shape the generated form's control holds. */
  answers: Record<string, ApiValue>
}
