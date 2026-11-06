import type { FormMenu, FormMenuEntry, LookupOpen } from '@formancy/data-client'

/*
 * What the host's list of forms shows (0144): the forms of the menu under
 * the group each is listed under (0143), narrowed by what a person types
 * into Find a form, and the forms linked to the one open -- where its
 * lookups' records open (0140) and whose rows refer to its records, the
 * menu's children (0045). Pure: forms-nav.tsx draws what it says.
 */

/** The heading the forms in no group are listed under, after every group. */
export const NO_GROUP = 'Forms'

/** One heading of the list and the forms under it, in the menu's order. */
export interface ListedGroup {
  heading: string
  forms: FormMenuEntry[]
}

/** The list as drawn for one search. */
export interface FormList {
  /** The groups holding a form that matches, in their order, each with the forms of it that match. */
  groups: ListedGroup[]
  /** Whether the headings are drawn: not where every form of the menu, searched or not, is in no group. */
  headed: boolean
  /** The forms that match, each once, in the order the list draws them: what is counted, and what Enter opens when it is one. */
  matched: FormMenuEntry[]
}

/**
 * Headings compared as English words, as the page's language is: the
 * alphabet's order whatever the case, a letter with a mark beside the
 * letter, and a number by its value, "Region 2" before "Region 10".
 */
const WORDS = new Intl.Collator('en', { numeric: true })

/** `left` and `right` as words, and two the words call equal -- "Sales" and "sales", two groups (0143) -- by their codepoints. */
function byHeading(left: string, right: string): number {
  return WORDS.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0)
}

/** Letters as a search compares them: composed, so a keyboard's u and a combining mark is ü, and in lower case. Marks are kept. */
function folded(text: string): string {
  return text.normalize('NFC').toLowerCase()
}

/**
 * The menu's `forms` under their headings, narrowed to those whose title
 * or id holds `search` -- anywhere, in any case, without the spaces around
 * it; nothing typed holds every form. The id, because the list draws it
 * and it alone tells two forms of one title apart. A form in no group, or in a group spelled
 * as that heading, is under `NO_GROUP`, after every other; the others are
 * in the order of their headings as words.
 */
export function formList(forms: readonly FormMenuEntry[], search: string): FormList {
  const wanted = folded(search.trim())
  const all = new Map<string, FormMenuEntry[]>()
  for (const form of forms) {
    const heading = form.group ?? NO_GROUP
    all.set(heading, [...(all.get(heading) ?? []), form])
  }
  const headings = [...all.keys()].sort((left, right) => (left === NO_GROUP ? 1 : right === NO_GROUP ? -1 : byHeading(left, right)))
  const groups = headings
    .map((heading) => ({ heading, forms: (all.get(heading) ?? []).filter((form) => folded(form.title).includes(wanted) || folded(form.id).includes(wanted)) }))
    .filter((group) => group.forms.length > 0)
  return { groups, headed: headings.some((heading) => heading !== NO_GROUP), matched: groups.flatMap((group) => group.forms) }
}

/** What the list's status says for `search`: nothing while nothing is typed, otherwise how many of `total` forms match. */
export function matchSaying(search: string, matched: number, total: number): string {
  const typed = search.trim()
  if (typed === '') return ''
  if (matched === 0) return `No form’s title or id holds “${typed}”.`
  if (matched === 1) return `1 of ${String(total)} forms matches. Enter opens it.`
  return `${String(matched)} of ${String(total)} forms match.`
}

/** A form linked to the open one: where its fields lead, where rows refer to its records, or both. */
export interface LinkedForm {
  entry: FormMenuEntry
  /** A lookup of the open form opens its record in this form (0140). */
  fields: boolean
  /** This form's rows refer to the open form's records: a child the menu names (0045). */
  rows: boolean
}

/**
 * The forms linked to `open`: those its lookups open in, as its
 * definition's `opens` names them, then the children the menu names for it,
 * each once, at its first place, with every way it is linked. The open
 * form itself is left out -- a form its own child, or a lookup that opens
 * in its own form, links to where the person already is -- and so is a
 * form the menu does not name.
 */
export function linkedForms(menu: FormMenu, open: FormMenuEntry, opens: readonly LookupOpen[]): LinkedForm[] {
  const linked = new Map<string, LinkedForm>()
  const add = (id: string, way: 'fields' | 'rows'): void => {
    if (id === open.id) return
    const entry = menu.forms.find((form) => form.id === id)
    if (entry === undefined) return
    const known = linked.get(id) ?? { entry, fields: false, rows: false }
    linked.set(id, { ...known, [way]: true })
  }
  for (const lookup of opens) for (const form of lookup.forms) add(form.id, 'fields')
  for (const child of open.children) add(child.form, 'rows')
  return [...linked.values()]
}

/** How a linked form is linked, in words, from the open form's side: arrows are read out as "rightwards arrow", or not at all. */
export function linkWords({ fields, rows }: { fields: boolean; rows: boolean }): string {
  return [...(fields ? ['from its fields'] : []), ...(rows ? ['its child rows'] : [])].join(' and ')
}
