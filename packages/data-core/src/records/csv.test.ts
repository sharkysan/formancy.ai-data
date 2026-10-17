import { describe, expect, test } from 'vitest'
import { csvHeader, csvRecord } from './csv.js'

/*
 * The text of an exported file (0079): RFC 4180, UTF-8 with a byte-order
 * mark, and one apostrophe in front of a cell a spreadsheet would read as a
 * formula, by a rule a reader undoes exactly. Each case is read back by the
 * strict reader below, never by matching the text the writer happened to
 * produce, so a quoting rule that is wrong reads back as other cells.
 */

/**
 * RFC 4180 read back: a cell quoted or not, a record ending at a line break
 * outside quotes -- CRLF, LF or CR, as the spreadsheets that open the file
 * end one -- and an unquoted empty cell read as NULL, a quoted one as ''.
 * Throws on a file whose last record has no line break after it.
 */
function readBack(file: string): Array<Array<string | null>> {
  const records: Array<Array<string | null>> = []
  let record: Array<string | null> = []
  let at = 0
  while (at < file.length) {
    let cell: string | null
    if (file[at] === '"') {
      let text = ''
      let from = at + 1
      for (;;) {
        const quote = file.indexOf('"', from)
        if (quote < 0) throw new Error('a quoted cell never ends')
        text += file.slice(from, quote)
        if (file[quote + 1] !== '"') {
          at = quote + 1
          break
        }
        text += '"'
        from = quote + 2
      }
      cell = text
    } else {
      let end = at
      while (end < file.length && !',\r\n'.includes(file[end] as string)) end += 1
      cell = end === at ? null : file.slice(at, end)
      at = end
    }
    record.push(cell)
    if (file[at] === ',') {
      at += 1
      continue
    }
    if (file.startsWith('\r\n', at)) at += 2
    else if (file[at] === '\r' || file[at] === '\n') at += 1
    else throw new Error(`a record does not end with a line break at ${String(at)}`)
    records.push(record)
    record = []
  }
  return records
}

/** One record of `cells` under headers of the same number, as the file holds it. */
function recordOf(cells: ReadonlyArray<string | null>): string {
  const written = csvRecord(
    cells.map((_, index) => `Column ${String(index + 1)}`),
    cells,
  )
  if (!written.ok) throw new Error(written.message)
  return written.text
}

/** The rule a reader undoes the neutralisation by: one leading apostrophe off every cell that has one. */
const undone = (cell: string | null): string | null => (cell !== null && cell.startsWith("'") ? cell.slice(1) : cell)

describe('a record', () => {
  // A comma, a quote or a line break outside quotes splits a cell or a
  // record. Watched failing with quoting on a comma alone: the value holding
  // a line feed read back as a record more.
  test('quotes a value holding a comma, a quote, CR, LF or CRLF, doubling the quote, so each reads back as one cell', () => {
    const cells = ['a,b', 'say "hi"', 'one\rtwo', 'one\ntwo', 'one\r\ntwo', 'plain']
    const text = recordOf(cells)
    expect(readBack(text)).toEqual([cells])
    expect(text).toBe('"a,b","say ""hi""","one\rtwo","one\ntwo","one\r\ntwo",plain\r\n')
  })

  // Both engines tell '' from NULL, and so does PostgreSQL's COPY CSV: NULL
  // unquoted and empty, '' quoted. Watched failing with both written empty.
  test('writes NULL as an empty cell and the empty string as a quoted one', () => {
    expect(recordOf([null, '', 'x'])).toBe(',"",x\r\n')
    expect(readBack(recordOf([null, '', null]))).toEqual([[null, '', null]])
  })

  // RFC 4180 ends every record with CRLF, the last included; Excel on
  // Windows reads a file without a byte-order mark in the system's code
  // page, Zürich-01 as ZÃ¼rich-01.
  test('ends every record with CRLF, and the file starts with a byte-order mark before the header', () => {
    const header = csvHeader(['Reference', 'Weight kg'])
    expect(header).toEqual({ ok: true, text: '﻿Reference,Weight kg\r\n' })
    expect(recordOf(['Zürich-01', null])).toBe('Zürich-01,\r\n')
  })

  // A record with a cell more or fewer than its header shifts every column
  // after the gap; the caller's mistake is thrown, not written.
  test('throws when its cells and the headers differ in number', () => {
    expect(() => csvRecord(['Reference'], ['a', 'b'])).toThrow('2 cells under 1 headers')
  })
})

