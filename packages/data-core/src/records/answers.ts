import type { ApiValue } from '../codecs/codec.js'
import { codecFor } from '../codecs/codec.js'
import { controlFor } from '../generate/controls.js'
import type { FieldBinding, FormBindings } from '../generate/types.js'
import { decodeKeyToken, encodeKeyToken } from '../lookup/token.js'
import type { ColumnMeta } from '../metadata.js'
import type { FieldError, FormRecord } from './plan-types.js'
import { recordToken } from './token.js'
import type { RecordRead, RecordValue } from './types.js'

/*
 * The one place a form's answer and a column's value are translated, in both
 * directions, so a record read back is the answers that went in.
 *
 * Most answers are the column's canonical value as it is (0008). Three are
 * not, because the generated control holds something else (0009):
 *
 * - a nullable boolean is a radio of 'true' and 'false', because a checkbox
 *   has two answers and the column three;
 * - an integer whose range JavaScript holds is a `number` field, and the codec
 *   returns every integer as canonical text — the released engine reports the
 *   text '42' in a bounded number field as below its minimum;
 * - a lookup is one select holding a token of its foreign-key columns.
 */

type ColumnBinding = Extract<FieldBinding, { kind: 'column' }>
type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/** What the generated control holds for this column, decided by the generator's own `controlFor`, so the two cannot disagree. */
function shapeOf(binding: ColumnBinding): 'three-state' | 'whole-number' | 'as-is' {
  const control = controlFor(binding.type, binding.nullable)
  if (!('field' in control)) return 'as-is'
  if (control.field.type === 'radio') return 'three-state'
  return control.field.type === 'number' && binding.type.kind === 'integer' ? 'whole-number' : 'as-is'
}

const NOT_AN_OPTION = 'This is not one of the options this form offers.'

/**
 * The error for a selection this actor may not make: a token that names no
 * row, names it in another spelling, or names one outside the actor's
 * filters. One answer for all of them, so a probe cannot tell a malformed
 * token from another tenant's row. A caller whose `rejects` check refused a
 * selection answers with this too.
 */
export function rejectedSelection(field: string): FieldError {
  return { field, code: 'not-an-option', message: NOT_AN_OPTION }
}

/*
 * `fixed` holds the root columns whose values the request does not choose,
 * with the value each must keep: a column a row filter pins, which is the
 * context's, and on update every key column, which is the record token's.
 */

export type Decoded = { ok: true; values: RecordValue[] } | { ok: false; error: FieldError }

function written(column: ColumnMeta, value: ApiValue): RecordValue {
  return { name: column.name, type: column.type, value }
}

/**
 * One column field's answer, through its column's codec. A key column the
 * update cannot change is accepted when it equals the record's key and is
 * then not written; a different value is refused, never silently dropped.
 */
export function columnAnswer(binding: ColumnBinding, column: ColumnMeta, answer: unknown, fixed: ReadonlyMap<string, ApiValue>): Decoded {
  let given = answer
  if (shapeOf(binding) === 'three-state') {
    if (answer === 'true') given = true
    else if (answer === 'false') given = false
    else if (answer !== null) return { ok: false, error: { field: binding.field, code: 'type', message: 'Expected yes, no or no answer.' } }
  }
  const parsed = codecFor(column).parse(given)
  if (!parsed.ok) return { ok: false, error: { field: binding.field, code: parsed.code, message: parsed.message } }
  if (!fixed.has(column.name)) return { ok: true, values: [written(column, parsed.value)] }
  if (fixed.get(column.name) === parsed.value) return { ok: true, values: [] }
  return { ok: false, error: { field: binding.field, code: 'read-only', message: "A record's key is not changed by an update." } }
}

/**
 * A lookup's answer as its foreign-key columns' values.
 *
 * A token is decoded and each value put through its root column's codec,
 * which must return it unchanged: a token is spelled exactly as its key holds
 * it, or it is not one (0012). A value for a fixed column must equal it and
 * is not written again: the customer's tenant is the context's, and a
 * selection that would move a record's key is not one this form offers for
 * it. `null` clears every column that is not fixed, as far as each may be NULL.
 *
 * What this cannot know is whether the row exists under the actor's filters.
 * That is `rejects`'s, and the planner hands every token on to it.
 */
