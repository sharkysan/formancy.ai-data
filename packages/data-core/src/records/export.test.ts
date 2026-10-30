import type { FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import type { ApiValue } from '../codecs/codec.js'
import { displayText } from '../lookup/display.js'
import type { LookupDisplayType } from '../lookup/types.js'
import type { NormalizedType } from '../metadata.js'
import { applyPresentation } from '../presentation/apply.js'
import { exportFileName } from '../runtime.js'
import { toFormAnswers } from './answers.js'
import { exportColumns, exportHeader, exportRecord, exportText } from './export.js'
import type { ExportColumns, ExportLabels } from './export.js'
import { planList } from './list.js'
import { AUDITOR, CLERK, ORDER_ID, ORDER_POLICY, ORDER_TOKEN, orderForm, PG } from './test-support.js'

/*
 * What an exported file holds (0079): the fields a person may read, in the
 * order the host's grid draws them, each cell the text of the value a read
 * returns -- never a label's cut -- and a lookup as its label beside its
 * token. The text is csv.ts's; csv.test.ts holds it.
 */

const ORDER = orderForm(PG)
const EVERYTHING = { search: '', sort: [], parent: null, filter: [], after: null, limit: 50 }

/** The fields `planList` lets `who` read, in the bindings' order: what the server hands the export. */
function readableBy(who: typeof CLERK): string[] {
  const plan = planList(PG, ORDER.bindings, ORDER_POLICY, who, EVERYTHING)
  if (!plan.ok) throw new Error(plan.message)
  return plan.fields
}

const headersOf = (columns: ExportColumns): string[] => columns.headers

/** A stored order as an adapter returns it, canonical (0015): the fixture's, with its 2^53 + 1 key and largest amount. */
const STORED: Record<string, ApiValue> = {
  id: ORDER_ID,
  tenant_id: '1',
  customer_no: '1001',
  order_date: '2026-10-08',
  status: 'placed',
  amount: '99999999999999.9999',
  notes: null,
  group: 'A',
  created_by: '1',
  approved_by: '2',
  paid: true,
}

/** The labels a page's resolves gave, by field and token. */
const LABELS: ExportLabels = new Map([
  ['customer', new Map([['k1:1,1001', 'Muster AG']])],
  ['employee', new Map<string, string>()],
])

describe('the columns of a file', () => {
  // The file's header row is the grid's: the readable fields in the form's
  // order, as the host's columnsOf draws them, a lookup's label under the
  // field's label and its token under "<label> (key)". The generator writes
  // the model and the bindings in one order, so the model is rearranged
  // here by hand. Watched failing in the bindings' order.
  test('are the readable fields in the form’s order, a lookup as its label and its key', () => {
    const fields = readableBy(CLERK)
    expect(headersOf(exportColumns(ORDER.form, ORDER.bindings, fields))).toEqual([
      'Id',
      'Customer',
      'Customer (key)',
      'Order date',
      'Status',
      'Amount',
      'Notes',
      'Group',
      'Employee',
      'Employee (key)',
      'Approved by',
      'Paid',
    ])
    const rearranged: FormSchema = { ...ORDER.form, model: { fields: [...ORDER.form.model.fields].reverse() } }
    expect(headersOf(exportColumns(rearranged, ORDER.bindings, fields))).toEqual([
      'Paid',
      'Approved by',
      'Employee',
      'Employee (key)',
      'Group',
      'Notes',
      'Amount',
      'Status',
      'Order date',
      'Customer',
      'Customer (key)',
      'Id',
    ])
  })

  // A field the policy hides is not in the file, not even empty: its header
  // would tell the auditor it exists. Watched failing with every bound field
  // exported.
  test('leave out a field the policy does not let this person read', () => {
    const fields = readableBy(AUDITOR)
    expect(fields).not.toContain('notes')
    expect(headersOf(exportColumns(ORDER.form, ORDER.bindings, fields))).toEqual(['Id', 'Order date', 'Status'])
  })

  // A label is Text: a string, or `{ $t }`, a reference into the form's
  // i18n catalogue, which a file has no locale to resolve. A presentation
  // may say one, and formancy's validator, which validateBundle runs on
  // every form it publishes or reads, refuses it in a form with no i18n
  // section -- which neither the generator nor a presentation writes. A
  // format-1 form, served as it was stored, can have one. So the file is
  // headed by the key there, where the grid's String(label) would head the
  // column "[object Object]".
  test('are headed by the field’s key where its label is not a string', () => {
    const presented = applyPresentation(ORDER.form, { version: 1, fields: [{ field: 'status', anchor: { kind: 'column', column: 'status' }, label: { $t: 'order.status' } }], sections: [] }, ORDER.bindings)
    if (!presented.ok) throw new Error(presented.problems.join('; '))
    expect(validateSchema(presented.form)).toMatchObject({ valid: false, errors: [{ code: 'i18n.noSection' }] })
    const stored: FormSchema = { ...presented.form, i18n: { defaultLocale: 'de', messages: { de: { 'order.status': 'Status' } } } }
    expect(validateSchema(stored)).toMatchObject({ valid: true })
    expect(headersOf(exportColumns(stored, ORDER.bindings, readableBy(AUDITOR)))).toEqual(['Id', 'Order date', 'status'])
  })

  // The header row is the first line, after the byte-order mark. Without
  // the mark, an otherwise correct file is left to a reader that guesses
  // its encoding -- Excel on Windows takes the system's code page, by
  // report and not tried -- and every non-ASCII cell arrives garbled; a
  // header not on the first line would be read as a record.
  test('head the file', () => {
    expect(exportHeader(exportColumns(ORDER.form, ORDER.bindings, readableBy(AUDITOR)))).toEqual({ ok: true, text: '﻿Id,Order date,Status\r\n' })
  })
})

describe('a record of a file', () => {
  const columns = exportColumns(ORDER.form, ORDER.bindings, readableBy(CLERK))
  const record = (values: Record<string, ApiValue>) => toFormAnswers(ORDER.bindings, readableBy(CLERK), { ok: true, values, version: '1' })

  // A record arrives as the form's answers (toFormAnswers), whose shapes are
  // the controls': a whole number a number field holds is a number, a
  // nullable boolean the select's 'true'. The file holds the column's value,
  // and a lookup's label beside the token it resolved from; a label the
  // resolve did not give -- a row outside the lookup's read filter -- is an
  // empty cell, never the token. The 2^53 + 1 key and the largest amount go
  // digit for digit.
  test('holds each value as the column’s canonical text, and a lookup’s label beside its token', () => {
    expect(exportRecord(columns, record(STORED), LABELS)).toEqual({
      ok: true,
      text: `${ORDER_ID},Muster AG,"k1:1,1001",2026-10-08,placed,99999999999999.9999,,A,,k1:1,2,true\r\n`,
    })
    expect(exportRecord(columns, record({ ...STORED, created_by: null, paid: null, approved_by: null }), LABELS)).toEqual({
      ok: true,
      text: `${ORDER_ID},Muster AG,"k1:1,1001",2026-10-08,placed,99999999999999.9999,,A,,,,\r\n`,
    })
  })

  // A record with no token -- its key does not fit one -- is still a row of
  // the list, and its fields are its data: it is in the file.
  test('is written for a row whose key has no token', () => {
    const untokened = { ...record(STORED), record: null }
    expect(exportRecord(columns, untokened, LABELS)).toEqual(exportRecord(columns, record(STORED), LABELS))
    expect(record(STORED).record).toBe(ORDER_TOKEN)
  })

  // A lookup whose key is too long for a token is left out of the answers
  // (toFormAnswers). Written empty, it would read as no reference at all:
  // the file refuses rather than say NULL where the row holds one.
  test('refuses a lookup whose key no token can carry, naming its header', () => {
    const { customer: _, ...answers } = record(STORED).answers
    expect(exportRecord(columns, { ...record(STORED), answers }, LABELS)).toMatchObject({ ok: false, code: 'unencodable', message: expect.stringContaining('Customer') })
  })

  // A lookup with no labels at all is a caller that forgot to resolve it:
  // every label would be empty, a file that looks whole. Thrown.
  test('throws when a lookup field’s labels were never resolved', () => {
    expect(() => exportRecord(columns, record(STORED), new Map([['customer', new Map()]]))).toThrow('employee')
  })

  // A readable field the form does not place, or a record without an answer
  // for one, is a caller's mistake: a file without that column, or with an
  // empty cell where the row holds a value, would look whole.
  test('throws on a readable field the form does not place, or a record that does not answer it', () => {
    expect(() => exportColumns(ORDER.form, ORDER.bindings, ['id', 'nothing'])).toThrow('not a bound field')
    const { status: _, ...answers } = record(STORED).answers
    expect(() => exportRecord(columns, { ...record(STORED), answers }, LABELS)).toThrow('status')
  })
})

/** Every kind parity.display_kinds holds (DISPLAY_PARITY), with a value as a record read returns it. */
const KINDS: ReadonlyArray<[string, LookupDisplayType, ApiValue]> = [
  ['t', { kind: 'text', maxLength: 50, lengthUnit: 'utf16-code-units', fixedLength: false }, 'Text'],
  ['fixed', { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }, 'AB'],
  ['i', { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }, '9007199254740993'],
  ['d', { kind: 'decimal', precision: 10, scale: 2 }, '12.50'],
  ['b', { kind: 'boolean' }, true],
  ['f', { kind: 'float', bits: 64 }, 0.30000000000000004],
  ['r', { kind: 'float', bits: 32 }, 1234567.875],
  ['dt', { kind: 'date' }, '2026-10-08'],
  ['tm', { kind: 'time', precision: 3 }, '10:34'],
  ['ts', { kind: 'timestamp', withTimeZone: true, precision: 3 }, '2026-10-08T08:34:56Z'],
  ['tz', { kind: 'timestamp', withTimeZone: false, precision: 3 }, '2026-10-08T10:34:56.789'],
  ['u', { kind: 'uuid' }, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
]

describe('exportText', () => {
  // The file holds what a read holds, digit for digit (0008): an integer
  // past 2^53, the largest numeric(18,4), a double's 17 digits, a real's
  // shortest spelling, and a zoneless timestamp's half second, which a
  // label's cut would drop. Watched failing through displayText -- the half
  // second cut -- and through Number() -- 9007199254740992.
  test('writes each value exactly as read', () => {
    const integer: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
    expect(exportText(integer, '9007199254740993')).toBe('9007199254740993')
    expect(exportText({ kind: 'decimal', precision: 18, scale: 4 }, '99999999999999.9999')).toBe('99999999999999.9999')
    expect(exportText({ kind: 'float', bits: 64 }, 0.30000000000000004)).toBe('0.30000000000000004')
    expect(exportText({ kind: 'float', bits: 32 }, 0.1)).toBe('0.1')
    expect(exportText({ kind: 'timestamp', withTimeZone: false, precision: 3 }, '2026-10-08T12:34:56.5')).toBe('2026-10-08T12:34:56.5')
    expect(exportText({ kind: 'float', bits: 64 }, '-Infinity')).toBe('-Infinity')
    expect(exportText(integer, null)).toBeNull()
  })

  // A label and a cell spell a value one way, except where a label cuts: a
  // time and a timestamp, which the file holds as read. So the rules part
  // only where meant.
  test('equals displayText for every kind a label shows, but a time and a timestamp', () => {
    for (const [column, type, value] of KINDS) {
      if (type.kind === 'time' || type.kind === 'timestamp') expect(exportText(type, value), column).toBe(value)
      else expect(exportText(type, value), column).toBe(displayText(type, value))
    }
    expect(displayText(KINDS[10]?.[1] as LookupDisplayType, '2026-10-08T10:34:56.789')).toBe('2026-10-08T10:34:56')
  })

  // The generator excludes binary, rowversion and unsupported, so a value of
  // one is a bundle the generator did not write: thrown, as displayText
  // throws, never written as some text.
  test('throws on a kind with no canonical text, and on a value of another kind’s type', () => {
    for (const type of [{ kind: 'binary', maxLength: null, fixedLength: false }, { kind: 'rowversion' }, { kind: 'unsupported' }] as const) {
      expect(() => exportText(type, 'AQ=='), type.kind).toThrow(/no text/)
    }
    expect(() => exportText({ kind: 'time', precision: 0 }, 930)).toThrow('another column')
  })
})

describe('exportFileName', () => {
  // The server's content-disposition and the browser's saved file name the
  // same file. A date would be the server's clock in one place and the
  // browser's in the other.
  test('is the form id and .csv', () => {
    expect(exportFileName('sales-order')).toBe('sales-order.csv')
  })
})
