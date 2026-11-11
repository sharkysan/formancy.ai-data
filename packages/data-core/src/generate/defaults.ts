import type { FieldDef } from '@formancy/spec'
import type { DatabaseKind } from '../adapter.js'
import type { Codec } from '../codecs/codec.js'
import { codecFor, codecForType } from '../codecs/codec.js'
import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import { formValue, storedValue } from '../records/answers.js'
import type { FieldBinding, GenerationNote } from './types.js'

/*
 * A new record starts with its column's constant default (0149): spec 5's
 * `default`, the answer a fresh form starts with and never a record opened,
 * a copy or a draft (formancy.ai 0197). The snapshot holds each default as
 * discovery spells it -- PostgreSQL's `pg_get_expr`, SQL Server's
 * `object_definition` -- and this file reads a constant out of that
 * spelling per engine, as `offers.ts` reads a key's default (0057), with no
 * fact added to the snapshot. A constant is put through the column's codec
 * and `formValue`, the way a record holding it is read back, so the answer
 * is of the field's own type and in its canonical spelling, and is taken
 * only where the field would take it: the engine refuses to open a document
 * with a default its field refuses.
 *
 * Constants only -- a string, a number, a truth value -- and only what each
 * engine's catalog spells in one way: a function the database calls on
 * every create, a sequence, NULL or an expression is no default, and so is
 * any spelling not read with certainty. No default beats a wrong one: the
 * field starts empty, and the database fills it when the create leaves it
 * out, as before.
 */

/** A constant as a column's default spells it: text, a number's decimal digits, or a truth value. `national` is T-SQL's N prefix. */
export type Constant = { kind: 'text'; text: string; national: boolean } | { kind: 'number'; text: string } | { kind: 'boolean'; value: boolean }

/**
 * Whether `text` holds a C0 control or DEL that `field`'s box draws otherwise
 * than the column holds it: any, in a one-line box, which draws a line break
 * or a tab otherwise; any but a line feed or a tab in a multi-line one,
 * which keeps those two -- a carriage return it reads back as a line feed.
 */
function drawnOtherwise(field: FieldDef, text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (field.type === 'textarea' && (code === 0x0a || code === 0x09)) continue
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** What every code page SQL Server reads a literal in holds alike. */
const ASCII = /^[ -~]*$/

/**
 * PostgreSQL's spellings, as `get_const_expr` deparses a stored default: an
 * integer or a decimal bare, when it reads back as itself; a negative one,
 * or one of a type that must be named, quoted and cast -- `'-1'::integer`,
 * `'9007199254740993'::bigint`, `'-1.5'::numeric`; text quoted, its quotes
 * doubled, and cast to the column's type with no modifier. An implicit
 * cast to the column's own type is not shown, so `1` is a bigint column's
 * default too. `E'…'` is never written.
 */
const POSTGRES_BARE = /^([0-9]+(?:\.[0-9]+)?)$/
const POSTGRES_NUMBER = /^'(-?[0-9]+(?:\.[0-9]+)?)'::(?:integer|bigint|smallint|numeric)$/
const POSTGRES_TEXT = /^'((?:[^']|'')*)'::(?:text|character varying|bpchar)$/

/** SQL Server's spellings, as it writes a default's definition again from its parse: a number in two pairs of parentheses, text in one, N before a national literal. */
const SQLSERVER_NUMBER = /^\(\((-?[0-9]+(?:\.[0-9]+)?)\)\)$/
const SQLSERVER_TEXT = /^\((N?)'((?:[^']|'')*)'\)$/

function textConstant(quoted: string, national: boolean): Constant {
  return { kind: 'text', text: quoted.replaceAll("''", "'"), national }
}

function readPostgres(expression: string): Constant | null {
  if (expression === 'true' || expression === 'false') return { kind: 'boolean', value: expression === 'true' }
  const [, number] = POSTGRES_BARE.exec(expression) ?? POSTGRES_NUMBER.exec(expression) ?? []
  if (number !== undefined) return { kind: 'number', text: number }
  const [, quoted] = POSTGRES_TEXT.exec(expression) ?? []
  // A backslash is itself under standard_conforming_strings and an escape
  // without it, and the snapshot does not say which the server spelled by.
  if (quoted === undefined || quoted.includes('\\')) return null
  return textConstant(quoted, false)
}

function readSqlServer(expression: string): Constant | null {
  const [, number] = SQLSERVER_NUMBER.exec(expression) ?? []
  if (number !== undefined) return { kind: 'number', text: number }
  const [, prefix, quoted] = SQLSERVER_TEXT.exec(expression) ?? []
  return prefix === undefined || quoted === undefined ? null : textConstant(quoted, prefix === 'N')
}

