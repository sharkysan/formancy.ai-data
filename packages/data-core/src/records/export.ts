import type { FormSchema } from '@formancy/spec'
import type { ApiValue } from '../codecs/codec.js'
import type { FieldBinding, FormBindings } from '../generate/types.js'
import { displayText, isDisplayType } from '../lookup/display.js'
import type { NormalizedType } from '../metadata.js'
import { canonicalValue } from './answers.js'
import { csvHeader, csvRecord } from './csv.js'
import type { CsvCell, CsvText } from './csv.js'
import type { FormRecord } from './plan-types.js'

/*
 * What a file of a form's records holds (0079): every field the person may
 * read, in the form's order, each cell the text of the value a read returns,
 * and a lookup as its label beside its token. The rows are the list's
 * (`planList`, `recordPage`): the server pages it and hands each record
 * here, with the labels it resolved for the page; csv.ts writes the text.
 *
 * Pure and isomorphic, as the planners are.
 */

/** One field of the file: a column field is one column of it, a lookup two -- its label, then its key. */
export interface ExportField {
  /** The header of its column, or of a lookup's label column: the field's label where it is a string, otherwise its key. */
  header: string
  binding: FieldBinding
}

/** The fields of a file and the header of each of its columns, as `exportColumns` decides them once for every record. */
export interface ExportColumns {
  fields: ExportField[]
  /** One per column of the file: a lookup's `header`, then `<header> (key)`. */
  headers: string[]
}

/**
 * The labels a page's lookups resolved to, under the `read` lookup filter:
 * by lookup field, then by token. A token absent from its field's map has
 * no label this person may see.
 */
export type ExportLabels = ReadonlyMap<string, ReadonlyMap<string, string>>

/**
 * The columns of a file of `form`'s records for a person who may read
 * `readable`, the field keys `planList` returned.
 *
 * In the order of `form.model.fields`, which the host's grid draws (0047),
 * not the bindings' order `readable` is in. A field the person may not read
 * is not in the file, not even empty: its header would say it exists.
 * Headed by the field's label where it is a string -- a label may be a
 * reference into a message catalogue, which no file can resolve -- and
 * otherwise by its key: never the column's name, which no page shows
 * (0050). Labels can repeat; a header is not a key.
 */
export function exportColumns(form: FormSchema, bindings: FormBindings, readable: readonly string[]): ExportColumns {
  const wanted = new Set(readable)
  const bound = new Map(bindings.fields.map((binding) => [binding.field, binding]))
  const fields: ExportField[] = []
  for (const field of form.model.fields) {
    const binding = bound.get(field.key)
    if (binding === undefined || !wanted.has(field.key)) continue
    fields.push({ header: typeof field.label === 'string' ? field.label : field.key, binding })
  }
  if (fields.length !== wanted.size) throw new Error('A readable field is not a bound field of the form, so the file cannot place it.')
  const headers = fields.flatMap(({ header, binding }) => (binding.kind === 'lookup' ? [header, `${header} (key)`] : [header]))
  return { fields, headers }
}

/** The file's first line: the byte-order mark and the header row, present when no record follows. */
export function exportHeader(columns: ExportColumns): CsvText {
  return csvHeader(columns.headers)
}

/**
 * The text a cell holds for one value a read returns, or null for SQL NULL:
 * `displayText`'s spelling, one for both engines (0028), except a time and
 * a timestamp, which a label cuts and a file holds as read -- a zoneless
 * timestamp with its fraction. An instant is read to the second and a time
 * to the minute already (0040), so the file holds no more of either than a
 * read does.
 *
 * Throws on a kind with no canonical text (binary, rowversion,
 * unsupported), which the generator never binds, and on a value of the
 * wrong JavaScript type for its kind.
 */
export function exportText(type: NormalizedType, value: ApiValue): string | null {
  if (!isDisplayType(type)) throw new Error(`A ${type.kind} column has no text a file can hold.`)
  if (value === null || (type.kind !== 'time' && type.kind !== 'timestamp')) return displayText(type, value)
  if (typeof value !== 'string') throw new Error(`A ${type.kind} value cannot be a ${typeof value}: the adapter decoded it with another column's type.`)
  return value
}

/** The cells of one field: its value, or a lookup's label and token. */
function cellsOf({ header, binding }: ExportField, answers: FormRecord['answers'], labels: ExportLabels): CsvCell[] | null {
  const answered = Object.hasOwn(answers, binding.field)
  if (binding.kind === 'column') {
    if (!answered) throw new Error(`The record has no answer for ${binding.field}, a field the person may read.`)
    return [exportText(binding.type, canonicalValue(binding, answers[binding.field] as ApiValue))]
  }
  const resolved = labels.get(binding.field)
  if (resolved === undefined) throw new Error(`No labels were resolved for ${binding.field}.`)
  // toFormAnswers leaves a lookup out when its key does not fit a token.
  if (!answered) return null
  const token = answers[binding.field] as string | null
  return token === null ? [null, null] : [resolved.get(token) ?? null, token]
}

/**
 * One record of the file, with the labels resolved for its page -- or
 * `unencodable` for a cell the file cannot carry: text with an unpaired
 * surrogate or a NUL, or a lookup whose key no token can carry, which
 * written empty would read as no reference at all. The refusal names the
 * header, never the value (0011).
 *
 * A record with no token is written: its key did not fit one, and its
 * fields are its data. Throws for a lookup the caller resolved no labels
 * for, which would otherwise be a file of empty labels that looks whole.
 */
export function exportRecord(columns: ExportColumns, record: FormRecord, labels: ExportLabels): CsvText {
  const cells: CsvCell[] = []
  for (const field of columns.fields) {
    const written = cellsOf(field, record.answers, labels)
    if (written === null) return { ok: false, code: 'unencodable', message: `${field.header} names a row whose key is too long for a token, so a file cannot say which.` }
    cells.push(...written)
  }
  return csvRecord(columns.headers, cells)
}
