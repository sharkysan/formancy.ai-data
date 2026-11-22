import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import { fieldHeading } from '@formancy/data-client'
import type { PublishedForm } from '@formancy/data-client'
import type { FieldDef, FormSchema } from '@formancy/spec'
import type { Said } from './leave.js'
import { withMovesOver } from './moves.js'
import { words } from './running.js'
import { CAPABILITIES } from './session.js'
import type { Renderer } from './session.js'
import { onlyFields } from './widgets.js'

/*
 * What only a change of the records chosen of a page asks and says (0175,
 * 0176): which of the fields the form serves this person such a change in
 * (`bulk.update`) are set, each drawn on paper as the published form
 * narrowed to the fields ticked, through the workspace's renderer, so a
 * lookup has its typeahead and the theme dresses it, as an action's dialog
 * is drawn (0162); the values sent -- an answer, or `null` for a field
 * ticked and left empty, which clears it -- and how the confirmation says
 * them; and the change's words. Every field offered is one
 * `writable.update` holds and no rule of the form reads together with
 * another (0175), so nothing on the paper is disabled for this person and
 * no rule there reads a field the paper leaves out. The state field is
 * drawn as the states some chosen record may move to; the server checks
 * each record's move from its own state.
 *
 * Everything a change decides the way a deletion of them does is
 * chosen-request.ts's: its states, what became of each record, what leaves
 * the choice and what a check reads.
 */

/** The bar's button, which asks. */
export const CHANGE_CHOSEN = 'Change the chosen…'
/** The boxes' legend. */
export const FIELDS_LEGEND = 'Fields to change'
/** Under them, what ticking one does. */
export const TICK_FIELDS = 'Tick each field to change: it is set to the value you give it in every chosen record, and one left empty is cleared.'
/** The paper's name, before its renderer's. */
export const VALUES = 'Values to set'
/** While Continue reads the label of each record a lookup it sets names. */
export const NAMING = 'Reading the name of each record a lookup names…'
/** A field ticked and left empty, as the confirmation says its value. */
export const CLEARED = 'cleared'
/** First in a confirmation over more than one record: how a page of changes goes (0175). */
export const EACH_CHANGED = 'Each is changed on its own, at the version this page read it at: one that cannot be changed is named, and the others are changed.'
/** First in a confirmation over one record: it is that record's update. */
export const ONE_CHANGED = 'It is changed as a save of it alone would change it, at the version this page read it at.'
/** Where a field is cleared: what that leaves. */
export const CLEARS = 'A field left empty is cleared: it holds no value once they are changed.'
/** Before the forms of the open record, chosen, that hold work: it is read again once it is changed (0162). */
export const READ_AGAIN_CHANGED = 'The open record is read again once it is changed, which discards the unsaved changes in these forms:'
/** After the server's sentence, where it refused the request whole; and where a check found every record at the version sent. */
export const NONE_CHANGED = 'None of the chosen records was changed.'
/** A record a check found moved on: the page cannot tell this change from another's. */
export const MOVED = 'It has changed since you saw it: this change, or somebody else’s, changed it.'
/** A press of the open record's Save while a change of chosen records that holds it is out: it moves the version the save would name. */
export const CHANGE_HELD = 'A change of this record with the chosen records has not been answered yet; nothing was sent.'
/** A press of Save once the change is answered and before the record is read again: it would name the version from before. */
export const CHANGE_READING = 'The record is being read again after it was changed with the chosen records; nothing was sent.'

/** What the state field does where the change sets it: each record moves from its own state, or is named (0127, 0175). */
export const movesEach = (label: string, n: number): string =>
  n === 1
    ? `${label} moves from the state the record is in: if it may not move there, the record is named, and left as it was.`
    : `${label} moves from each record’s own state: one that may not move there is named, and left as it was.`

/** A field a change may set, by its key, and what the page calls it. */
export interface ChangeField {
  key: string
  label: string
}

/** The fields the form serves this person a change of chosen records in (`bulk.update`, 0175), in its order, each by its heading; none where it serves none. */
export function changeFields(definition: PublishedForm): ChangeField[] {
  const offered = definition.bulk.update ?? []
  return definition.form.model.fields.filter((field) => offered.includes(field.key)).map((field) => ({ key: field.key, label: fieldHeading(field) }))
}

/**
 * The form a change's values are drawn with: the published form narrowed
 * to the fields ticked (`onlyFields`), its state field, where ticked, the
 * states the records chosen may move to from `froms`, theirs as the page
 * read them (`withMovesOver`); and no field's default, a create's alone
 * (0149), since a change starts empty.
 */
export function changeForm(definition: PublishedForm, ticked: readonly string[], froms: ReadonlyArray<string | null | undefined>): FormSchema {
  const narrowed = onlyFields(definition.form, ticked)
  const { moves } = definition
  const moved = moves !== null && ticked.includes(moves.field) ? withMovesOver(narrowed, moves, froms) : narrowed
  return { ...moved, model: { ...moved.model, fields: moved.model.fields.map(({ default: _, ...field }) => field) } }
}

