import type { FieldBinding, FormBindings } from '../generate/types.js'
import { SEARCHABLE_KINDS } from '../lookup/searchable.js'
import type { LookupSearchColumn, RowFilters } from '../lookup/types.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedTypeKind } from '../metadata.js'
import { readableFields } from '../policy/evaluate.js'
import { unscopedLookups } from '../policy/through.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { storedViewFit, viewFit } from '../presentation/views.js'
import type { FilterableField, ListColumns, ListView, RecordList, RecordListQuery, StoredListView } from '../runtime.js'
import { lookupAnswer, toFormAnswers } from './answers.js'
import { ownViewsOffered } from './own-views.js'
import { decodeListCursor, listCursor } from './cursor.js'
import { columnFilter, filterOffer } from './filter.js'
import { lookupFilter, lookupFilterOffer } from './lookup-filter.js'
import type { PlannedList, PlanRefusal } from './plan-types.js'
import { columnsOf, keyOrderProblem, prepare, type Prepared, refuse, unaddressable } from './prepare.js'
import { type RelatedField, relatedFilters } from './related-filter.js'
import { filtersFor, reachedLookups, readColumns, relatedFieldsOf, sortLabelsOf, throughFor } from './scope.js'
import type { ListOutcome, ListRequest, ListSort, RecordFilter, RecordRead, RecordSort, RecordValue, SortLabel, Through } from './types.js'

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
  /** The lookups of those this actor may order a list by, each with its label (`sortLabelsOf`, 0136). */
  labels: Map<string, SortLabel>
  /** The fields this actor may filter a list by through those lookups (`relatedFieldsOf`, 0139). */
  related: RelatedField[]
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
 * many NULLs -- gives rows tied on it no order, and a page could not
 * continue after a row it cannot find by its key (0108). Refused on both
 * engines, by the snapshot; a page decided over its own description asks
 * again (`driftRefusal`'s `list`).
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
  const reached = reachedLookups(snapshot, bindings, prepared, policy, context, readable.fields)
  return {
    ok: true,
    prepared,
    filters: filters.filters,
    through: through.through,
    fields: readable.fields,
    labels: sortLabelsOf(reached),
    related: relatedFieldsOf(reached),
  }
}

/** The readable column fields of the form, in the bindings' order: the fields a list sorts, searches or filters by as columns. A lookup field holds a token, not the label a person reads: it is filtered by its record (0135) and sorted by its label (0136). */
function readableColumns(bindings: FormBindings, fields: readonly string[]): ColumnBinding[] {
  const wanted = new Set(fields)
  return bindings.fields.filter((binding): binding is ColumnBinding => binding.kind === 'column' && wanted.has(binding.field))
}

/** The lookup field `field` binds, where the actor may read it. */
function readableLookup(bindings: FormBindings, fields: readonly string[], field: string): Extract<FieldBinding, { kind: 'lookup' }> | undefined {
  const binding = bindings.fields.find((candidate) => candidate.field === field)
  return binding?.kind === 'lookup' && fields.includes(field) ? binding : undefined
}

/** What `listColumns` offers besides the readable fields and the published views. */
export interface ListOffers {
  unfiltered?: readonly string[]
  own?: readonly ListView[]
  labelled?: readonly string[]
  related?: readonly RelatedField[]
}

/**
 * What a list of this form may be sorted, searched and filtered by, for an
 * actor who may read `fields`: one decision, so what `GET /v1/forms/:id`
 * offers is what `planList` accepts. Sortable: every readable column field
 * whose kind has canonical text. Searchable: those whose kind is in
 * `lookup/searchable.ts`'s set, the kinds a lookup's search matches, matched
 * as it matches (0028). Filterable: those `filterOffer` offers a condition
 * on, with what it offers (0104), and every readable lookup field, by the
 * record it refers to (`lookupFilterOffer`, 0135), in the bindings' order,
 * each followed by the fields through it (`related`, 0139).
 *
 * Views: those of `views`, the published ones, that this actor could have
 * built from the rest (`viewFit`, 0105), in their published order. A view
 * naming a field they may not read is not offered at all, never offered
 * without that condition, which would show a wider list under the view's
 * name; and a default whose view is not offered leaves the list with none.
 * Own: those of `own`, the person's saved ones (0126), fitted alike.
 *
 * `unfiltered`: the fields the administrator left out of the filter
 * (0123), offered with `offered: false`, and so is each field through a
 * lookup of them. `labelled`: the lookup fields a list may be ordered by
 * their labels (0136) -- for one person, those `sortLabelsOf` gives them;
 * for no one in particular, every lookup that shows a display column
 * (`displayedLookups`). `related`: the fields through lookups this person
 * may filter by (0139), each offered after its lookup by what its column
 * offers. None of either by default, so a caller that names none offers
 * no order by a lookup and no field through one.
 */
