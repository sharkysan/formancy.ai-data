import type { ObjectRef } from '../metadata.js'

/**
 * What a change means for the one form it is classified against.
 *
 * - `blocking` — the form must not be used as published: a write it offers is
 *   stopped (`DriftReport.writable` says which), or a field it shows can no
 *   longer be read.
 * - `review` — a person has something to decide, such as whether to include a
 *   new column. Nothing is stopped.
 * - `info` — recorded so the review is complete. Nothing to decide.
 */
export type DriftSeverity = 'blocking' | 'review' | 'info'

/**
 * What changed, as a stable string a program can switch on.
 *
 * The severity is a separate field because the same change means different
 * things to different forms: a dropped column blocks the form that binds it and
 * is only noted for the form that does not.
 */
export type DriftKind =
  /** The root table or view is gone, and no gap says the connection lost sight of it. */
  | 'root-dropped'
  /** The root is a view where it was a table, or the other way round. */
  | 'root-kind-changed'
  /** The root, or a lookup's target, is in a schema discovery is no longer approved for. */
  | 'scope-narrowed'
  /**
   * Something the form depends on cannot be seen, and a gap says so — or a
   * foreign key is visible and its target is not. An access problem, never a
   * deletion.
   */
  | 'access-narrowed'
  /** A gap the base snapshot had is gone: this connection can see more than it could. */
  | 'access-widened'
  | 'column-added'
  | 'column-dropped'
  /** A different type, a different spelling of the same one, or different semantics: fixed length, time zone. */
  | 'column-type-changed'
  /** The database started or stopped generating the column's value. */
  | 'column-generation-changed'
  /** Wider, and the published field cannot hold every value the column now can. */
  | 'column-outgrew-field'
  /** Narrower precision, scale, length or range, no longer nullable, or a lost default a create relied on. */
  | 'column-tightened'
  /** Wider precision, scale, length or range, nullable, or a new default. */
  | 'column-loosened'
  /** The default's expression changed, or a column that may be null lost its default. */
  | 'column-default-changed'
  /** A column gone and one added with the same definition. A hint for a person, never a rename. */
  | 'possible-rename'
  /** The rowversion or version column the form detects stale updates with is gone or different. */
  | 'concurrency-changed'
  /** No primary or unique key covers the columns that identify a record any more. */
  | 'identity-key-changed'
  /** The foreign key behind a lookup, the candidate key it points at, the target, or a display column changed. */
  | 'lookup-changed'
  /** A primary or unique key of the root that the identity does not rest on. */
  | 'key-changed'
  /** A foreign key of the root that no lookup uses. */
  | 'foreign-key-changed'
  /** A check constraint of the root. The form does not translate checks, so the database is their only enforcer. */
  | 'check-changed'

/**
 * What a change is about. An object is two strings and never one dotted
 * string, for the reason `ObjectRef` gives.
 */
export type DriftSubject =
  /** A gap about the discovery scope as a whole. */
  | { kind: 'scope' }
  | { kind: 'object'; object: ObjectRef }
  | { kind: 'column' | 'key' | 'foreign-key' | 'check'; object: ObjectRef; name: string }

export interface DriftChange {
  kind: DriftKind
  severity: DriftSeverity
  subject: DriftSubject
  /** The form fields, by key, whose bindings name what changed. In the form's order. */
  affects: string[]
  /** A sentence for the person reviewing: what changed and what it means for this form. */
  message: string
}

export interface DriftReport {
  /** Most severe first, then by subject and kind, by codepoint, so two runs are byte-identical. */
  changes: DriftChange[]
  /** Whether any change is `blocking`. */
  blocking: boolean
  /** What the published form may still do: what it offered, less what a change stops. */
  writable: { create: boolean; update: boolean }
}
