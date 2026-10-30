import type { FieldBinding, FormBindings } from '../generate/types.js'
import { SEARCHABLE_KINDS } from '../lookup/searchable.js'
import type { LookupSearchColumn, RowFilters } from '../lookup/types.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedTypeKind } from '../metadata.js'
import { readableFields } from '../policy/evaluate.js'
import { unscopedLookups } from '../policy/through.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { viewFit } from '../presentation/views.js'
import type { FilterableField, ListColumns, ListView, RecordList, RecordListQuery } from '../runtime.js'
import { lookupAnswer, toFormAnswers } from './answers.js'
import { columnFilter, filterOffer } from './filter.js'
import type { PlannedList, PlanRefusal } from './plan-types.js'
import { columnsOf, keyOrderProblem, prepare, type Prepared, refuse, unaddressable } from './prepare.js'
import { filtersFor, readColumns, throughFor } from './scope.js'
import type { ListRequest, RecordFilter, RecordRead, RecordSort, RecordValue, Through } from './types.js'

/*
 * A form's records, a page at a time (0044): when a list is offered at all,
 * what it may be sorted and searched by, and the one request an adapter
 * runs for a page. A list is a read of many records, so it is a read's
 * policy -- `operations.read`, the root's read filter and every through, the
 * readable fields' columns and the key -- and no grant of its own: each row
 * is exactly what a read by its token returns.
 *
 * Pure and isomorphic, as the other planners are (plan.ts).
 */

/** No canonical text: nothing a portable order can rely on (`lookup/config.ts`'s rule for a lookup's order). */
const UNORDERED: ReadonlySet<NormalizedTypeKind> = new Set(['binary', 'rowversion', 'unsupported'])

type ColumnBinding = Extract<FieldBinding, { kind: 'column' }>

/** What `listable` hands the planner: the bindings as checked, the actor's scope, and the fields they may read. */
export interface Listable {
  ok: true
  prepared: Prepared
  filters: RowFilters
  through: Through[]
  /** The field keys the actor may read, in the bindings' order. */
  fields: string[]
}

/**
 * Whether this actor may list this form's records, and the scope they list
 * them under -- or why not. `GET /v1/forms/:id` and `planList` both ask this,
 * so a page is never offered a list the server would refuse.
 *
 * In this order: the bindings against their snapshot; the read filter and
 * every through, which authorise the read and scope it; the readable fields;
 * a key a token can carry; a key the snapshot holds NOT NULL; rows something
 * scopes; and every key column in a field the actor may read, or pinned by
 * their read filter. The policy comes before anything about the table, so a
 * person it does not let read is told only that, as `GET` tells them.
 *
 * A key that can be NULL -- a nullable unique key, which PostgreSQL lets hold
 * many NULLs -- gives rows tied on it no order, so offset paging would repeat
 * or skip them. Refused on both engines, by the snapshot; a page decided over
 * its own description asks again (`driftRefusal`'s `list`).
 *
 * Rows nothing scopes -- no row filter, no through -- while a lookup's
 * options are filtered (`unscopedLookups`) are what a child form looked like
 * before `through` (0043): a read reaches another tenant's row only by a
 * token somebody guesses, and a list would hand every one of them out at
 * once. Refused, though the policy may mean it.
 *
 * A key column in a field the actor may not read is refused too: every
 * listed row's token spells its key, and a list hands out a token for every
 * row it admits, where a read hands back only the token the caller sent. A
 * pinned column counts as read: its value is the actor's own attribute.
 */
export function listable(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, context: PolicyContext): Listable | PlanRefusal {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  const filters = filtersFor(prepared, policy, context, 'read')
  if (!filters.ok) return filters
  const through = throughFor(snapshot, bindings, prepared, policy, context, 'read')
  if (!through.ok) return through
  const readable = readableFields(policy, context, bindings)
  if (!readable.ok) return readable
  if (!prepared.addressable) return unaddressable(prepared)
  // prepare holds the identity to a key of the snapshot's root, so only a key column that can be NULL refuses here.
  if (
    keyOrderProblem(
      prepared.root,
      prepared.target.identity.map((column) => column.name),
    ) !== null
  ) {
    return refuse('operation-unavailable', "This form's key can be NULL, so its records have no order a page can rely on.")
  }
  const unscoped = unscopedLookups(bindings, policy)
  if (unscoped.length > 0) {
    return refuse(
      'operation-unavailable',
      `Nothing scopes this form's records, though the options of ${unscoped.join(' and ')} are filtered, so they are not listed.`,
    )
  }
  const seen = new Set(filters.filter.map((term) => term.column))
  const wanted = new Set(readable.fields)
  for (const binding of bindings.fields) if (wanted.has(binding.field)) for (const name of columnsOf(binding)) seen.add(name)
  if (!prepared.target.identity.every((column) => seen.has(column.name))) {
    return refuse('field-denied', "This form's records are named by fields you may not read, so they are not listed for you.")
  }
  return { ok: true, prepared, filters: filters.filters, through: through.through, fields: readable.fields }
}

