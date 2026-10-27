import type { FilterInput, FilterOp, FilterableField, ListFilterTerm, PublishedForm } from '@formancy/data-client'

/*
 * What a grid's filter panel offers and says (0104), as data: the fields a
 * list may be filtered by, with their labels, the condition a person's
 * draft asks for, and the sentences that name a condition. The panel is
 * filter-panel.tsx; what a grid asks with its filter is grid-datasource.ts's.
 *
 * Everything offered is the server's `list.filterable`: a field, the
 * operators it offers in the order a panel lists them, and what a value is
 * typed as. A value is sent as the person typed it, never checked or
 * respelled here: whether it is one the column can hold is the server's to
 * say (`not-filterable`), in its own sentence. What is decided here is only
 * the shape a request must have: a range with a bound, text to find.
 */

/** What each operator is called in the panel's Condition menu. */
export const OPERATOR_WORDS: Readonly<Record<FilterOp, string>> = {
  equals: 'is',
  range: 'is between',
  contains: 'contains',
  null: 'has no value',
  'not-null': 'has a value',
}

/**
 * A field the panel offers: the server's offer, the field's label in the
 * form, and, for a timestamp, whose clock its whole days are on: `utc` for
 * an instant, which the page shows in UTC, `stored` for one in no zone, as
 * the database stores it. Null for every other field.
 */
export interface PanelField extends FilterableField {
  label: string
  days: 'utc' | 'stored' | null
}

/**
 * The fields of `definition`'s list a person may filter by, in the server's
 * order, each with its label. A timestamp is the one field whose value is
 * typed as a date and whose form field is not a date (0104's offer, and the
 * generator's controls): an instant is the form's `datetime`, a timestamp in
 * no zone its read-only text.
 */
export function panelFields(definition: PublishedForm): PanelField[] {
  const fields = new Map(definition.form.model.fields.map((field) => [field.key, field]))
  return (definition.list?.filterable ?? []).map((offer) => {
    const field = fields.get(offer.field)
    const type = field?.type
    const days = offer.input !== 'date' || type === 'date' ? null : type === 'datetime' ? 'utc' : 'stored'
    return { ...offer, label: String(field?.label ?? offer.field), days }
  })
}

/** What a person has chosen and typed in the panel, kept as typed. */
export interface Draft {
  field: string
  op: FilterOp
  /** What equals compares, or what contains finds. */
  value: string
  from: string
  to: string
}

/** The draft the panel starts with, or after another field is chosen: its first operator, nothing typed. A boolean starts on yes, the first of its two. */
export function draftFor(field: PanelField): Draft {
  return { field: field.field, op: field.operators[0] as FilterOp, value: field.input === 'boolean' ? 'true' : '', from: '', to: '' }
}

/**
 * The condition `draft` asks for -- or the sentence why it is none yet: a
 * range with neither bound, or contains with no text to find, which the
 * server would refuse as malformed rather than as a value. An empty bound
 * is no bound. Everything else is sent as typed; text of no characters is a
 * value equals compares.
 */
export function conditionOf(draft: Draft): { ok: true; term: ListFilterTerm } | { ok: false; problem: string } {
  const { field, op } = draft
  switch (op) {
    case 'equals':
      return { ok: true, term: { field, op, value: draft.value } }
    case 'range': {
      const from = draft.from.trim() === '' ? null : draft.from
      const to = draft.to.trim() === '' ? null : draft.to
      if (from === null && to === null) return { ok: false, problem: 'A range needs a From, a To or both.' }
      return { ok: true, term: { field, op, from, to } }
    }
    case 'contains':
      if (draft.value.trim() === '') return { ok: false, problem: 'Contains needs text to find.' }
      return { ok: true, term: { field, op, text: draft.value } }
    case 'null':
    case 'not-null':
      return { ok: true, term: { field, op } }
  }
}

/** `filter` with `term` in it: in place of its field's condition, or last. A field is named once (0104). */
export function withTerm(filter: readonly ListFilterTerm[], term: ListFilterTerm): ListFilterTerm[] {
  const at = filter.findIndex((given) => given.field === term.field)
  return at === -1 ? [...filter, term] : filter.map((given, index) => (index === at ? term : given))
}

/** A value as a condition's sentence quotes it: text in quotes, a boolean as yes or no, anything else as typed. */
function quoted(value: string, input: FilterInput | null): string {
  if (input === 'boolean') return value === 'true' ? 'yes' : value === 'false' ? 'no' : value
  return input === 'text' || input === 'uuid' ? `“${value}”` : value
}

/** One bound of a range, worded for what it bounds: a day, or a number. */
function bound(side: 'from' | 'to', input: FilterInput | null): string {
  if (input === 'date') return side === 'from' ? 'on or after' : 'on or before'
  return side === 'from' ? 'at least' : 'at most'
}

/** A condition as a sentence, by its field's label: what the panel lists and a removal names. */
export function summaryOf(term: ListFilterTerm, field: Pick<PanelField, 'label' | 'input'> | undefined): string {
  const label = field?.label ?? term.field
  const input = field?.input ?? null
  switch (term.op) {
    case 'equals':
      return `${label} is ${quoted(term.value, input)}`
    case 'range':
      if (term.from !== null && term.to !== null) return `${label} is between ${term.from} and ${term.to}`
      return term.from !== null ? `${label} is ${bound('from', input)} ${term.from}` : `${label} is ${bound('to', input)} ${String(term.to)}`
    case 'contains':
      return `${label} contains ${quoted(term.text, 'text')}`
    case 'null':
    case 'not-null':
      return `${label} ${OPERATOR_WORDS[term.op]}`
  }
}

/**
 * What the panel says under a draft, from what it is: how a range's bounds
 * count -- a timestamp's in whole days, on its clock -- what contains
 * matches, and that text of no characters is a value. Null when there is
 * nothing to say.
 */
export function draftHint(draft: Draft, field: PanelField | undefined): string | null {
  if (field === undefined) return null
  if (draft.op === 'range') {
    if (field.days === 'utc') return 'Whole days in UTC, as the grid shows times: from the start of From to the end of To. Either may be left empty.'
    if (field.days === 'stored') return 'Whole days, as the time is stored: from the start of From to the end of To. Either may be left empty.'
    return 'From and To are included. Either may be left empty.'
  }
  if (draft.op === 'contains') return 'Found anywhere in the field, in any case.'
  if ((draft.op === 'null' || draft.op === 'not-null') && field.input === 'text') return 'Text of no characters is a value.'
  return null
}