/** The constant `expression` is, as `kind`'s catalog spells a column's default; `null` where it is none, or none read with certainty. */
export function readConstant(kind: DatabaseKind, expression: string): Constant | null {
  return kind === 'postgres' ? readPostgres(expression) : readSqlServer(expression)
}

/** A whole number's digits as the codec takes them: no leading zero, no negative zero. Its value, not a guess at one. */
function withoutLeadingZeros(digits: string): string {
  const trimmed = digits.replace(/^(-?)0+(?=[0-9])/, '$1')
  return trimmed === '-0' ? '0' : trimmed
}

/**
 * What the codec of `column` is handed for `constant`: the value the
 * database stores for it, or `undefined` where the constant is not one of
 * the column's kind read with certainty. A date, a time, an instant, a uuid
 * and a float are left to the database: their text is the session's or
 * rounds otherwise than a page would.
 */
function asStored(kind: DatabaseKind, constant: Constant, column: ColumnMeta): unknown {
  const type = column.type
  switch (type.kind) {
    case 'text':
      if (constant.kind !== 'text') return undefined
      // SQL Server reads a literal without N in the database's code page,
      // and converts an N literal written to a varchar to the column's:
      // past ASCII, only an N literal on an nvarchar is the text it spells.
      if (kind === 'sqlserver' && !ASCII.test(constant.text) && !(constant.national && type.lengthUnit === 'utf16-code-units')) return undefined
      return constant.text
    case 'boolean':
      if (constant.kind === 'boolean') return constant.value
      // A bit's default is ((1)) or ((0)); ((2)) is stored as 1, a conversion not read.
      return constant.kind === 'number' && (constant.text === '0' || constant.text === '1') ? constant.text === '1' : undefined
    case 'integer':
      return constant.kind === 'number' ? withoutLeadingZeros(constant.text) : undefined
    case 'decimal':
      return constant.kind === 'number' ? constant.text : undefined
    default:
      return undefined
  }
}

/** A value as a note says it: quoted, as the generator's other sentences quote one, so blanks are seen and a value ends where its quote does. */
function quoted(value: string): string {
  return `“${value}”`
}

function shown(constant: Constant): string {
  return quoted(constant.kind === 'boolean' ? String(constant.value) : constant.text)
}

type ColumnBinding = Extract<FieldBinding, { kind: 'column' }>

/** What a field starts with: its column's default as its answer, a constant it refuses and why, or nothing to say. */
export type Starting = { kind: 'none' } | { kind: 'starts'; answer: string | number | boolean } | { kind: 'refused'; shown: string; reason: string }

const NONE: Starting = { kind: 'none' }

/** The codec's sentence inside the generator's: its first letter lowered, its full stop dropped. */
function clause(sentence: string): string {
  return `${sentence.charAt(0).toLowerCase()}${sentence.slice(1).replace(/\.$/, '')}`
}

/**
 * The answer `field`, bound to `column` by `binding`, starts with on a new
 * record: the column's constant default through its codec, as a record
 * holding it is read back (`formValue`). A constant the codec refuses --
 * too long, out of range, a fraction for a whole number or past the scale
 * -- is no answer a save of the field could send, whatever the database
 * would do with it at the insert, and is refused here. So is text the column holds and the field's box does not: the
 * codec counts in the column's unit, the box in UTF-16 code units, never
 * fewer. An empty answer is none -- '' itself, or a fixed-length column's
 * blanks, which the codec reads without their padding as the column is
 * read back: it is the field as it starts anyway, and spec 5 refuses an
 * empty default, so a document carrying one is never published.
 */
export function startingAnswer(kind: DatabaseKind, column: ColumnMeta, binding: ColumnBinding, field: FieldDef): Starting {
  const constant = column.defaultExpression === null ? null : readConstant(kind, column.defaultExpression)
  const stored = constant === null ? undefined : asStored(kind, constant, column)
  if (constant === null || stored === undefined) return NONE
  const taken = answerTaken(codecFor(column), binding, field, stored)
  if (taken.kind === 'refused') return { kind: 'refused', shown: shown(constant), reason: taken.reason }
  return taken.answer === '' ? NONE : { kind: 'starts', answer: taken.answer }
}

type Taken = { kind: 'answer'; answer: string | number | boolean } | { kind: 'refused'; reason: string }

/**
 * `stored`, a value the column would store and never null, as the answer
 * `field` starts with: through the column's codec and `formValue`, as a
 * record holding it is read back, and only where the field's box holds it:
 * draws it as the column holds it (`drawnOtherwise`), and counts it within
 * its UTF-16 code units, never fewer than the codec counts in the column's
 * unit. The one reading of a starting answer, the column's
 * constant's (`startingAnswer`) and an administrator's (`givenStart`) alike.
 */
