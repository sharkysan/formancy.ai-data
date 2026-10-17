/*
 * The text of an exported file (0079): RFC 4180, comma-separated, a record
 * per line ended by CRLF, the last included, in UTF-8 after a byte-order
 * mark. Pure and isomorphic: the server counts the bytes, since `data-core`
 * has no `TextEncoder` typing (formancy.ai 0008).
 *
 * - A cell is quoted when it holds `"`, `,`, CR or LF, or is the empty
 *   string; a quote inside is doubled. A line break inside a value is
 *   written as stored, inside the quotes. NULL is an empty cell, unquoted:
 *   PostgreSQL's COPY CSV convention, by which a reader that knows it tells
 *   '' from NULL. Excel cannot.
 * - A byte-order mark first: without one, Excel on Windows reads the file in
 *   the system's code page. A reader that does not expect one glues U+FEFF
 *   to the first header (Python's csv without `utf-8-sig`, cut, awk).
 * - Comma, always. Excel in a locale whose list separator is `;` opens the
 *   file as one column; a `sep=,` line would fix Excel and be a data row to
 *   everything else, so none is written.
 *
 * And one rule against formula injection (CWE-1236): a cell that starts
 * with one of OWASP's formula characters -- `=`, `+`, `-`, `@`, TAB, CR --
 * and is not a number gets one apostrophe in front, and so does a cell that
 * already starts with an apostrophe. So taking one leading apostrophe off
 * every cell that has one gives back every cell exactly. What it costs: a
 * phone number `+41 …`, an `@handle` or PostgreSQL's `-Infinity` carries an
 * apostrophe the database does not hold. Not covered: a cell starting with
 * a space, or a full-width `＝`, which OWASP's list does not name.
 */

/** The byte-order mark the file starts with. */
const BOM = '﻿'

/** What ends every record of the file, the last included. */
const CRLF = '\r\n'

/** A cell as the file holds it before quoting: text, or NULL. */
export type CsvCell = string | null

/** A cell's text the file cannot carry: an unpaired surrogate, which UTF-8 has no spelling for, or a NUL. */
export interface CsvRefusal {
  ok: false
  code: 'unencodable'
  /** Names the column, never the value (0011). */
  message: string
}

/** Text of the file -- a header or one record, ended by CRLF -- or why it cannot be written. */
export type CsvText = { ok: true; text: string } | CsvRefusal

/** Where a spreadsheet starts reading a formula. */
const FORMULA_START = /^[=+\-@\t\r]/
/** A number a spreadsheet reads as one: every canonical integer and decimal, and every `String(n)` of a finite float. */
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/
/** In `u` mode a surrogate pair is one code point and only an unpaired surrogate is `Cs`. */
const UNENCODABLE = /[\p{Cs}\u0000]/u
const NEEDS_QUOTES = /[",\r\n]/

/** One apostrophe in front of a formula's start or an apostrophe, so one taken off every cell that has one gives back the cell. */
function neutralised(cell: string): string {
  return cell.startsWith("'") || (FORMULA_START.test(cell) && !NUMBER.test(cell)) ? `'${cell}` : cell
}

function quoted(cell: CsvCell): string {
  if (cell === null) return ''
  const text = neutralised(cell)
  return text === '' || NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function unencodable(message: string): CsvRefusal {
  return { ok: false, code: 'unencodable', message }
}

const line = (cells: readonly CsvCell[]): string => `${cells.map(quoted).join(',')}${CRLF}`

/** The file's first line: the byte-order mark, then a cell per header. A header is a cell, and is neutralised as one. */
export function csvHeader(headers: readonly string[]): CsvText {
  const bad = headers.findIndex((header) => UNENCODABLE.test(header))
  if (bad >= 0) return unencodable(`The header of column ${String(bad + 1)} holds text a CSV file cannot carry: an unpaired surrogate or a NUL character.`)
  return { ok: true, text: `${BOM}${line(headers)}` }
}

/**
 * One record of the file: a cell per column, under `headers`, which name a
 * column whose cell cannot be written. Throws when the two differ in
 * number: a record and its header that disagree are the caller's mistake.
 */
export function csvRecord(headers: readonly string[], cells: readonly CsvCell[]): CsvText {
  if (cells.length !== headers.length) throw new Error(`A record of ${String(cells.length)} cells under ${String(headers.length)} headers.`)
  const bad = cells.findIndex((cell) => cell !== null && UNENCODABLE.test(cell))
  if (bad >= 0) return unencodable(`${headers[bad] as string} holds text a CSV file cannot carry: an unpaired surrogate or a NUL character.`)
  return { ok: true, text: line(cells) }
}
