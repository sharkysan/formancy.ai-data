import type { FormSchema } from '@formancy/spec'
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
   * Root columns the form's policy pins to trusted context — the tenant
   * column, typically (0011). The request never supplies them: on create they
   * come from the verified identity, and a submitted value is over-posting. So
   * the generated field for one is shown and never written, and is not a
   * required field a person could not fill. Found when the planner (0018) met
   * the generator: without this, a pinned NOT NULL column was a required field
   * the policy refused, and no submission could pass both.
   */
  pinned?: string[]
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

/** How one form field reaches the database. */
export type FieldBinding =
  | {
      kind: 'column'
      field: string
      column: string
      type: NormalizedType
      nullable: boolean
      writes: FieldWrites
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
    }

export interface ConcurrencyBinding {
  kind: 'rowversion' | 'version-column'
  column: string
  /** Database-generated, or confirmed by an administrator. An inferred one is not used. */
  confirmed: boolean
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
  operations: { create: boolean; update: boolean; delete?: boolean }
  fields: FieldBinding[]
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
