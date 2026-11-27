import { fieldHeading } from '@formancy/data-client'
import type { PublishedForm } from '@formancy/data-client'
import type { FieldDef, FormSchema } from '@formancy/spec'
import { CANNOT_OPEN, listed } from './grid-datasource.js'
import type { Said } from './leave.js'
import type { SaveResult } from './session.js'

/*
 * Editing a record in its row (0179), decided once here and asked by the
 * page (use-grid-edit.ts): which of a row's cells a person edits there,
 * which in the record's form and which never, and why; the open row's
 * states and its mark; when leaving a row saves it; where Tab goes in an
 * editor; and what the grid's line says of a save. Framework-neutral, so a
 * test reads the whole decision without a grid or a server.
 *
 * - **The copy decides, and nothing else.** A cell is edited where the copy
 *   a pane draws its record with (drawn-copies.ts) has its field enabled:
 *   on the open row the engine's snapshot of it, its conditions evaluated;
 *   on another row the copy's own rules, which F2 there checks against the
 *   engine once the record is read. So a grid and a form cannot disagree.
 * - **In the cell** what a cell holds whole: text, a number as its text, a
 *   date as its canonical text, a checkbox, and a select of the options the
 *   copy draws -- an enum's labels, a check's list (0152, 0170), the state
 *   field as its moves (0127). **In the record's form** a textarea, a time,
 *   a timestamp and a lookup, whose typeahead is the form's.
 * - **Never** a row that cannot be opened, a column of the page's own, or a
 *   field the copy draws disabled, read-only or hidden -- each said in the
 *   words of why it is drawn so.
 * - **One draft.** The open row is the record's draft: edited by the grid
 *   since it was opened or saved, it is saved when it is left; a save out
 *   holds the next row until its answer; a row a save did not store is left
 *   through the guard, as the form's draft always is.
 */

/** A cell's editor: a native control the page draws in the cell (cell-editors.tsx). */
export type CellEditor = 'text' | 'number' | 'date' | 'checkbox' | 'select'

/** How a row's cell is edited: in the cell, in the record's form, or never -- and why, where there are words for it. */
export type CellEdit = { kind: 'cell'; editor: CellEditor } | { kind: 'form' } | { kind: 'never'; why: string | null }

/** A field as a record's copy draws it: its definition there -- the state field as its moves -- and whether it is drawn disabled, read-only or hidden. */
export interface DrawnField {
  def: FieldDef
  disabled: boolean
  readOnly: boolean
  visible: boolean
}

/** What a cell asks: the form as published, the row, the field its column shows -- null for a box or a Delete -- and the field as the row's copy draws it. */
export interface CellAsk {
  definition: Pick<PublishedForm, 'form' | 'operations' | 'writable' | 'moves' | 'versions'>
  row: { record: string | null; version: string | null; answers: Readonly<Record<string, unknown>> }
  field: string | null
  drawn: DrawnField | undefined
}

/** What F2 says on a row with a token and no version: a save could not be guarded (0015). */
export const NO_VERSION = 'This row cannot be edited: it holds no version a save is checked against.'

/** What F2 says where this person may not update the form's records. */
export const READ_ONLY = 'You may read these records, not change them.'

/** What F2 says on a version that has ended (0113). */
export const ENDED = 'This version has ended: it is history, and nothing in it changes.'

/** What F2 says on a row whose save is out. */
export const SAVE_WAITED = 'The row is being saved: F2 waits for its answer.'

/** What the line adds to a stale save's sentence: nothing is lost, and where it is discarded. */
export const STALE_KEPT = 'Its changes are kept in the row and its form; Load the saved record in its notice discards them.'

/** What the line adds to a save whose answer was lost (0031). */
export const CHECK_IT = "Check it in the record's notice."

/** A field's copy as its own rules draw it: a rule that holds whatever the answers -- `true` -- and a computed rule, which makes a field read-only (0181). */
export function drawnOf(copy: FormSchema, key: string): DrawnField | undefined {
  const def = copy.model.fields.find((candidate) => candidate.key === key)
  if (def === undefined) return undefined
  const rules = (copy.logic?.rules ?? []).filter((rule) => rule.target === key)
  return {
    def,
    disabled: rules.some((rule) => rule.kind === 'disabled' && rule.cel === 'true'),
    readOnly: rules.some((rule) => rule.kind === 'computed'),
    visible: !rules.some((rule) => rule.kind === 'visible' && rule.cel === 'false'),
  }
}

/** The editor a cell holds `def` in, or null where the record's form edits it. */
export function editorOf(def: FieldDef): CellEditor | null {
  if (def.optionsSource !== undefined) return null
  switch (def.type) {
    case 'text':
      return 'text'
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'checkbox':
      return 'checkbox'
    case 'select':
      return def.options === undefined ? null : 'select'
    default:
      return null
  }
}

/** How a row's cell is edited, and why not, by the rules above. */
export function cellEdit({ definition, row, field, drawn }: CellAsk): CellEdit {
  if (field === null) return { kind: 'never', why: null }
  if (row.record === null) return { kind: 'never', why: CANNOT_OPEN }
  if (row.version === null) return { kind: 'never', why: NO_VERSION }
  if (drawn === undefined) return { kind: 'never', why: null }
  if (drawn.disabled || drawn.readOnly || !drawn.visible) return { kind: 'never', why: whyNot(definition, row.answers, field, drawn) }
  const editor = editorOf(drawn.def)
  return editor === null ? { kind: 'form' } : { kind: 'cell', editor }
}

