import type { FilterDays, FilterInput, FilterableField, LineField, ListFilterTerm, PublishedForm, StateMoves } from '@formancy/data-client'
import { fieldHeading } from '@formancy/data-client'
import type { Known } from './known-records.js'

/*
 * What a grid's filter offers and says (0104), as data: the fields a list
 * may be filtered by, with their labels, the fields the filter line and the
 * header boxes may name (0131, 0132), and the sentences that name a
 * condition, which the chips show. What a grid asks with its filter is
 * grid-datasource.ts's.
 *
 * Everything offered is the server's `list.filterable`: a field, the
 * operators it offers, what a value is typed as, and whose clock a
 * timestamp's days are on. A value is sent as the person typed it, never
 * checked or respelled here: whether it is one the column can hold is the
 * server's to say (`not-filterable`), in its own sentence.
 */

/** What a chip says of an operator with no value. */
const NO_VALUE_WORDS: Readonly<Record<'null' | 'not-null', string>> = {
  null: 'has no value',
  'not-null': 'has a value',
}

/** A field the filter offers: the server's offer, the field's label in the form, and a lookup's records the grid has heard of (0135). */
export interface PanelField extends FilterableField {
  label: string
  records?: ReadonlyArray<{ value: string; label: string }>
}

/** `fields` with each lookup's records the grid has heard of (`known-records.ts`, 0135), by token and label: what the line reads and a chip says a record by. */
export function withRecords(fields: readonly PanelField[], known: Known): PanelField[] {
  return fields.map((field) =>
    field.input === 'lookup' ? { ...field, records: [...(known.get(field.field) ?? [])].map(([value, label]) => ({ value, label })) } : field,
  )
}

/**
 * The fields of `definition`'s list a person may filter by, in the server's
 * order, each with its label: the form's, or for a field through a lookup
 * (0139), which the form has none of, its lookup's and its column's. Whether a date input is a timestamp's, and
 * on whose clock its days are, is the offer's `days`, which only the
 * column's type knows: never guessed from the control the form draws.
 */
export function panelFields(definition: PublishedForm): PanelField[] {
  const headings = new Map(definition.form.model.fields.map((field) => [field.key, fieldHeading(field)]))
  return (definition.list?.filterable ?? []).map((offer) => ({
    ...offer,
    label:
      offer.related === undefined
        ? (headings.get(offer.field) ?? offer.field)
        : `${headings.get(offer.related.lookup) ?? offer.related.lookup} › ${offer.related.column}`,
  }))
}

/**
 * The fields the filter line and the header boxes may name: those the
 * form's filter offers (0123), each with its label, and the state field with its states
 * by the labels an administrator gave them (0129), in the presentation's
 * order, then any other state its moves name, as it is spelled; and a
 * lookup with the records the grid has heard of (0135). A boolean's yes
 * and no are the line's own.
 */
export function lineFields(fields: readonly PanelField[], moves: StateMoves | null): LineField[] {
  const states = moves === null ? [] : [...new Set([...moves.labels.map((entry) => entry.state), ...moves.moves.flatMap((move) => [move.from, move.to])])]
  const values = states.flatMap((state) =>
    state === null ? [] : [{ value: state, label: moves?.labels.find((entry) => entry.state === state)?.label ?? state }],
  )
  return fields
    .filter((field) => field.offered)
    .map(({ field, label, operators, input, records }) => ({
      field,
      label,
      operators,
      input,
      ...(input === 'lookup' ? { values: records ?? [] } : field === moves?.field && values.length > 0 ? { values } : {}),
    }))
}

/**
 * Whether a grid draws its filter: a field it offers, or a condition
 * applied -- a view's, on a field the administrator left out of it
 * (0123) -- which a chip says.
 */
export function panelShown(fields: readonly PanelField[], filter: readonly ListFilterTerm[]): boolean {
  return fields.some((field) => field.offered) || (fields.length > 0 && filter.length > 0)
}

/** `filter` with `term` in it: in place of its field's condition, or last. A field is named once (0104). */
export function withTerm(filter: readonly ListFilterTerm[], term: ListFilterTerm): ListFilterTerm[] {
  const at = filter.findIndex((given) => given.field === term.field)
  return at === -1 ? [...filter, term] : filter.map((given, index) => (index === at ? term : given))
}

/**
 * A view's name from its conditions, as the chips say them less a time's
 * days, which would read as a condition of their own, cut to the 80
 * characters a name may have (0126).
 */
export function viewName(filter: readonly ListFilterTerm[], fields: readonly PanelField[]): string {
  const said = filter
    .map((term) => {
      const field = fields.find((offered) => offered.field === term.field)
      return summaryOf(
        term,
        field === undefined ? undefined : { label: field.label, input: field.input, ...(field.records === undefined ? {} : { records: field.records }) },
      )
    })
    .join(', ')
  return said.length <= 80 ? said : `${said.slice(0, 79).trimEnd()}…`
}

/** A value as a condition's sentence quotes it: text in quotes, a boolean as yes or no, anything else as typed. */
function quoted(value: string, input: FilterInput | null): string {
  if (input === 'boolean') return value === 'true' ? 'yes' : value === 'false' ? 'no' : value
  return input === 'text' || input === 'uuid' ? `“${value}”` : value
}

/** One bound of a range, worded for what it bounds -- a day, or a number -- and for whether it leaves out its own value (0130). */
function bound(side: 'from' | 'to', input: FilterInput | null, exclusive: boolean): string {
  if (input === 'date') return side === 'from' ? (exclusive ? 'after' : 'on or after') : exclusive ? 'before' : 'on or before'
  return side === 'from' ? (exclusive ? 'over' : 'at least') : exclusive ? 'under' : 'at most'
}

/** What a time's range is whole days on, said after it: the one place a condition is shown in words (0104). */
const DAYS: Readonly<Record<FilterDays, string>> = { utc: ', whole days in UTC', wall: ', whole days as stored' }

/** A condition as a sentence, by its field's label: what a chip says and its Remove names. */
export function summaryOf(term: ListFilterTerm, field: (Pick<PanelField, 'label' | 'input' | 'records'> & { days?: FilterDays | null }) | undefined): string {
  const label = field?.label ?? term.field
  const input = field?.input ?? null
  switch (term.op) {
    case 'equals':
      // A lookup's record by the label the grid heard for it, or its token where it heard none (0135).
      if (input === 'lookup') return `${label} is “${field?.records?.find((record) => record.value === term.value)?.label ?? term.value}”`
      return `${label} is ${quoted(term.value, input)}`
    case 'range': {
      const days = field?.days === undefined || field.days === null ? '' : DAYS[field.days]
      if (term.from !== null && term.to !== null && term.exclusive === undefined) return `${label} is between ${term.from} and ${term.to}${days}`
      const leaves = (side: 'from' | 'to'): boolean => term.exclusive === side || term.exclusive === 'both'
      const bounds = [
        ...(term.from === null ? [] : [`${bound('from', input, leaves('from'))} ${term.from}`]),
        ...(term.to === null ? [] : [`${bound('to', input, leaves('to'))} ${term.to}`]),
      ]
      return `${label} is ${bounds.join(' and ')}${days}`
    }
    case 'contains':
      return `${label} contains ${quoted(term.text, 'text')}`
    case 'null':
    case 'not-null':
      return `${label} ${NO_VALUE_WORDS[term.op]}`
  }
}
