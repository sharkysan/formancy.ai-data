import { canonicalize } from '@formancy/spec'
import type { FormBindings } from '../generate/types.js'
import { columnFilter, readFilter } from '../records/filter.js'
import { readSort } from '../records/list-query.js'
import type { ListColumns, ListView } from '../runtime.js'

/*
 * A form's list views (0105): conditions and an order an administrator
 * named, which a person picks above the form's grid. A view is a list
 * request and nothing more -- a picked view sends its filter and its sort
 * as a person's own would be sent, and `planList` plans them as it plans a
 * person's (0104) -- so a view can narrow what a person sees, and never
 * widen it.
 *
 * Three questions, asked at three times. Its shape, on every read of a
 * version as at every write (`viewShapeProblems`), so a version stays
 * readable whatever a later release offers. Its fit, at every write but a
 * restore and again whenever it is offered (`viewFit`): a view a person
 * could not have built from what the list offers them is not theirs to
 * pick. And its carry, when a regeneration moves the fields it names
 * (`rebase-views.ts`).
 *
 * Pure and isomorphic, as the presentation is.
 */

/** C0, DEL and C1, and a surrogate with no partner: in `u` mode, so each reads code points. */
const CONTROL = /\p{Cc}/u
const LONE_SURROGATE = /\p{Cs}/u

const PROPERTIES: readonly string[] = ['name', 'filter', 'sort', 'default']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Why a view's name is not one a picker can show, or `null`: words, with no space around them, no control character and no lone surrogate. */
function nameProblem(name: unknown): string | null {
  if (typeof name !== 'string') return 'must be text'
  if (name.trim() === '') return 'needs words a person can read'
  if (name.trim() !== name) return 'cannot start or end with a space'
  if (CONTROL.test(name)) return 'cannot contain a control character'
  if (LONE_SURROGATE.test(name)) return 'cannot contain an unpaired UTF-16 surrogate'
  return null
}

/**
 * Every reason a view's filter is not one a list request could carry, at
 * `at`: a list of conditions, each read on its own by `readFilter`, and each
 * field once. One at a time, because what a `contains` may find is the
 * view's fit and not its shape (a later release's search rules must not make
 * a stored version unreadable), and `readFilter` stops at the first refusal:
 * read whole, a contains it refuses would hide every malformed condition
 * after it.
 */
function filterShape(filter: unknown, at: string): string[] {
  if (!Array.isArray(filter)) return [`${at}/filter must be a list of conditions, [] for none`]
  const problems: string[] = []
  const fields = new Set<string>()
  for (const [index, term] of filter.entries()) {
    const read = readFilter([term], 'field')
    if (!read.ok && read.code === 'malformed') {
      problems.push(`${at}/filter/${String(index)}: ${read.message}`)
      continue
    }
    const field = (term as Record<string, unknown>)['field'] as string
    if (fields.has(field)) problems.push(`${at}/filter: ${field} is named twice in the filter.`)
    fields.add(field)
  }
  return problems
}

/**
 * What a view asks, as one text: its conditions in the order of their
 * fields, since every one must hold whatever their order, and its sort as
 * it runs. Two views that ask the same are one choice a picker cannot tell
 * apart: the host shows the first for both.
 */
function asked(filter: readonly unknown[], sort: readonly unknown[]): string {
  const byField = [...filter].sort((left, right) => {
    const [a, b] = [(left as { field: string }).field, (right as { field: string }).field]
    return a < b ? -1 : a > b ? 1 : 0
  })
  return canonicalize({ filter: byField, sort })
}