/**
 * The engine a change's values are drawn on paper with, over `ticked`: a
 * new one for each box ticked or unticked, since the paper is the form
 * narrowed to them, which keeps what was typed into those still ticked
 * from `before`; its ids the form's and the change's, apart from every
 * pane's (formancy.ai 0095). Null while nothing is ticked: there is no
 * paper to draw.
 */
export function changeEngine(
  definition: PublishedForm,
  formId: string,
  renderer: Renderer,
  ticked: readonly string[],
  froms: ReadonlyArray<string | null | undefined>,
  before: FormEngine | null,
): FormEngine | null {
  if (ticked.length === 0) return null
  const held = (before?.value() ?? {}) as Record<string, unknown>
  const initialValue = Object.fromEntries(ticked.filter((key) => held[key] !== undefined).map((key) => [key, held[key]]))
  return createFormEngine({ schema: changeForm(definition, ticked, froms), formId: `${formId}-change-${renderer}`, initialValue, capabilities: CAPABILITIES })
}

/** Whether an answer is none: a field ticked and left empty. */
const empty = (value: unknown): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

/** What a change sends for each field ticked: the answer the renderer submitted, or `null` where it was left empty, which clears it in every record (0175). */
export function changeAnswers(ticked: readonly string[], data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(ticked.map((key) => [key, empty(data[key]) ? null : data[key]]))
}

/** The lookups a change sets, each by its source and the token chosen: what the confirmation names by its record's label, read as the typeahead reads it. */
export function chosenLookups(form: FormSchema, answers: Readonly<Record<string, unknown>>): Array<{ field: string; source: string; token: string }> {
  return form.model.fields.flatMap((field) => {
    const token = answers[field.key]
    return field.optionsSource === undefined || typeof token !== 'string' ? [] : [{ field: field.key, source: field.optionsSource, token }]
  })
}

/**
 * A field's value as the confirmation says it: cleared, where it is none;
 * a lookup's by the label its record is named by (`named`), or its token
 * where none was read; an option by its label; a yes or a no; and anything
 * else as the renderer gave it, which is the spelling it is sent in.
 */
function valueSaid(form: FormSchema, field: FieldDef, value: unknown, named: ReadonlyMap<string, string>): Said {
  if (empty(value)) return [CLEARED]
  if (field.optionsSource !== undefined) {
    const label = named.get(field.key)
    return label === undefined ? [{ code: String(value) }] : [label]
  }
  const { options } = field
  if (options !== undefined) {
    const each = (Array.isArray(value) ? value : [value]).map((one) => {
      const option = options.find((candidate) => candidate.value === String(one))
      return option === undefined ? String(one) : (words(form, option.label) ?? String(one))
    })
    return [each.join(', ')]
  }
  if (typeof value === 'boolean') return [value ? 'yes' : 'no']
  return [typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)]
}

/** Each field a change sets and its value, in the form's order, as the confirmation lists them: "Status: shipped", "Notes: cleared". */
export function valuesSaid(form: FormSchema, answers: Readonly<Record<string, unknown>>, named: ReadonlyMap<string, string>): Said[] {
  return form.model.fields
    .filter((field) => field.key in answers)
    .map((field) => [`${fieldHeading(field)}: `, ...valueSaid(form, field, answers[field.key], named)])
}

/** What changing the records does, one sentence each: each on its own -- of one record, its update's own -- each record's move where the state field is set, and what a field cleared leaves. */
export function lead(definition: PublishedForm, answers: Readonly<Record<string, unknown>>, n: number): string[] {
  const state = definition.moves === null ? undefined : definition.form.model.fields.find((field) => field.key === definition.moves?.field)
  return [
    n === 1 ? ONE_CHANGED : EACH_CHANGED,
    ...(state === undefined || !(state.key in answers) ? [] : [movesEach(fieldHeading(state), n)]),
    ...(Object.values(answers).some((value) => value === null) ? [CLEARS] : []),
  ]
}

/** How the page says what became of the records of a change: the words chosen-request.ts's outcome is said in. */
export const CHANGE_WORDS = {
  verb: 'Change',
  done: 'Changed',
  past: 'changed',
  request: 'change',
  refused: 'Not changed',
  none: NONE_CHANGED,
  mayHave: 'It may have been changed.',
  notSent: 'Not sent, so not changed:',
  notSentOne: 'Not sent, so not changed.',
  found: MOVED,
  /** After "2 of 4 records ": what a check found of those moved on since the page read them. */
  foundCount: (found: number): string =>
    `${found === 1 ? 'has' : 'have'} changed since this page read ${found === 1 ? 'it' : 'them'}: this change, or somebody else’s, changed ${found === 1 ? 'it' : 'them'}.`,
  /** After "1 of 2 records ": what a check found of those still at the version sent. */
  keptCount: (kept: number): string => `${kept === 1 ? 'is' : 'are'} still at the version this page read, not changed`,
  /** A record a check found at the version sent: not changed. */
  kept: (): string => 'It is still at the version you saw.',
  /** A record the check could not read. */
  unread: (message: string): string => `${message} Whether it was changed is still unknown.`,
  sending: 'Changing…',
  held: CHANGE_HELD,
  work: { out: 'changing', unknown: 'change-unknown' },
} as const
