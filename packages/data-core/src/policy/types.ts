/**
 * Who is asking, as the host established it after verifying their identity.
 *
 * TRUSTED, and never built from request input. The host authenticates the
 * caller — a session, a token whose signature it checked — and derives the
 * actor and the attributes from what it verified, on the server. A tenant read
 * from a request body, from a header the browser sets or from a token nobody
 * verified is the forged context this module exists to stop, and nothing in a
 * pure function can tell that difference. That half of the contract is the
 * host's (0011).
 *
 * `attributes` holds what row filters compare with — `tenant`, `region` — one
 * string per name, so an actor who belongs to two tenants acts in one at a time.
 */
export interface PolicyContext {
  actor: { id: string; roles: string[] }
  attributes: Record<string, string>
}

/**
 * What a policy grants roles. `delete` since 0050: one record at a time, by
 * its token and the version its person read, scoped as an update is.
 */
export type PolicyOperation = 'read' | 'create' | 'update' | 'delete'

/**
 * "This column must equal this trusted attribute": tenant isolation.
 *
 * Equality with a value from the context, and nothing more expressive, on
 * purpose. A column from approved metadata and a value bound as a parameter is
 * the one row filter that can never become SQL somebody wrote.
 */
export interface RowFilterRule {
  column: string
  attribute: string
}

/** The roles that may see a field's value, and the roles that may submit one. */
export interface FieldPolicy {
  read: string[]
  write: string[]
}

/**
 * Who may do what with one published form, kept apart from the form and its
 * bindings (plan section 9: four separate concerns).
 *
 * Deny by default, everywhere. An operation lists the roles that may perform
 * it; a field with no entry in `fields` is readable and writable by nobody; a
 * lookup with no entry in `lookups` offers nothing. There is no wildcard role:
 * "any authenticated actor" is a role the host gives them.
 *
 * `rowFilters` scope the root table. On read and update they are the filter;
 * on create they are the values the pinned columns are written with, from the
 * context and never from the request. `[]` is a statement — this table is not
 * per tenant — and it has to be written: a policy without the property is
 * refused.
 *
 * `lookups` scope each lookup field's TARGET table in the same shape, keyed by
 * field key. `[]` says the target is shared by every tenant.
 *
 * `through` names lookup fields whose target's filter also scopes the root
 * (0043): a record exists for read and update only when the row each one
 * references is one that lookup's filter admits, and a create must name such
 * a row. It is how a child table with no tenant column of its own -- an
 * order's lines -- is kept to the tenant of its parent. Optional, and absent
 * means none: a policy written before it means exactly what it meant, and a
 * server older than it refuses a policy that uses it, as it refuses every
 * property it does not read.
 *
 * `operations.delete` lists the roles that may delete a record (0050).
 * Optional, and absent means nobody, for the same reason: a policy written
 * before it keeps its meaning, and a server older than it refuses a policy
 * that grants it. A delete is scoped by `rowFilters` and every `through`, as
 * an update is, and grants no field: it writes none. Every role it lists
 * must be granted read, because a delete names the version its person read.
 *
 * `cascades` names each foreign key a delete may act through, with what it
 * does (0051): optional, absent is none, and refused while nobody may
 * delete.
 */
export interface FormPolicy {
  version: 1
  operations: { read: string[]; create: string[]; update: string[]; delete?: string[] }
  fields: Record<string, FieldPolicy>
  rowFilters: RowFilterRule[]
  lookups: Record<string, RowFilterRule[]>
  through?: string[]
  cascades?: CascadeRule[]
  transitions?: TransitionRule
}

/**
 * A field whose value is a state, and the moves between its states that
 * roles may make (0112). Where a policy names one, every change of the
 * field is a move it lists: an update from the value the record holds to
 * the one submitted, a create -- `from: null` -- to the value it gives. A
 * role still needs write on the field and the operation; a move only
 * narrows what those grant. A create that leaves the field out is the
 * column's default, the schema's own start, and moves nothing.
 *
 * Optional, and absent means no rule: a policy written before it keeps
 * its meaning, and a server older than it refuses a policy that names one.
 */
export interface TransitionRule {
  field: string
  moves: TransitionMove[]
}

/** One move of a state field: from a value, or from nothing on create, to a value, for these roles. */
export interface TransitionMove {
  from: string | null
  to: string
  roles: string[]
}

/** What a foreign key does on delete to the rows that refer to the record deleted, where it does anything: deletes them, or sets their reference to NULL or to its default. */
export type DeleteAction = 'cascade' | 'set-null' | 'set-default'

/**
 * One foreign key a delete of the form's records may act through (0051):
 * the table the key is on, its name, and what it does on delete. A server
 * older than 0051 refuses a policy that names one, as it refuses every
 * property it does not read.
 *
 * The key's table as two parts, never a dotted string, since an identifier
 * may hold a dot (0016). Its action as well as its name: a key accepted as
 * a cascade that has become SET NULL does something else, which nobody
 * accepted. Every key a delete reaches through that acts on delete must be
 * named, and nothing else may be (`deleteProblems`). The rows it reaches
 * are asked of no form's policy -- the database deletes or clears them --
 * and naming the key is how an administrator says they know it.
 */
export interface CascadeRule {
  table: { schema: string; name: string }
  foreignKey: string
  onDelete: DeleteAction
}

/**
 * Columns and the values they must equal: a filter on read, update and lookup,
 * and the values a create writes. Every column is an identifier from approved
 * metadata, quoted by the adapter; every value is bound as a parameter.
 */
export type RowFilter = ReadonlyArray<{ column: string; value: string }>

/**
 * Why a request was refused, stable enough for an API to map to a response.
 *
 * `invalid-context` — the context is not the shape a host builds.
 * `invalid-policy` — the policy is malformed, or does not fit the form.
 * `operation-denied` — no role of the actor's grants the operation.
 * `missing-attribute` — a row filter needs an attribute the context lacks.
 * `over-posting` — a submitted key the actor may not write.
 * `field-denied` — a lookup on a field the actor may neither read nor write.
 * `unknown-lookup` — the policy says nothing about which rows a lookup offers.
 * `transition-denied` — a change of a state field that is no move the
 *   actor's roles may make (0112).
 */
export type PolicyRefusalCode =
  'invalid-context' | 'invalid-policy' | 'operation-denied' | 'missing-attribute' | 'over-posting' | 'field-denied' | 'unknown-lookup' | 'transition-denied'

export interface PolicyRefusal {
  ok: false
  code: PolicyRefusalCode
  /** A sentence for a log or an administrator. It names keys, columns and attributes, never their values. */
  message: string
}

export type PolicyDecision = { ok: true } | PolicyRefusal

export type ReadableFields = { ok: true; fields: string[] } | PolicyRefusal

export type RowFilterResult = { ok: true; filter: RowFilter } | PolicyRefusal

export type ForcedValues = { ok: true; values: RowFilter } | PolicyRefusal

/** Each lookup a policy's `through` names, with its filter on the lookup's target resolved from the context (0043). */
export type ThroughFilters = { ok: true; through: Array<{ field: string; filter: RowFilter }> } | PolicyRefusal

/** Every problem found, not only the first, because a person fixes a policy from this list. */
export type PolicyValidation = { ok: true } | { ok: false; code: 'invalid-policy'; message: string; problems: string[] }
