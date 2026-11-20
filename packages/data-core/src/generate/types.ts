import type { FormSchema } from '@formancy/spec'
import type { ActionBinding, ActionChoice } from '../actions/types.js'
import type { ForeignKeyTarget, NormalizedType, ObjectRef } from '../metadata.js'

/** A foreign key of the root offered as a lookup, and the target columns a person recognises a row by. */
export interface LookupChoice {
  foreignKey: string
  display: string[]
  /**
   * This form's rows are sections of the records the foreign key references
   * (0109): its columns are the root's whole key, so each referenced record
   * has at most one row here, which a page shows under that record as a
   * form of its own rather than a grid. `when` names a column of the
   * referenced table and a value spelled as it holds it: the section is
   * shown only while the record holds that value there -- a customer's
   * company details while its kind is `company`. `null` shows it always.
   */
  section?: { when: SectionCondition | null }
  /**
   * This form's rows are saved with the record the foreign key references,
   * in one transaction, and that record holds at least `min` and at most
   * `max` of them through the two forms (0155). Never inferred.
   */
  together?: TogetherBounds
}

/** How many rows of a together child one record holds (0155): whole numbers, `0 <= min <= max`, `max` at least 1 and at most `TOGETHER_MAX_ROWS`. */
export interface TogetherBounds {
  min: number
  max: number
}

/** A column of the table a section's lookup references, and the value it holds while the section is shown (0109). */
export interface SectionCondition {
  column: string
  value: string
}

/** What a section's lookup binding carries (0109): its condition, the column typed as the referenced table holds it. */
export interface SectionBinding {
  when: (SectionCondition & { type: NormalizedType }) | null
}

export interface GenerationRequest {
  /**
   * The connection the form is bound to, as the deployment names it. Part of
   * every option-source name, because a source name is resolved per deployment
   * and two connections can hold tables with the same names.
   */
  connection: string
  root: ObjectRef
  formId: string
  title: string
  lookups: LookupChoice[]
  /**
   * A version column the administrator has confirmed. A column that merely
   * looks like one is suggested and never trusted: updating without a proven
   * concurrency strategy is how a lost update happens.
   */
  versionColumn?: string
  /**
   * For a root whose concurrency is a rowversion: the column a save of a
   * record's rows alone sets to itself, so that the rowversion moves
   * (0155). Confirmed by an administrator, never inferred, as a version
   * column is.
   */
  touchColumn?: string
  /**
   * Root columns the form's policy pins to trusted context — the tenant
   * column, typically (0011). The request never supplies them: on create they
   * come from the verified identity, and a submitted value is over-posting. So
   * the generated field for one is shown and never written, and is not a
   * required field a person could not fill. Found when the planner (0018) met
   * the generator: without this, a pinned NOT NULL column was a required field
   * the policy refused, and no submission could pass both.
   */
  pinned?: string[]
  /**
   * The root's rows are versions of one thing (0113): `from` is the column a
   * version starts at, `to` the one it ends at, NULL while it is open. The
   * generator refuses a pair it cannot hold a chain to (`validityFor`).
   */
  validity?: { from: string; to: string }
  /**
   * Columns the server fills itself on create, on update or on both (0153):
   * who wrote a row, or when. Confirmed by an administrator, as a version
   * column is: a column that merely has an audit column's name is suggested
   * and never stamped without this. The request never supplies one, so the
   * generated field for one is shown and never written.
   */
  stamps?: StampChoice[]
  /**
   * Routines the form offers to run over the open record (0159), each a
   * name, the routine and where every one of its parameters comes from.
   * The generator binds each it can and says in a `blocked` note why it
   * refuses any other. Absent, or empty, for a form that offers none.
   */
  actions?: ActionChoice[]
}

/**
 * What the server fills a stamped column with (0153): the signed-in
 * person's id, one of the verified context's attributes by name, or the
 * time the write runs, by the database's own clock.
 */
export type StampValue = { kind: 'actor' } | { kind: 'attribute'; attribute: string } | { kind: 'time' }

/** When the server stamps a column (0153): on a create, on an update, or on both. */
export type StampOn = 'create' | 'update' | 'both'

/** A column the server fills, what with and when (0153), as an administrator confirmed it. */
export interface StampChoice {
  column: string
  value: StampValue
  on: StampOn
}

/** A stamp as the bindings keep it (0153): the choice, and its column's type as the snapshot says. */
export interface StampBinding extends StampChoice {
  type: NormalizedType
}

/**
 * A chain of versions (0113), as the bindings keep it: the columns a version
 * starts and ends at, and the chain's key -- the columns one thing's
 * versions share, a primary or unique key of the root less `from`.
 */
export interface ValidityBinding {
  from: string
  to: string
  key: string[]
}