function answerTaken(codec: Codec, binding: ColumnBinding, field: FieldDef, stored: unknown): Taken {
  const parsed = codec.parse(stored)
  if (!parsed.ok) return { kind: 'refused', reason: clause(parsed.message) }
  // Never null: the codec was handed a value, and returns one.
  const answer = formValue(binding, parsed.value) as string | number | boolean
  if (typeof answer === 'string' && drawnOtherwise(field, answer)) {
    return {
      kind: 'refused',
      reason:
        field.type === 'textarea'
          ? 'it holds a control character other than a line feed or a tab, which a box draws otherwise'
          : 'it holds a line break, a tab or another control character, which a one-line box draws otherwise',
    }
  }
  if (typeof answer === 'string' && field.maxLength !== undefined && answer.length > field.maxLength) {
    return { kind: 'refused', reason: `longer than the ${String(field.maxLength)} UTF-16 code units the field holds` }
  }
  return { kind: 'answer', answer }
}

/** A starting value an administrator gives a field (0150): its answer as a record holding it reads back, or why the field does not take it. */
export type GivenStart = { ok: true; answer: string | number | boolean } | { ok: false; reason: string }

/**
 * `value`, given as the answer `field`, bound to its column by `binding`,
 * starts a new record with (0150), read as `startingAnswer` reads the
 * column's constant: held as the column stores it (`storedValue`), then
 * `answerTaken`, so it is refused for what the codec or the box refuses,
 * and its answer is the canonical one a record holding it reads back as --
 * `9.5000` for `9.5` in a numeric(18,4). An empty answer is refused: it is
 * the field as it starts, and spec 5 takes no empty default. The codec is
 * the binding's type's (`codecForType`), the column itself not being at
 * hand where a presentation is applied.
 */
export function givenStart(binding: ColumnBinding, field: FieldDef, value: string | number | boolean): GivenStart {
  const stored = storedValue(binding, value)
  return stored.ok ? storedStart(binding, field, stored.value) : { ok: false, reason: stored.reason }
}

/**
 * `stored`, a value a column of `binding`'s type would store, as the
 * answer `field` starts with: `givenStart` from the stored value rather
 * than from an answer, which a rebase asks of a value stored under the
 * bindings before (0150) -- the same stored value under a new spelling, or
 * why the new field refuses it.
 */
export function storedStart(binding: ColumnBinding, field: FieldDef, stored: unknown): GivenStart {
  const taken = answerTaken(codecForType(binding.type, binding.nullable), binding, field, stored)
  if (taken.kind === 'refused') return { ok: false, reason: taken.reason }
  if (taken.answer === '') return { ok: false, reason: 'it is empty, which is how the field starts without one' }
  return { ok: true, answer: taken.answer }
}

/**
 * Every field the create writes, started with its column's default where
 * the field takes it, and a note for each default taken or refused. Only a
 * field the create writes: a pinned column is the context's, a key the
 * database fills its own (0056), a column the account may not insert and a
 * view's are written by nobody, so a default shown there is a value the
 * person cannot give. A lookup starts empty: its answer is a record, and
 * the record a default names may be one this person may not choose -- the
 * note leaves it to the database.
 */
export function startWithDefaults(
  kind: DatabaseKind,
  root: ObjectMeta,
  planned: ReadonlyArray<{ field: FieldDef; binding: FieldBinding }>,
  notes: GenerationNote[],
): void {
  const columnOf = (name: string) => root.columns.find((column) => column.name === name) as ColumnMeta
  for (const entry of planned) {
    const { binding } = entry
    if (!binding.writes.create) continue
    const subject = binding.field
    if (binding.kind === 'lookup') {
      for (const column of binding.columns.map(columnOf)) {
        const constant = column.defaultExpression === null ? null : readConstant(kind, column.defaultExpression)
        if (constant === null) continue
        notes.push({
          subject,
          kind: 'inferred',
          message: `Starts empty: the default of ${column.name}, ${shown(constant)}, is left to the database, which fills it when a create leaves the field out: a lookup's answer is a record, and the one a default names may be one this person may not choose.`,
        })
      }
      continue
    }
    const starting = startingAnswer(kind, columnOf(binding.column), binding, entry.field)
    if (starting.kind === 'starts') {
      entry.field = { ...entry.field, default: starting.answer }
      notes.push({ subject, kind: 'inferred', message: `Starts with the column's default, ${quoted(String(starting.answer))}.` })
    } else if (starting.kind === 'refused') {
      notes.push({
        subject,
        kind: 'inferred',
        message: `Starts empty: the column's default, ${starting.shown}, is not an answer the field takes (${starting.reason}), so the database fills it when a create leaves the field out.`,
      })
    }
  }
}