export function listColumns(bindings: FormBindings, fields: readonly string[], views: readonly ListView[], options: ListOffers = {}): ListColumns {
  const { unfiltered = [], own = [], labelled = [], related = [] } = options
  const columns = readableColumns(bindings, fields)
  const readable = new Set(fields)
  const filterable: FilterableField[] = []
  for (const binding of bindings.fields) {
    if (!readable.has(binding.field)) continue
    const offered = !unfiltered.includes(binding.field)
    const offer = binding.kind === 'lookup' ? lookupFilterOffer(binding) : filterOffer(binding)
    if (offer !== null) filterable.push({ field: binding.field, offered, ...offer })
    for (const through of related) {
      if (through.lookup !== binding.field) continue
      const by = filterOffer(through.column)
      if (by !== null) filterable.push({ field: through.field, offered, ...by, related: { lookup: binding.field, column: through.label } })
    }
  }
  const sortable = bindings.fields
    .filter((binding) =>
      !readable.has(binding.field) ? false : binding.kind === 'lookup' ? labelled.includes(binding.field) : !UNORDERED.has(binding.type.kind),
    )
    .map((binding) => binding.field)
  return {
    searchable: columns.filter((binding) => SEARCHABLE_KINDS.has(binding.type.kind)).map((binding) => binding.field),
    sortable,
    filterable,
    views: firstDefault(views.filter((view) => viewFit(view, bindings, { filterable, sortable }, related) === null)),
    own: ownViewsOffered(own, bindings, { filterable, sortable }, related),
  }
}

/** `views` with `default` kept on the first that has it: a person offered two -- one for each of two roles they hold (0124) -- opens on the first. */
function firstDefault(views: readonly ListView[]): ListView[] {
  let opened = false
  return views.map((view) => {
    if (view.default !== true) return view
    if (!opened) {
      opened = true
      return view
    }
    const { default: _default, ...rest } = view
    return rest
  })
}

/**
 * Every view of `views` that no actor could build from this form's list, each
 * with why, prefixed by where it is: what a write refuses (0105). A view is
 * fitted against every field the bindings hold, so one only a few may read
 * is stored, and offered to those few.
 */
export function viewProblems(views: readonly StoredListView[], bindings: FormBindings): string[] {
  const all = listColumns(
    bindings,
    bindings.fields.map((binding) => binding.field),
    [],
    { labelled: displayedLookups(bindings) },
  )
  return views.flatMap((view, index) => {
    const why = storedViewFit(view, bindings, all)
    return why === null ? [] : [`/views/${String(index)} (“${view.name}”): ${why}`]
  })
}

/**
 * The order a list runs in, made total: the requested columns, then every
 * identity column the request did not name, ascending. Without the key, a
 * page boundary can fall between two rows that sort equal, and a page after
 * one of them (0108) could not say which comes after it; a key column the
 * request names is not named again.
 *
 * NULLs go last, the lookups' rule, spelled only where the snapshot says the
 * column is nullable: a NOT NULL column holds none, and spelled with no
 * placement an index on it serves the order on either engine. A lookup
 * spells it on every column (0012); while the database matches its snapshot
 * the two differ in spelling, never in order.
 */
