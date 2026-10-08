import type { FormSchema } from '@formancy/spec'
import type { ForeignKeyTarget, NormalizedType, ObjectRef } from '../metadata.js'

/** A foreign key of the root offered as a lookup, and the target columns a person recognises a row by. */
export interface LookupChoice {
  foreignKey: string
  display: string[]
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
}

/** How one form field reaches the database. */
export type FieldBinding =
  | {
      kind: 'column'
      field: string
      column: string
      type: NormalizedType
      nullable: boolean
      writable: boolean
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
      writable: boolean
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
  version: 1
  root: ObjectRef
  rootKind: 'table' | 'view'
  /** The columns that identify one record, or `null` when nothing does. */
  identity: string[] | null
  concurrency: ConcurrencyBinding | null
  operations: { create: boolean; update: boolean }
  fields: FieldBinding[]
  /** The snapshot this was generated from. Drift review compares against it. */
  snapshotFingerprint: string
}

/**
 * A choice the generator made that a person should know about.
 *
 * `inferred` — decided from metadata, and editable. `excluded` — a column with
 * no field. `read-only` — a field shown and never written. `blocked` — an
 * operation the form cannot offer, with the reason.
 */
export interface GenerationNote {
  subject: string
  kind: 'inferred' | 'excluded' | 'read-only' | 'blocked'
  message: string
}

export interface GeneratedForm {
  form: FormSchema
  bindings: FormBindings
  notes: GenerationNote[]
}