/** Every reason one view is not shaped as one, at `at`; its name and what it asks, when it has them, for the caller's checks across views. */
function viewShape(view: unknown, at: string): { problems: string[]; name: string | null; asks: string | null; isDefault: boolean } {
  if (!isRecord(view)) return { problems: [`${at} must be an object`], name: null, asks: null, isDefault: false }
  const problems: string[] = []
  for (const key of Object.keys(view)) if (!PROPERTIES.includes(key)) problems.push(`${at}/${key} is not a property of a list view`)
  const named = nameProblem(view['name'])
  if (named !== null) problems.push(`${at}/name ${named}`)
  const filter = Object.hasOwn(view, 'filter') ? filterShape(view['filter'], at) : [`${at}/filter must be a list of conditions, [] for none`]
  problems.push(...filter)
  const sort = Object.hasOwn(view, 'sort') ? readSort(view['sort']) : null
  if (sort === null) problems.push(`${at}/sort must be a list of { field, direction }, [] for none`)
  else if (!sort.ok) problems.push(`${at}/sort: ${sort.message}`)
  const isDefault = Object.hasOwn(view, 'default')
  if (isDefault && view['default'] !== true) problems.push(`${at}/default must be true, or left out`)
  const shaped = filter.length === 0 && sort?.ok === true
  if (shaped && (view['filter'] as unknown[]).length === 0 && (view['sort'] as unknown[]).length === 0) problems.push(`${at}: says nothing; leave the view out`)
  return {
    problems,
    name: named === null ? (view['name'] as string) : null,
    asks: shaped ? asked(view['filter'] as unknown[], view['sort'] as unknown[]) : null,
    isDefault: isDefault && view['default'] === true,
  }
}

/**
 * Every reason a presentation's `views` is not a list of views this release
 * reads, by shape alone: a list that is not empty -- no views is the
 * property left out, so a presentation has one spelling -- of `{ name,
 * filter, sort }` with `default: true` on at most one; a name a person can
 * read, no two alike but for case; a filter and a sort a list request
 * could carry, each field once; not both empty, which is the list itself;
 * and no two views asking the same, which a picker could not tell apart.
 * Whether the fields it names offer what it asks is `viewFit`'s.
 */
export function viewShapeProblems(value: unknown): string[] {
  if (!Array.isArray(value)) return ['views must be a list']
  if (value.length === 0) return ['views: names none; leave it out']
  const problems: string[] = []
  const names = new Set<string>()
  /** What each view seen so far asks, and its name, which a later one asking the same is told apart from. */
  const asks = new Map<string, string>()
  let defaults = 0
  for (const [index, view] of value.entries()) {
    const at = `/views/${String(index)}`
    const shape = viewShape(view, at)
    problems.push(...shape.problems)
    if (shape.name !== null) {
      const folded = shape.name.toLowerCase()
      if (names.has(folded)) problems.push(`${at}/name: “${shape.name}” is another view’s name`)
      names.add(folded)
    }
    if (shape.asks !== null) {
      const same = asks.get(shape.asks)
      if (same !== undefined) problems.push(`${at}: asks what “${same}” asks, so a picker could not tell them apart`)
      else asks.set(shape.asks, shape.name ?? `view ${String(index)}`)
    }
    if (shape.isDefault) defaults += 1
  }
  if (defaults > 1) problems.push('/views: more than one view is the default')
  return problems
}

/**
 * Why `view` is not one a person offered `columns` could have built, or
 * `null` when it is: its filter is read as a request's is, and stored as it
 * reads -- a contains trimmed -- and every condition is on a field
 * `columns.filterable` offers, planned by `columnFilter` over that field's
 * column as `planList` plans it; every sort field is one `columns.sortable`
 * holds. One decision for a write, against everything the list offers, and
 * for an offer, against what one person's list offers them.
 */
export function viewFit(view: ListView, bindings: FormBindings, columns: Pick<ListColumns, 'filterable' | 'sortable'>): string | null {
  const read = readFilter(view.filter, 'field')
  if (!read.ok) return read.message
  if (canonicalize(read.filter) !== canonicalize(view.filter)) return 'its filter is not as a request reads it: what a contains condition finds is stored trimmed.'
  for (const term of read.filter) {
    const binding = bindings.fields.find((candidate) => candidate.field === term.field)
    if (binding?.kind !== 'column' || !columns.filterable.some((offered) => offered.field === term.field)) return `${term.field} is not a field this list is filtered by.`
    const planned = columnFilter({ name: binding.column, type: binding.type, nullable: binding.nullable }, term, term.field)
    if (!planned.ok) return planned.message
  }
  for (const term of view.sort) if (!columns.sortable.includes(term.field)) return `${term.field} is not a field this list is sorted by.`
  return null
}