export function listOrder(
  prepared: Prepared,
  requested: ReadonlyArray<{ column: string; direction: 'asc' | 'desc' } | { label: SortLabel; direction: 'asc' | 'desc' }>,
): ListSort[] {
  const nulls = (name: string): RecordSort['nulls'] => ((prepared.columns.get(name) as ColumnMeta).nullable ? 'last' : null)
  // A label's NULLs are always last: a key with no target row, or one the lookup's filter hides, shows no label (0136).
  const sort: ListSort[] = requested.map((term) =>
    'label' in term
      ? { label: term.label, direction: term.direction, nulls: 'last' }
      : { column: term.column, direction: term.direction, nulls: nulls(term.column) },
  )
  const named = new Set(sort.flatMap((term) => ('column' in term ? [term.column] : [])))
  for (const column of prepared.target.identity) if (!named.has(column.name)) sort.push({ column: column.name, direction: 'asc', nulls: nulls(column.name) })
  return sort
}

/** Every lookup of `bindings` that shows a display column: the lookups a list may be ordered by for no one in particular (0136). */
export function displayedLookups(bindings: FormBindings): string[] {
  return bindings.fields.flatMap((binding) => (binding.kind === 'lookup' && binding.display.length > 0 ? [binding.field] : []))
}

/**
 * The parent a list is narrowed to: the root's foreign-key columns of a
 * lookup the actor may read, each with the value the parent's token names
 * -- or, for no parent (0110), each NULL, a condition of the list's filter
 * as a person's `null` is (0104).
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
): { ok: true; equal: RecordValue[]; none: RecordFilter[] } | PlanRefusal {
  if (parent === null) return { ok: true, equal: [], none: [] }
  const binding = bindings.fields.find((candidate) => candidate.field === parent.field)
  if (binding === undefined || binding.kind !== 'lookup' || !fields.includes(parent.field)) {
    return refuse('invalid-request', `${parent.field} is not a lookup field you may read, so it cannot name a parent.`)
  }
  // No parent (0110): every column of the field NULL, so the row references nothing -- a tree's roots.
  if (parent.record === null) return { ok: true, equal: [], none: binding.columns.map((column): RecordFilter => ({ op: 'null', column })) }
  const decoded = lookupAnswer(
    binding,
    binding.columns.map((name) => prepared.columns.get(name) as ColumnMeta),
    parent.record,
    new Map(),
  )
  if (!decoded.ok) return refuse('invalid-record-token', `The parent's record is not a token of a row ${parent.field} can reference.`)
  return { ok: true, equal: decoded.values, none: [] }
}

/**
 * One page of this form's records for `query`, under the actor's read scope
 * -- or why not.
 *
 * Checks, in this order: everything `listable` checks; that every sort field
 * is one `listColumns` calls sortable (`not-sortable`); that every filter
 * condition is on a readable column field, one its column offers, with
 * values it can hold (`not-filterable`, 0104); that a search has a field to
 * match (`not-searchable`); the parent; and that a cursor names a key of
 * this form (`invalid-cursor`, 0108), which says nothing of whether the row
 * is there: the page's own statement looks for it. Each row the adapter
 * returns is read as `planRead` would read it, the key and the readable
 * fields' columns and nothing else.
 */
