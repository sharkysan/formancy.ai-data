import type { FormBindings } from '../generate/types.js'
import { asked, nameProblem, viewFit } from '../presentation/views.js'
import type { ListColumns, ListView } from '../runtime.js'
import { readFilter } from './filter.js'
import { readSort } from './list-query.js'

/*
 * A person's own list views (0126): a filter and a sort they built from
 * what a form's list offers them, kept under a name of theirs and picked
 * again beside the views the form's administrator named (0105). Kept by the
 * server, per person and form, never in a browser, where a value typed
 * into a condition would outlast the person (0106).
 *
 * A view of theirs is a list request and nothing more, as an
 * administrator's is: saved, it is fitted to what their list offers them
 * (`viewFit`), and offered again only while it still fits, so it narrows
 * and never permits. No default, no roles and no relative value: those are
 * how an administrator offers a view to others.
 *
 * Pure and isomorphic, as the views are.
 */

/** How many views a person keeps of one form: a choice, not a measurement -- a picker read at a glance, and a file the server rewrites whole. */
export const OWN_VIEWS_LIMIT = 20

/** The longest name a person's view may have, in UTF-16 code units: a choice, the width of a picker's option and not a sentence. */
export const OWN_VIEW_NAME_LIMIT = 80

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A view as a request or a stored entry spells it: `{ name, filter, sort }`
 * and nothing else; a name a picker can show, at most
 * `OWN_VIEW_NAME_LIMIT` long; a filter and a sort a list request could
 * carry, read as one reads them -- a contains trimmed -- and not both
 * empty, which is every record.
 */
export function readOwnView(given: unknown): { ok: true; view: ListView } | { ok: false; message: string } {
  if (!isRecord(given)) return { ok: false, message: 'A view is { name, filter, sort }.' }
  const extra = Object.keys(given).find((key) => !['name', 'filter', 'sort'].includes(key))
  if (extra !== undefined) return { ok: false, message: `A view is { name, filter, sort } and nothing else: ${extra} is not one of them.` }
  const named = nameProblem(given['name'])
  if (named !== null) return { ok: false, message: `A view's name ${named}.` }
  const name = given['name'] as string
  if (name.length > OWN_VIEW_NAME_LIMIT) return { ok: false, message: `A view's name is at most ${String(OWN_VIEW_NAME_LIMIT)} characters.` }
  // Both are needed: `null` is what each reader refuses as no list, where a request may leave either out.
  const filter = readFilter(given['filter'] ?? null, 'field')
  if (!filter.ok) return { ok: false, message: filter.message }
  const sort = readSort(given['sort'] ?? null)
  if (!sort.ok) return { ok: false, message: sort.message }
  if (filter.filter.length === 0 && sort.sort.length === 0)
    return { ok: false, message: 'A view with no condition and no sort is every record: All records is that already.' }
  return { ok: true, view: { name, filter: filter.filter, sort: sort.sort } }
}

/** Two names a person could not tell apart in a picker: alike but for case. */
const alike = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * Every reason a person's stored views are not as the server writes them:
 * `{ views }`, a list of at most `OWN_VIEWS_LIMIT` views `readOwnView`
 * reads exactly as stored, no two named alike. Asked on every read: the
 * file is the server's own, so a problem is damage, and nothing is offered
 * from it.
 */
export function ownViewsProblems(value: unknown): string[] {
  if (!isRecord(value) || !Object.hasOwn(value, 'views') || Object.keys(value).length !== 1 || !Array.isArray(value['views']))
    return ['a person’s views are { views: [ … ] } and nothing else']
  const views = value['views'] as unknown[]
  const problems: string[] = []
  if (views.length > OWN_VIEWS_LIMIT) problems.push(`more than ${String(OWN_VIEWS_LIMIT)} views`)
  const names: string[] = []
  for (const [index, view] of views.entries()) {
    const read = readOwnView(view)
    if (!read.ok) problems.push(`/views/${String(index)}: ${read.message}`)
    else if (JSON.stringify(read.view) !== JSON.stringify(view)) problems.push(`/views/${String(index)}: not as a view is stored`)
    else if (names.some((name) => alike(name, read.view.name))) problems.push(`/views/${String(index)}: “${read.view.name}” is another view’s name`)
    else names.push(read.view.name)
  }
  return problems
}

/**
 * `view` saved among a person's `own`: in place of theirs named alike, else
 * last. Refused, in words for the person, when their list could not run it
 * (`viewFit` over `columns`, what their list offers them), when it asks
 * what another of theirs asks or what a view `columns` offers them asks --
 * a picker would show either name for it -- or when it would be one more
 * than `OWN_VIEWS_LIMIT`.
 */
export function savedOwnView(
  own: readonly ListView[],
  view: ListView,
  bindings: FormBindings,
  columns: ListColumns,
): { ok: true; views: ListView[] } | { ok: false; message: string } {
  const why = viewFit(view, bindings, columns)
  if (why !== null) return { ok: false, message: why }
  const asks = asked(view.filter, view.sort)
  const offered = columns.views.find((other) => asked(other.filter, other.sort) === asks)
  if (offered !== undefined) return { ok: false, message: `It asks what the view “${offered.name}” asks: pick that one.` }
  const theirs = own.find((other) => !alike(other.name, view.name) && asked(other.filter, other.sort) === asks)
  if (theirs !== undefined) return { ok: false, message: `It asks what your view “${theirs.name}” asks.` }
  const at = own.findIndex((other) => alike(other.name, view.name))
  if (at !== -1) return { ok: true, views: own.map((other, index) => (index === at ? view : other)) }
  if (own.length >= OWN_VIEWS_LIMIT) return { ok: false, message: `You keep ${String(OWN_VIEWS_LIMIT)} views of this form: remove one first.` }
  return { ok: true, views: [...own, view] }
}

/** A person's `own` without theirs named alike `name`; the same where none is, so a remove sent twice answers alike. */
export function removedOwnView(own: readonly ListView[], name: string): ListView[] {
  return own.filter((view) => !alike(view.name, name))
}

/**
 * The views of a person's `own` their list offers them now, in their
 * order: each it could still run (`viewFit`). One it could not -- a field
 * they may no longer read, a column gone -- is kept, and offered again
 * once it fits, never offered without the condition it cannot run.
 */
export function ownViewsOffered(own: readonly ListView[], bindings: FormBindings, columns: Pick<ListColumns, 'filterable' | 'sortable'>): ListView[] {
  return own.filter((view) => viewFit(view, bindings, columns) === null)
}