/** The readable column fields of the form, in the bindings' order: the only fields a list sorts, searches or filters by. A lookup field holds a token, not the label a person reads. */
function readableColumns(bindings: FormBindings, fields: readonly string[]): ColumnBinding[] {
  const wanted = new Set(fields)
  return bindings.fields.filter((binding): binding is ColumnBinding => binding.kind === 'column' && wanted.has(binding.field))
}

/**
 * What a list of this form may be sorted, searched and filtered by, for an
 * actor who may read `fields`: one decision, so what `GET /v1/forms/:id`
 * offers is what `planList` accepts. Sortable: every readable column field
 * whose kind has canonical text. Searchable: those whose kind is in
 * `lookup/searchable.ts`'s set, the kinds a lookup's search matches, matched
 * as it matches (0028). Filterable: those `filterOffer` offers a condition
 * on, with what it offers (0104).
 *
 * Views: those of `views`, the published ones, that this actor could have
 * built from the rest (`viewFit`, 0105), in their published order. A view
 * naming a field they may not read is not offered at all, never offered
 * without that condition, which would show a wider list under the view's
 * name; and a default whose view is not offered leaves the list with none.
 */
export function listColumns(bindings: FormBindings, fields: readonly string[], views: readonly ListView[]): ListColumns {
  const columns = readableColumns(bindings, fields)
  const filterable: FilterableField[] = []
  for (const binding of columns) {
    const offer = filterOffer(binding)
    if (offer !== null) filterable.push({ field: binding.field, ...offer })
  }
  const sortable = columns.filter((binding) => !UNORDERED.has(binding.type.kind)).map((binding) => binding.field)
  return {
    searchable: columns.filter((binding) => SEARCHABLE_KINDS.has(binding.type.kind)).map((binding) => binding.field),
    sortable,
    filterable,
    views: views.filter((view) => viewFit(view, bindings, { filterable, sortable }) === null),
  }
}

/**
 * Every view of `views` that no actor could build from this form's list, each
 * with why, prefixed by where it is: what a write refuses (0105). A view is
 * fitted against every field the bindings hold, so one only a few may read
 * is stored, and offered to those few.
 */
export function viewProblems(views: readonly ListView[], bindings: FormBindings): string[] {
  const all = listColumns(
    bindings,
    bindings.fields.map((binding) => binding.field),
    [],
  )
  return views.flatMap((view, index) => {
    const why = viewFit(view, bindings, all)
    return why === null ? [] : [`/views/${String(index)} (“${view.name}”): ${why}`]
  })
}

/**
 * The order a list runs in, made total: the requested columns, then every
 * identity column the request did not name, ascending. Without the key, a
 * page boundary can fall between two rows that sort equal, and offset paging
 * shows one twice and the other never; a key column the request names is
 * not named again.
 *
 * NULLs go last, the lookups' rule, spelled only where the snapshot says the
 * column is nullable: a NOT NULL column holds none, and spelled with no
 * placement an index on it serves the order on either engine. A lookup
 * spells it on every column (0012); while the database matches its snapshot
 * the two differ in spelling, never in order.
 */
export function listOrder(prepared: Prepared, requested: ReadonlyArray<{ column: string; direction: 'asc' | 'desc' }>): RecordSort[] {
  const nulls = (name: string): RecordSort['nulls'] => ((prepared.columns.get(name) as ColumnMeta).nullable ? 'last' : null)
  const sort: RecordSort[] = requested.map((term) => ({ column: term.column, direction: term.direction, nulls: nulls(term.column) }))
  const named = new Set(sort.map((term) => term.column))
  for (const column of prepared.target.identity) if (!named.has(column.name)) sort.push({ column: column.name, direction: 'asc', nulls: nulls(column.name) })
  return sort
}

/**
 * The parent a list is narrowed to: the root's foreign-key columns of a
 * lookup the actor may read, each with the value the parent's token names.
 * The token is decoded by `lookupAnswer`, the one decision about whether a
 * token is a value of that lookup, through the root columns' codecs: a value
 * those columns cannot hold, such as an int8 for an int4 foreign key, names
 * no row of theirs and is refused.
 */