export function planList(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, context: PolicyContext, query: RecordListQuery): PlannedList {
  const found = listable(snapshot, bindings, policy, context)
  if (!found.ok) return found
  const { prepared, fields, labels, related } = found
  const offered = listColumns(bindings, fields, [], { labelled: [...labels.keys()] })
  const byField = new Map(readableColumns(bindings, fields).map((binding) => [binding.field, binding]))

  const requested: Array<{ column: string; direction: 'asc' | 'desc' } | { label: SortLabel; direction: 'asc' | 'desc' }> = []
  for (const term of query.sort) {
    const label = labels.get(term.field)
    if (label !== undefined) {
      requested.push({ label, direction: term.direction })
      continue
    }
    const binding = byField.get(term.field)
    if (binding === undefined || !offered.sortable.includes(term.field))
      return refuse('not-sortable', `${term.field} is not a field you may sort this list by.`)
    requested.push({ column: binding.column, direction: term.direction })
  }
  const filter: RecordFilter[] = []
  // A key with a dot is no field of the form's: one through a lookup (0139).
  const through = relatedFilters(
    related,
    query.filter.filter((term) => term.field.includes('.')),
  )
  if (!through.ok) return refuse('not-filterable', through.message)
  for (const term of query.filter) {
    if (term.field.includes('.')) continue
    const binding = byField.get(term.field) ?? readableLookup(bindings, fields, term.field)
    if (binding === undefined) return refuse('not-filterable', `${term.field} is not a field you may filter this list by.`)
    if (binding.kind === 'lookup') {
      const planned = lookupFilter(
        binding,
        binding.columns.map((name) => prepared.columns.get(name) as ColumnMeta),
        term,
        term.field,
      )
      if (!planned.ok) return refuse('not-filterable', planned.message)
      filter.push(...planned.filters)
      continue
    }
    const planned = columnFilter(prepared.columns.get(binding.column) as ColumnMeta, term, term.field)
    if (!planned.ok) return refuse('not-filterable', planned.message)
    filter.push(planned.filter)
  }
  if (query.search !== '' && offered.searchable.length === 0) return refuse('not-searchable', 'This form has no field you may read that a search can match.')
  const parent = parentEqual(prepared, bindings, fields, query.parent)
  if (!parent.ok) return parent
  let after: RecordValue[] | null = null
  if (query.after !== null) {
    const decoded = decodeListCursor(prepared.target.identity, query.after)
    if (!decoded.ok) return refuse('invalid-cursor', "The page's cursor is not one this list's pages give.")
    after = decoded.key
  }

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
    filter: [...filter, ...parent.none],
    related: through.related.slice(0, 0),
    search: query.search === '' ? null : { text: query.search, columns: search },
    sort: listOrder(prepared, requested),
    after,
    offset: 0,
    limit: query.limit,
  }
  return { ok: true, request, fields }
}

/**
 * One page as the API carries it, from the rows an adapter fetched for it:
 * up to `limit + 1`, in the planned request's order. Each row is what
 * `toFormAnswers` makes of a read of it, so a listed record is the record
 * its token reads.
 *
 * The extra row says whether more follow, without a COUNT, and is never
 * shown. When more follow, `next` is the cursor of the last row shown, which
 * the page after it continues after (0108). A row whose key does not fit a token stays in its place with
 * `record: null`: dropped, it would shift every row after it on a page
 * whose arithmetic a grid relies on, and it has a cursor all the same. A
 * token twice on one page is an adapter that joined wrongly, and is thrown
 * here, where the message can say so.
 */
export function recordPage(
  bindings: FormBindings,
  planned: { request: ListRequest; fields: readonly string[] },
  rows: ReadonlyArray<Omit<RecordRead, 'ok'>>,
): RecordList {
  const { request, fields } = planned
  const { limit } = request
  const shown = rows.slice(0, limit)
  const page = shown.map((row) => toFormAnswers(bindings, fields, { ok: true, ...row }))
  const seen = new Set<string>()
  for (const row of page) {
    if (row.record === null) continue
    if (seen.has(row.record)) throw new Error('A record appears twice in one page: the list statement repeats a row.')
    seen.add(row.record)
  }
  const hasMore = rows.length > limit
  const last = shown.at(-1)
  const identity = request.target.identity.map((column) => column.name)
  return { rows: page, hasMore, next: hasMore && last !== undefined ? listCursor(identity, last.values) : null }
}

/** What a person is told when the row a page continues after is gone (0108): the page has no place to start. */
export const CURSOR_GONE = 'The record this page continues after has been deleted, or is no longer one you may read. Start again from the first page.'

/**
 * A page refused because the row it continues after is gone (0108): deleted,
 * or moved out of the person's read filter or a through since the page
 * before. Its rows -- none, without a place to start -- are never shown.
 * `undefined` for every other outcome, a page after a row that is there
 * and a page from the start alike. Asked after the page is decided over its
 * description, as every page is (0041).
 */
export function cursorRefusal(outcome: Extract<ListOutcome, { ok: true }>): PlanRefusal | undefined {
  return outcome.after === 'gone' ? refuse('cursor-gone', CURSOR_GONE) : undefined
}
