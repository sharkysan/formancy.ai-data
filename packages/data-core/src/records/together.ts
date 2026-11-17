import type { DatabaseKind } from '../adapter.js'
import { numbersKey, offeredFor, offers } from '../generate/offers.js'
import { stampedOn } from '../generate/stamps.js'
import { togetherOf } from '../generate/together.js'
import type { FormBindings } from '../generate/types.js'
import type { ColumnMeta, MetadataSnapshot } from '../metadata.js'
import { deleteReach } from '../policy/cascades.js'
import { authorizeOperation } from '../policy/evaluate.js'
import { readPolicy } from '../policy/inputs.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { childLookups, parentKey, referencingFields } from './children.js'
import type { ChildLookup, ParentKey, PublishedTable } from './children.js'
import type { MenuBundle, MenuForm } from './menu.js'
import { columnsOf, prepare, type Prepared } from './prepare.js'

/*
 * What the menu and the create route need to know of together children
 * (0155), read from each bundle alone and asking no database: which
 * children require rows of a record, what a person may do with a child's
 * rows in a save of its record, and whether one SQL Server batch can hold
 * the save at all.
 */

/**
 * The most parameters one SQL Server request may bind: 2,100, Microsoft's
 * documented maximum for a procedure's parameters, which `sp_executesql`
 * -- how every statement here travels -- is held to. Taken from that
 * documentation, not measured here; PostgreSQL sends each statement of a
 * save on its own, and has no such limit on a save.
 */
export const SQLSERVER_MAX_PARAMETERS = 2100

/**
 * A together child under a parent in one person's menu (0155): its bounds,
 * and what this person may do with its rows in a save. `created` is a save
 * that creates the record: the child's create in a save under its policy,
 * with the parent's create and a key the save can know before the rows'
 * statements (`MenuSaves.knownKey`). `saved` is a save over a saved record: each of
 * the child's create, update and delete in a save under its policy, each
 * with the parent's update, a confirmed concurrency and, on a rowversion, a
 * confirmed touch column. Every flag is false where the parent's bundle,
 * read alone, cannot carry a save, or one SQL Server batch could not hold
 * the parent's step and every together child's rows.
 */
export interface TogetherChild {
  min: number
  max: number
  created: { create: boolean }
  saved: { create: boolean; update: boolean; delete: boolean }
}

/** A form's together lookup as a menu reads it, whoever the person is: the lookup, its bounds, the writes of its rows this person may make in a save, and what they bind. */
export interface MenuTogether {
  lookup: ChildLookup
  min: number
  max: number
  writes: { create: boolean; update: boolean; delete: boolean }
  /** `row`: the most one change of a row binds (`saveParameters`); `child`: what the child's count and `within` bind besides. */
  parameters: { row: number; child: number }
}

/** What a form's records need of the form itself to carry a save of their rows, read from its bundle alone: its engine, whether a save of rows alone can move a record's version, whether a new record's key can be known before its rows' statements, and what the record's own step binds. */
export interface MenuSaves {
  kind: DatabaseKind
  /** A confirmed version column, or a rowversion with a confirmed touch column that no row filter pins (`pinsTouch`). */
  touch: boolean
  /** Every key column a create of the form writes -- by a field, a pin or a stamp -- or the database numbers (`newKeyPart`). */
  knownKey: boolean
  parameters: number
}

/**
 * How a save that creates a record knows one column of its key before its
 * rows' statements (0155): `'written'` where the record's insert writes it,
 * `'returned'` where the database numbers it and the record's step returns
 * it (`numbersKey`), and `null` where the database fills it any other way
 * -- a default that can repeat, which nothing knows before the insert. One
 * rule for `planSave`, which asks it of the values one create writes, and
 * for the menu, which asks it of every column a create of the form can
 * write, so that the menu offers no create of a record whose rows the
 * planner would refuse.
 */
export function newKeyPart(kind: DatabaseKind, prepared: Prepared, name: string, written: boolean): 'written' | 'returned' | null {
  if (written) return 'written'
  const identity = prepared.target.identity.map((column) => column.name)
  return numbersKey(kind, prepared.root, prepared.columns.get(name) as ColumnMeta, identity) ? 'returned' : null
}