function parentEqual(
  prepared: Prepared,
  bindings: FormBindings,
  fields: readonly string[],
  parent: RecordListQuery['parent'],
): { ok: true; equal: RecordValue[] } | PlanRefusal {
  if (parent === null) return { ok: true, equal: [] }
  const binding = bindings.fields.find((candidate) => candidate.field === parent.field)
  if (binding === undefined || binding.kind !== 'lookup' || !fields.includes(parent.field)) {
    return refuse('invalid-request', `${parent.field} is not a lookup field you may read, so it cannot name a parent.`)
  }
  const decoded = lookupAnswer(
    binding,
    binding.columns.map((name) => prepared.columns.get(name) as ColumnMeta),
    parent.record,
    new Map(),
  )
  if (!decoded.ok) return refuse('invalid-record-token', `The parent's record is not a token of a row ${parent.field} can reference.`)
  return { ok: true, equal: decoded.values }
}

/**
 * One page of this form's records for `query`, under the actor's read scope
 * -- or why not.
 *
 * Checks, in this order: everything `listable` checks; that every sort field
 * is one `listColumns` calls sortable (`not-sortable`); that every filter
 * condition is on a readable column field, one its column offers, with
 * values it can hold (`not-filterable`, 0104); that a search has a field to
 * match (`not-searchable`); and the parent. Each row the adapter returns is
 * read as `planRead` would read it, the key and the readable fields'
 * columns and nothing else.
 */
export function planList(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, context: PolicyContext, query: RecordListQuery): PlannedList {
  const found = listable(snapshot, bindings, policy, context)
  if (!found.ok) return found
  const { prepared, fields } = found
  const offered = listColumns(bindings, fields, [])
  const byField = new Map(readableColumns(bindings, fields).map((binding) => [binding.field, binding]))

  const requested: Array<{ column: string; direction: 'asc' | 'desc' }> = []
  for (const term of query.sort) {
    const binding = byField.get(term.field)
    if (binding === undefined || !offered.sortable.includes(term.field))
      return refuse('not-sortable', `${term.field} is not a field you may sort this list by.`)
    requested.push({ column: binding.column, direction: term.direction })
  }
  const filter: RecordFilter[] = []
  for (const term of query.filter) {
    const binding = byField.get(term.field)
    if (binding === undefined) return refuse('not-filterable', `${term.field} is not a field you may filter this list by.`)
    const planned = columnFilter(prepared.columns.get(binding.column) as ColumnMeta, term, term.field)
    if (!planned.ok) return refuse('not-filterable', planned.message)
    filter.push(planned.filter)
  }
  if (query.search !== '' && offered.searchable.length === 0) return refuse('not-searchable', 'This form has no field you may read that a search can match.')
  const parent = parentEqual(prepared, bindings, fields, query.parent)
  if (!parent.ok) return parent

  const search = offered.searchable.map((field): LookupSearchColumn => {
    const column = (byField.get(field) as ColumnBinding).column
    return { name: column, type: (prepared.columns.get(column) as ColumnMeta).type as LookupSearchColumn['type'] }
  })
  const request: ListRequest = {
    target: prepared.target,
    columns: readColumns(prepared, bindings, fields),
    filters: found.filters,
    through: found.through,
    equal: parent.equal,
    filter,
    search: query.search === '' ? null : { text: query.search, columns: search },
    sort: listOrder(prepared, requested),
    offset: query.offset,
    limit: query.limit,
  }
  return { ok: true, request, fields }
}

/**
 * One page as the API carries it, from the rows an adapter fetched for it:
 * up to `limit + 1`, in the request's order. Each row is what `toFormAnswers`
 * makes of a read of it, so a listed record is the record its token reads.
 *
 * The extra row says whether more follow, without a COUNT, and is never
 * shown. A row whose key does not fit a token stays in its place with
 * `record: null`: dropped, it would shift every row after it on a page whose
 * arithmetic a grid relies on. A token twice on one page is an adapter that
 * joined wrongly, and is thrown here, where the message can say so.
 */
export function recordPage(bindings: FormBindings, fields: readonly string[], rows: ReadonlyArray<Omit<RecordRead, 'ok'>>, limit: number): RecordList {
  const page = rows.slice(0, limit).map((row) => toFormAnswers(bindings, fields, { ok: true, ...row }))
  const seen = new Set<string>()
  for (const row of page) {
    if (row.record === null) continue
    if (seen.has(row.record)) throw new Error('A record appears twice in one page: the list statement repeats a row.')
    seen.add(row.record)
  }
  return { rows: page, hasMore: rows.length > limit }
}