export function lookupAnswer(binding: LookupBinding, columns: readonly ColumnMeta[], answer: unknown, fixed: ReadonlyMap<string, ApiValue>): Decoded {
  const notAnOption: Decoded = { ok: false, error: rejectedSelection(binding.field) }
  const free = columns.filter((column) => !fixed.has(column.name))

  if (answer === null) {
    if (free.length === 0) return { ok: false, error: { field: binding.field, code: 'required', message: 'A value is required.' } }
    for (const column of free) {
      const parsed = codecFor(column).parse(null)
      if (!parsed.ok) return { ok: false, error: { field: binding.field, code: parsed.code, message: parsed.message } }
    }
    return { ok: true, values: free.map((column) => written(column, null)) }
  }

  if (typeof answer !== 'string') return notAnOption
  const decoded = decodeKeyToken(answer)
  if (!decoded.ok || decoded.values.length !== columns.length) return notAnOption
  const values: RecordValue[] = []
  for (const [index, column] of columns.entries()) {
    const held = decoded.values[index] as string
    const parsed = codecFor(column).parse(held)
    if (!parsed.ok || parsed.value !== held) return notAnOption
    if (!fixed.has(column.name)) values.push(written(column, held))
    else if (fixed.get(column.name) !== held) return notAnOption
  }
  return { ok: true, values }
}

function readValue(record: RecordRead, column: string): ApiValue {
  if (!Object.hasOwn(record.values, column)) {
    throw new Error(`The record has no value for ${column}: the adapter did not return a column the plan asked for.`)
  }
  return record.values[column] as ApiValue
}

/** A column's canonical value as the generated control holds it. */
function formValue(binding: ColumnBinding, value: ApiValue): ApiValue {
  const shape = shapeOf(binding)
  if (value === null || shape === 'as-is') return value
  if (shape === 'three-state') {
    if (typeof value !== 'boolean') throw new Error(`${binding.column} holds something other than a boolean; a record is canonical out (0015).`)
    return value ? 'true' : 'false'
  }
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${binding.column} holds something other than a canonical whole number; a record is canonical out (0015).`)
  }
  // Safe by construction: the generator makes a number field only for a range JavaScript holds exactly.
  return Number(value)
}

/**
 * A lookup's answer from its foreign-key columns: the token of their values,
 * `null` when any is NULL, and `undefined` — left out of the answers — when the
 * key is too long for a token. Left out rather than `null`, because a form
 * that submitted the `null` back would clear a reference the person never
 * touched; omitted, an update leaves it unchanged.
 *
 * A value that is not text is thrown: every kind a lookup key may have is
 * canonical text (0012), so a number here is an adapter that read through the
 * driver's number handling.
 */
function lookupValue(binding: LookupBinding, values: readonly ApiValue[]): string | null | undefined {
  if (values.includes(null)) return null
  const key: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') throw new Error(`${binding.field} reads a key value that is not text; a record is canonical out (0015).`)
    key.push(value)
  }
  const encoded = encodeKeyToken(key)
  return encoded.ok ? encoded.token : undefined
}

/**
 * A record as the form receives it: one answer per readable field, in the
 * shape its generated control holds, the record token that addresses it, and
 * its version.
 *
 * `readableFields` is what the plan returned; a field outside it is not in
 * the answers whatever the record holds. The values are trusted to be
 * canonical (0015) — a value that is not is an adapter's programming error,
 * and is thrown rather than shown.
 */
export function toFormAnswers(bindings: FormBindings, readableFields: readonly string[], record: RecordRead): FormRecord {
  const readable = new Set(readableFields)
  const answers: Array<[string, ApiValue]> = []
  for (const binding of bindings.fields) {
    if (!readable.has(binding.field)) continue
    if (binding.kind === 'column') {
      answers.push([binding.field, formValue(binding, readValue(record, binding.column))])
      continue
    }
    const token = lookupValue(
      binding,
      binding.columns.map((column) => readValue(record, column)),
    )
    if (token !== undefined) answers.push([binding.field, token])
  }
  const token = bindings.identity === null ? null : recordToken(bindings.identity, record.values)
  // fromEntries defines own properties, so a field called __proto__ is an answer and not a prototype.
  return { record: token?.ok === true ? token.token : null, version: record.version, answers: Object.fromEntries(answers) }
}