/**
 * Which writes give a field's columns their values (0027). The two differ when
 * the account may INSERT a column and not UPDATE it, or the reverse: a field
 * written on create only is shown and never written on update, and the server
 * refuses a changed value there (0022).
 */
export interface FieldWrites {
  create: boolean
  update: boolean
}

/**
 * The values a column field is a select of (0152): those `check` lists,
 * each as a record holding it reads back -- a whole number's canonical
 * digits as text -- in the order the field offers them. What drift review
 * compares the check with, and what tells the answer's shape: a select's
 * answer is the value itself, never a number or a yes or no. `domain` is
 * the PostgreSQL domain whose check it is, where it is a domain's (0170):
 * absent on a list of the table's own, and on every binding written before
 * 0170, which reads as it always did.
 */
export interface ListedBinding {
  check: string
  domain?: ObjectRef
  values: string[]
}

/** How one form field reaches the database. */
export type FieldBinding =
  | {
      kind: 'column'
      field: string
      column: string
      type: NormalizedType
      nullable: boolean
      writes: FieldWrites
      /** Present where the field is a select of the values a check lists (0152); absent on every other column field, and on bindings written before it. */
      listed?: ListedBinding
    }
  | {
      kind: 'lookup'
      field: string
      foreignKey: string
      /** The root's columns, in the foreign key's order. */
      columns: string[]
      target: ForeignKeyTarget
      display: string[]
      /** The option-source name the form document carries. */
      source: string
      nullable: boolean
      writes: FieldWrites
      /**
       * The choice's `section` (0109), its condition's column typed as the
       * target holds it; absent for a lookup that is not one. At most one
       * lookup of a form is.
       */
      section?: SectionBinding
      /**
       * The choice's `together` (0155): this form's rows are saved with the
       * record the lookup references; absent for a lookup that is not. At
       * most one lookup of a form is, and it is written on create only.
       */
      together?: TogetherBounds
    }

export interface ConcurrencyBinding {
  kind: 'rowversion' | 'version-column'
  column: string
  /** Database-generated, or confirmed by an administrator. An inferred one is not used. */
  confirmed: boolean
  /** A rowversion's confirmed touch column (0155), the request's `touchColumn`; absent where none is confirmed. */
  touch?: string
}

/**
 * Everything that is not the form: where each field goes, which columns
 * identify a record, how a stale update is detected, and what may be done at
 * all. Kept apart from the form document because the document is portable and
 * this is a property of one database (plan section 9: four separate concerns).
 */
export interface FormBindings {
  /** `BINDINGS_VERSION`. 2 since 0027; a version-1 file is refused, and the form republished. */
  version: 2
  root: ObjectRef
  rootKind: 'table' | 'view'
  /** The columns that identify one record, or `null` when nothing does. */
  identity: string[] | null
  concurrency: ConcurrencyBinding | null
  /**
   * What the form offers besides reading. `delete` since 0050, which the
   * generator always writes: a delete can be made against the table, by
   * this account, with a version that proves the record. Bindings published
   * before 0050 have none, and are compared with the generator at publish
   * only, so every reader asks `offers()`, which reads an absent flag as
   * `false`. What a delete also does to other tables is the policy's to
   * accept (`deleteProblems`), never the generator's.
   */
  operations: { create: boolean; update: boolean; delete?: boolean; supersede?: boolean }
  fields: FieldBinding[]
  /** The chain the rows are versions of (0113); absent for a form whose rows are records of their own. */
  validity?: ValidityBinding
  /**
   * The columns the server stamps (0153), in the root's catalog order;
   * absent for a form that stamps none, so every form published before
   * keeps comparing equal to its regeneration.
   */
  stamps?: StampBinding[]
  /**
   * The actions the form offers (0159), in the request's order, each with
   * its routine, its parameters' sources and its generated dialog; absent
   * for a form that binds none, so every form published before keeps
   * comparing equal to its regeneration.
   */
  actions?: ActionBinding[]
  /** The snapshot this was generated from. Drift review compares against it. */
  snapshotFingerprint: string
}

/**
 * A choice the generator made that a person should know about.
 *
 * `inferred` — decided from metadata, and editable. `excluded` — a column with
 * no field. `read-only` — a field shown and not written, on every operation or
 * on the one named. `blocked` — an operation the form cannot offer, with the
 * reason. `access` — what the database itself limits for this connection: row
 * security on a table the form reads, or a view it cannot follow (0027).
 */
export interface GenerationNote {
  subject: string
  kind: 'inferred' | 'excluded' | 'read-only' | 'blocked' | 'access'
  message: string
}

export interface GeneratedForm {
  form: FormSchema
  bindings: FormBindings
  notes: GenerationNote[]
}
