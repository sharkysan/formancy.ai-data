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

export type PolicyOperation = 'read' | 'create' | 'update'

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
 */
export interface FormPolicy {
  version: 1
  operations: { read: string[]; create: string[]; update: string[] }
  fields: Record<string, FieldPolicy>
  rowFilters: RowFilterRule[]
  lookups: Record<string, RowFilterRule[]>
  through?: string[]
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
 */
export type PolicyRefusalCode =
  | 'invalid-context'
  | 'invalid-policy'
  | 'operation-denied'
  | 'missing-attribute'
  | 'over-posting'
  | 'field-denied'
  | 'unknown-lookup'

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