/** Why a saved record's copy draws `field` as nothing to write, in the words of the rule that drew it so. */
function whyNot(definition: CellAsk['definition'], answers: CellAsk['row']['answers'], field: string, drawn: DrawnField): string {
  const label = fieldHeading(drawn.def)
  if (!definition.operations.includes('update')) return READ_ONLY
  const { versions, moves, writable } = definition
  if (versions !== null && (answers[versions.to] ?? null) !== null) return ENDED
  if (drawn.readOnly) return `${label} is worked out by the record's form.`
  const published = (definition.form.logic?.rules ?? []).some((rule) => rule.target === field && rule.kind === 'disabled' && rule.cel === 'true')
  if (published) return `${label} is not written from this form.`
  const update = writable.update ?? []
  if (!update.includes(field))
    return (writable.create ?? []).includes(field) ? `${label} is given when the record is created.` : `You may read ${label}, not change it.`
  if (!drawn.visible) return `${label} is hidden in the record's form now.`
  if (moves !== null && moves.field === field && drawn.disabled) {
    // A state as the policy spells it: text, or a whole number's digits (0127).
    const held = answers[field]
    const state = typeof held === 'string' || typeof held === 'number' ? String(held) : null
    if (state === null) return `${label} has nowhere to move to.`
    return `${label} cannot move from ${moves.labels.find((entry) => entry.state === state)?.label ?? state}.`
  }
  return `${label} cannot be changed now: the record's form holds it disabled.`
}

/**
 * The open row's state: opened or saved and not edited by the grid since
 * (`clean`); edited by it (`edited`); its save out (`saving`); a save that
 * did not store, with the session's outcome and words (`refused`) -- or a
 * submit the engine refused, which sent nothing (`engine`); and a save
 * whose answer was lost (`unknown`).
 */
export type RowState =
  | { kind: 'clean' }
  | { kind: 'edited' }
  | { kind: 'saving' }
  | { kind: 'refused'; outcome: Exclude<SaveResult['kind'], 'saved' | 'created' | 'unknown'> | 'engine'; message: string }
  | { kind: 'unknown'; message: string }

/** What the row's first cell says after its value: text, read with the row. */
export function markOf(state: RowState): string {
  switch (state.kind) {
    case 'saving':
      return 'Saving…'
    case 'refused':
      return 'Not saved'
    case 'unknown':
      return 'May have been saved'
    default:
      return ''
  }
}

/** The row's state once a save has answered: null where the engine refused the submit and nothing was sent. */
export function settled(result: SaveResult | null): RowState {
  if (result === null) return { kind: 'refused', outcome: 'engine', message: '' }
  if (result.kind === 'saved' || result.kind === 'created') return { kind: 'clean' }
  if (result.kind === 'unknown') return { kind: 'unknown', message: result.message }
  return { kind: 'refused', outcome: result.kind, message: result.message }
}

/** What leaving the open row does: save it first, wait for its save's answer, or go -- through the guard, as today, where it holds work. */
export function leaving(state: RowState, changed: boolean): 'save' | 'wait' | 'go' {
  if (state.kind === 'saving') return 'wait'
  return state.kind === 'edited' && changed ? 'save' : 'go'
}

/** Where Tab -- or Shift+Tab, `backwards` -- goes from the cell of `at` among the row's editable cells shown, in their order: another, or past either end. */
export function stepFrom(cells: readonly string[], at: string, backwards: boolean): { kind: 'cell'; field: string } | { kind: 'past' } {
  const next = cells[cells.indexOf(at) + (backwards ? -1 : 1)]
  return next === undefined ? { kind: 'past' } : { kind: 'cell', field: next }
}

/** What the grid's line says of a save of the row: in the room's teal where it stored (0146), else as a refusal, in the session's words. */
export function outcomeSaid(
  result: SaveResult,
  { noun, token, declinedBy }: { noun: string; token: string; declinedBy: string },
): { said: Said; kind: 'stored' | 'refused' } {
  switch (result.kind) {
    case 'saved':
    case 'created':
      return { said: [`Saved ${noun} `, { code: token }, '.'], kind: 'stored' }
    case 'stale':
      return { said: [`${result.message} `, STALE_KEPT], kind: 'refused' }
    case 'declined':
      return { said: [`${result.message} ${declinedBy}`], kind: 'refused' }
    case 'invalid':
      return { said: [`Not saved. ${result.message}${result.declined === true ? ` ${declinedBy}` : ''}`], kind: 'refused' }
    case 'unknown':
      return { said: [`${result.message} ${CHECK_IT}`], kind: 'refused' }
    default:
      return { said: [result.message], kind: 'refused' }
  }
}

/** What the line says of an invalid save: the field whose cell takes the keyboard, if one is shown, and the rest, which the record's form shows. */
export function invalidSaid(first: string | null, rest: readonly string[]): string {
  if (first !== null) return rest.length === 0 ? `Not saved: ${first} is to fix.` : `Not saved: ${first} is to fix, and ${listed(rest)} in the record's form.`
  return `Not saved: ${listed(rest)} ${rest.length === 1 ? 'is' : 'are'} to fix in the record's form.`
}