/**
 * Whether `policy`'s row filters pin `touch` (0155): a save of rows alone
 * sets the touch column to itself, and a filter holding it would make the
 * touch a write of a pinned column, so `planSave` refuses such a save and
 * the menu offers none. `false` for a policy that cannot be read, which
 * refuses every operation first.
 */
export function pinsTouch(policy: FormPolicy, touch: string): boolean {
  return readPolicy(policy).parsed?.rowFilters.some((rule) => rule.column === touch) ?? false
}

/** Every column a create of the form can write: a field's written on create, a column the policy's row filters pin, and a stamp on create. */
function createdColumns(bindings: FormBindings, policy: FormPolicy): Set<string> {
  return new Set([
    ...bindings.fields.flatMap((binding) => (binding.writes.create ? columnsOf(binding) : [])),
    ...(readPolicy(policy).parsed?.rowFilters ?? []).map((rule) => rule.column),
    ...stampedOn(bindings.stamps, 'create').map((stamp) => stamp.column),
  ])
}

/** What a SQL Server statement binds besides its values: the table's name and the definition it was decided over (`writeBatch`). */
const STATEMENT = 2

/** How many values a policy's filters bind: a row filter's rules, and each through lookup's. */
function filterParameters(policy: FormPolicy): { rows: number; through: number; lookups: ReadonlyMap<string, number> } | null {
  const parsed = readPolicy(policy).parsed
  if (parsed === null) return null
  const lookups = new Map([...parsed.lookups].map(([field, rules]) => [field, rules.length]))
  return { rows: parsed.rowFilters.length, through: parsed.through.reduce((sum, field) => sum + (lookups.get(field) ?? 0), 0), lookups }
}

/** The values a create or an update of one record of the form writes at most: every column a field writes on it, the pinned columns on create, and the stamps of who. */
function written(bindings: FormBindings, operation: 'create' | 'update', pinned: number): number {
  const columns = bindings.fields.reduce((sum, binding) => sum + (binding.writes[operation] ? columnsOf(binding).length : 0), 0)
  const who = stampedOn(bindings.stamps, operation).filter((stamp) => stamp.value.kind !== 'time').length
  return columns + who + (operation === 'create' ? pinned : 0)
}

/**
 * The most parameters one change of a row of a together child binds in a
 * SQL Server save (0155): a prediction of the batch the adapter builds,
 * read from data-sqlserver's statements on 2026-11-15, which the batch of
 * every save data-sqlserver's save suite plans, and each size its sized
 * suite saves, is held to -- the batch binds
 * less, since it binds a table's name and definition, and a delete's
 * reach, once rather than per row.
 * The most of the
 * create, update and delete the form offers: each value it writes, its
 * key, its version, every filter and through value, one per foreign-key
 * column of its record, the table's name and definition, and for a delete
 * every table, key and column its reach binds. `Infinity` for a policy
 * that cannot be read, which no batch holds.
 */
export function saveParameters(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): number {
  const filters = filterParameters(policy)
  if (filters === null) return Number.POSITIVE_INFINITY
  const together = togetherOf(bindings)
  const pin = together === null || together === 'malformed' ? 0 : together.binding.columns.length
  const located = (bindings.identity ?? []).length + 1 + filters.rows + filters.through + pin
  const reach = deleteReach(snapshot, bindings.root, policy).reach
  const reached = 2 * reach.removed.length + 4 * reach.accepted.length + reach.cleared.reduce((sum, entry) => sum + 1 + 2 * entry.columns.length, 0)
  const each = [
    offers(bindings, 'create') ? written(bindings, 'create', filters.rows) : 0,
    offers(bindings, 'update') ? written(bindings, 'update', 0) + located : 0,
    offers(bindings, 'delete') ? located + reached : 0,
  ]
  return STATEMENT + Math.max(...each)
}

/**
 * Why a together child's policy would let a person read some of a record's
 * rows and not others, or a parent's would pin its touch column -- each a
 * sentence for the bundle check, on publish and on every read (0155):
 *
 * - a row filter on a column outside the together lookup's foreign key, or
 *   a through by any other field: every row of a record is then read by a
 *   person or none is, so a count of what they read is every row the
 *   record has, and a bound the page states holds for whoever reads it;
 * - a row filter on the touch column, which every save of rows alone sets
 *   to itself (`pinsTouch`).
 *
 * `[]` for a policy that cannot be read, which `validatePolicy` reports.
 */