describe('a cell a spreadsheet would read as a formula (CWE-1236)', () => {
  // OWASP's characters that start a formula: =, +, -, @, TAB and CR. Each
  // such text gets one apostrophe, and a cell that already starts with one
  // gets another, so the rule can be undone. Watched failing with the
  // header left out of it: an administrator's label is a cell too.
  test('gets one apostrophe in front, in a value and in a header alike', () => {
    const formulas = ['=1+1', '+41 44 123 45 67', "-2+3+cmd|' /C calc'!A0", '@handle', '\tx', '\rx', "'a"]
    expect(readBack(recordOf(formulas))).toEqual([["'=1+1", "'+41 44 123 45 67", "'-2+3+cmd|' /C calc'!A0", "'@handle", "'\tx", "'\rx", "''a"]])
    const header = csvHeader(['=SUM(A1)', 'Name'])
    expect(header.ok && readBack(header.text.slice(1))).toEqual([["'=SUM(A1)", 'Name']])
  })

  // A number a spreadsheet reads is not a formula, and a leading minus is
  // how a negative one is written: customer 2004's credit limit -1.00 must
  // stay the value it is. Watched failing with every leading - prefixed.
  test('leaves a number alone, a negative one included, and nothing else that starts with -', () => {
    const numbers = ['-1.00', '-5', '-1.5e+21', '-0.30000000000000004', '0', '99999999999999.9999', '1e-7']
    expect(readBack(recordOf(numbers))).toEqual([numbers])
    expect(readBack(recordOf(['-Infinity', '-', '-1.', '-.5', '- 1', '-01', '+5']))).toEqual([["'-Infinity", "'-", "'-1.", "'-.5", "'- 1", "'-01", "'+5"]])
  })

  // Exactness is the first promise (0008): the file changes a text cell
  // only so that it can be changed back. Watched failing with an apostrophe
  // already there left single: 'a read back as a.
  test('is undone exactly by taking one leading apostrophe off every cell that has one', () => {
    const values = ['=1+1', "'", "''", "'=1+1", "'a", '-1.00', '-x', '@', '+', '\t', '\r\n=x', 'plain', '', "it's", '=HYPERLINK("http://x","y")']
    const [read] = readBack(recordOf(values))
    expect((read ?? []).map(undone)).toEqual(values)
  })
})

describe('text a file cannot carry', () => {
  // UTF-8 has no spelling for an unpaired surrogate, which SQL Server's
  // nvarchar keeps (0026), and a NUL ends a cell for every reader built on C
  // strings. The JSON list carries both; the file refuses rather than write
  // U+FFFD in silence, and names the column and never the value (0011).
  test('refuses an unpaired surrogate and a NUL, naming the header and not the value', () => {
    for (const cell of ['\ud800a', 'a\udc00', 'a\u0000b']) {
      const written = csvRecord(['Reference', 'Secret column'], ['ok', cell])
      expect(written).toMatchObject({ ok: false, code: 'unencodable' })
      if (written.ok) continue
      expect(written.message).toContain('Secret column')
      expect(written.message).not.toContain(cell)
    }
    const header = csvHeader(['Reference', 'Bad\u0000label'])
    expect(header).toMatchObject({ ok: false, code: 'unencodable' })
    expect(header.ok ? '' : header.message).toContain('column 2')
  })

  // A surrogate pair is one character UTF-8 spells: a check that refused
  // every surrogate would refuse an emoji.
  test('carries a surrogate pair', () => {
    expect(readBack(recordOf(['🚚 Zürich']))).toEqual([['🚚 Zürich']])
  })
})