export function togetherPolicyProblems(bindings: FormBindings, policy: FormPolicy): string[] {
  const parsed = readPolicy(policy).parsed
  if (parsed === null) return []
  const problems: string[] = []
  const touch = bindings.concurrency?.touch
  if (typeof touch === 'string' && pinsTouch(policy, touch))
    problems.push(`rowFilters: ${touch} is the touch column, which every save of this form's rows alone sets to itself; a row filter cannot pin it`)
  const together = togetherOf(bindings)
  if (together === null || together === 'malformed') return problems
  const { field, columns } = together.binding
  for (const rule of parsed.rowFilters) {
    if (!columns.includes(rule.column))
      problems.push(
        `rowFilters: ${rule.column} is outside ${field}'s foreign key, and ${field} is saved with its record: a person could read some of a record's rows and not others, and its bound would count rows they do not see`,
      )
  }
  for (const through of parsed.through) {
    if (through !== field)
      problems.push(
        `through: ${through} scopes the rows by another field than ${field}, which is saved with its record: a person could read some of a record's rows and not others`,
      )
  }
  return problems
}

/**
 * Why one SQL Server batch could not hold a save of a together child's
 * `max` rows, or `null` (0155): the most one change of a row binds
 * (`saveParameters`), `max` times, past `SQLSERVER_MAX_PARAMETERS`. Asked
 * at publish, of the child's bundle alone; the menu holds the parent's step
 * and every together child's rows to the limit together, and the adapter
 * refuses a batch past it before it is sent. `null` on PostgreSQL, which
 * sends each statement on its own; for bindings with no together lookup a
 * save could hold; and for a policy that cannot be read, which
 * `validatePolicy` reports and the bundle check refuses before the publish
 * gate asks, as `togetherPolicyProblems` leaves it to them.
 */
export function togetherBatchProblem(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string | null {
  if (snapshot.kind !== 'sqlserver') return null
  const together = togetherOf(bindings)
  if (together === null || together === 'malformed' || readPolicy(policy).parsed === null) return null
  const each = saveParameters(snapshot, bindings, policy)
  if (together.max * each <= SQLSERVER_MAX_PARAMETERS) return null
  const fits = Math.floor(SQLSERVER_MAX_PARAMETERS / each)
  return `${together.binding.field} is saved with its record up to ${String(together.max)} rows, and one change of a row binds up to ${String(each)} parameters on SQL Server, past the ${String(SQLSERVER_MAX_PARAMETERS)} one batch holds; a max of ${String(fits)} or less fits`
}

/** What a child binds once in a save besides its rows: its count -- the record, its read filters and throughs, `min`, `max` and the limit -- and its `within`, the record under the lookup's filter. */
function childParameters(policy: FormPolicy, field: string, pin: number): number {
  const filters = filterParameters(policy)
  if (filters === null) return Number.POSITIVE_INFINITY
  return STATEMENT + pin + filters.rows + filters.through + 3 + pin + (filters.lookups.get(field) ?? 0)
}

/** `bundle`'s together lookup as the menu reads it, for this person: `null` where it has none, or one no save could be planned from. */
export function menuTogether(bundle: MenuBundle, context: PolicyContext): MenuTogether | null {
  const together = togetherOf(bundle.bindings)
  if (together === null || together === 'malformed') return null
  const field = together.binding.field
  const lookup = childLookups(bundle).find((entry) => entry.field === field) as ChildLookup
  const may = (operation: 'create' | 'update' | 'delete'): boolean =>
    offeredFor(bundle.bindings, operation, { save: field }) && authorizeOperation(bundle.policy, context, operation).ok
  return {
    lookup,
    min: together.min,
    max: together.max,
    writes: { create: may('create'), update: may('update'), delete: may('delete') },
    parameters: {
      row: saveParameters(bundle.snapshot, bundle.bindings, bundle.policy),
      child: childParameters(bundle.policy, field, together.binding.columns.length),
    },
  }
}

/**
 * What `bundle`'s records need of the form itself to carry a save of their
 * rows (0155), or `null` where they cannot: bindings that do not fit their
 * snapshot, no key a token carries, a form over versions, or one whose own
 * rows are saved with another record, since a save is one level deep.
 */
export function menuSaves(bundle: MenuBundle): MenuSaves | null {
  const ready = prepare(bundle.snapshot, bundle.bindings)
  if (!ready.ok || !ready.prepared.addressable || togetherOf(bundle.bindings) !== null || bundle.bindings.validity !== undefined) return null
  const { prepared } = ready
  const filters = filterParameters(bundle.policy)
  const concurrency = prepared.target.concurrency
  const touch = bundle.bindings.concurrency?.touch
  const created = createdColumns(bundle.bindings, bundle.policy)
  const identity = prepared.target.identity.length
  const step =
    filters === null
      ? Number.POSITIVE_INFINITY
      : Math.max(written(bundle.bindings, 'create', filters.rows), written(bundle.bindings, 'update', 0) + identity + 1 + filters.rows + filters.through)
  return {
    kind: bundle.snapshot.kind,
    touch: concurrency !== null && (concurrency.kind === 'version-column' || (touch !== undefined && !pinsTouch(bundle.policy, touch))),
    knownKey: prepared.target.identity.every((column) => newKeyPart(bundle.snapshot.kind, prepared, column.name, created.has(column.name)) !== null),
    // The record's step, its key read back, and the deadline.
    parameters: STATEMENT + step + identity + 1,
  }
}

/** Whether a together lookup requires rows of the records `key` spells: it references them, and its `min` is at least 1. */
function requires(key: ParentKey | null, lookup: ChildLookup, min: number): boolean {
  return min >= 1 && referencingFields(key, [lookup]).length > 0
}

/**
 * The together lookups of `forms` that require rows of `parent`'s records
 * (0155): each form on the parent's connection whose together lookup
 * references them (`referencingFields`) with a `min` of at least 1, each
 * bundle read alone, whoever the person is -- a bound applies to everyone.
 * The menu leaves out the parent's create where the person could not make
 * that save (`formMenu`), and the parent's create route refuses a plain
 * create where one is found: such a record is created with its rows, in a
 * save, which is planned with the children this finds (`planSave`).
 */
export function rowsRequired<T extends PublishedTable>(
  parent: PublishedTable,
  forms: readonly T[],
): Array<{ form: T; field: string; min: number; max: number }> {
  const key = parentKey(parent)
  return forms.flatMap((form) => {
    const together = togetherOf(form.bindings)
    if (together === null || together === 'malformed') return []
    const lookup = childLookups(form).find((entry) => entry.field === together.binding.field) as ChildLookup
    return requires(key, lookup, together.min) ? [{ form, field: lookup.field, min: together.min, max: together.max }] : []
  })
}

/**
 * Each together child of `parent` among `forms`, whether or not this
 * person may read it, with its `TogetherChild` for them. On SQL Server the
 * flags hold only while the parent's step, every together child's `max`
 * rows and each child's count and `within` fit one batch
 * (`SQLSERVER_MAX_PARAMETERS`): a parent republished with more fields can
 * turn every flag off.
 */
export function togetherChildren(
  parent: MenuForm,
  forms: readonly MenuForm[],
): Array<{ form: MenuForm; field: string; required: boolean; together: TogetherChild }> {
  const children = forms.flatMap((form) =>
    form.together !== null && referencingFields(parent.key, [form.together.lookup]).length > 0 ? [{ form, together: form.together }] : [],
  )
  const saves = parent.saves
  const bound = children.reduce((sum, { together }) => sum + together.max * together.parameters.row + together.parameters.child, saves?.parameters ?? 0)
  const carries = saves !== null && (saves.kind !== 'sqlserver' || bound <= SQLSERVER_MAX_PARAMETERS)
  const creates = carries && saves.knownKey && parent.operations.includes('create')

  const updates = carries && saves.touch && parent.operations.includes('update')
  return children.map(({ form, together }) => ({
    form,
    field: together.lookup.field,
    required: requires(parent.key, together.lookup, together.min),
    together: {
      min: together.min,
      max: together.max,
      created: { create: creates && together.writes.create },
      saved: { create: updates && together.writes.create, update: updates && together.writes.update, delete: updates && together.writes.delete },
    },
  }))
}
