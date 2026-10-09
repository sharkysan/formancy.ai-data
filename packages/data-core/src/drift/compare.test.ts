import { describe, expect, test } from 'vitest'
import type { ColumnMeta, NormalizedType, TextLengthUnit } from '../metadata.js'
import { classify, compareTypes, type TypeVerdict } from './compare.js'

const INT16: NormalizedType = { kind: 'integer', min: '-32768', max: '32767' }
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const text = (maxLength: number | null, fixedLength = false, lengthUnit: TextLengthUnit = 'utf16-code-units'): NormalizedType => ({ kind: 'text', maxLength, lengthUnit, fixedLength })
const decimal = (precision: number | null, scale: number | null): NormalizedType => ({ kind: 'decimal', precision, scale })

function col(name: string, databaseType: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, ordinal: 1, databaseType, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra }
}

describe('compareTypes', () => {
  // Tightened means some value the column held before is refused now;
  // loosened means every one is still accepted and more are. Getting the
  // direction wrong turns a validation impact into a note, and the first
  // anyone hears of it is a database error at save time.
  test('a bound is compared by what it can hold, and a move both ways is a tightening', () => {
    const cases: Array<[string, NormalizedType, NormalizedType, TypeVerdict]> = [
      ['shorter text', text(20), text(10), 'tightened'],
      ['longer text', text(20), text(40), 'loosened'],
      ['unbounded text given a limit', text(null), text(4000), 'tightened'],
      ['text limit removed', text(4000), text(null), 'loosened'],
      ['narrower integer', INT32, INT16, 'tightened'],
      ['wider integer', INT32, INT64, 'loosened'],
      // Wider below, narrower above: some value is refused, so it is tightened.
      ['shifted integer', { kind: 'integer', min: '0', max: '65535' }, INT16, 'tightened'],
      // 64-bit bounds differing in the last digit are not equal: the
      // comparison is exact, never through a JavaScript number.
      ['integer one below 2^63', INT64, { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775806' }, 'tightened'],
      ['fewer digits', decimal(18, 4), decimal(16, 4), 'tightened'],
      ['fewer fraction digits', decimal(18, 4), decimal(18, 2), 'tightened'],
      // Two more fraction digits cost two whole ones: 10^13 no longer fits.
      ['scale up, precision held', decimal(18, 4), decimal(18, 6), 'tightened'],
      ['more of both', decimal(18, 4), decimal(20, 6), 'loosened'],
      ['unconstrained numeric constrained', decimal(null, null), decimal(38, 10), 'tightened'],
      ['numeric constraint removed', decimal(38, 10), decimal(null, null), 'loosened'],
      // A null scale is zero, as the generator's decimal pattern reads it.
      ['null scale is zero', decimal(10, null), decimal(10, 0), 'same'],
      ['double to single', { kind: 'float', bits: 64 }, { kind: 'float', bits: 32 }, 'tightened'],
      ['single to double', { kind: 'float', bits: 32 }, { kind: 'float', bits: 64 }, 'loosened'],
      ['time precision down', { kind: 'time', precision: 6 }, { kind: 'time', precision: 3 }, 'tightened'],
      ['timestamp precision up', { kind: 'timestamp', withTimeZone: true, precision: 6 }, { kind: 'timestamp', withTimeZone: true, precision: 7 }, 'loosened'],
      ['shorter binary', { kind: 'binary', maxLength: 16, fixedLength: false }, { kind: 'binary', maxLength: 8, fixedLength: false }, 'tightened'],
      ['same date', { kind: 'date' }, { kind: 'date' }, 'same'],
      ['same text', text(20), text(20), 'same'],
    ]
    for (const [name, before, after, verdict] of cases) expect([name, compareTypes(before, after)]).toEqual([name, verdict])
  })

  // These are not "more" or "less" of anything. char pads with spaces and
  // varchar does not; an instant and a wall clock are different values; an
  // integer and a text are different types. Each is a changed type.
  test('a different kind, fixed length or time zone is a changed type', () => {
    expect(compareTypes(text(2, true), text(2, false))).toBe('changed')
    expect(compareTypes({ kind: 'timestamp', withTimeZone: true, precision: 6 }, { kind: 'timestamp', withTimeZone: false, precision: 6 })).toBe('changed')
    expect(compareTypes(INT32, text(10))).toBe('changed')
    expect(compareTypes({ kind: 'boolean' }, INT16)).toBe('changed')
  })

  // A collation move of varchar(20) from 1252 to UTF-8 keeps every spelling
  // the database shows and changes what 20 counts. Before the unit was in the
  // snapshot the move was invisible, fingerprint included, and the published
  // codec went on counting characters where the column now counts bytes.
  // Only a move across the UTF-8 boundary is seen: 1252 to 932 is
  // code-page-bytes on both sides, and is left to the save's checks.
  test('a text counted in another unit is a different type, though the database spells it alike', () => {
    expect(compareTypes(text(20, false, 'code-page-bytes'), text(20, false, 'utf8-bytes'))).toBe('changed')
    expect(compareTypes(text(20, false, 'code-page-bytes'), text(40, false, 'utf8-bytes'))).toBe('changed')
    expect(compareTypes(text(20, false, 'utf8-bytes'), text(20, false, 'utf8-bytes'))).toBe('same')
    const reference = col('reference', 'varchar(20)', text(20, false, 'code-page-bytes'))
    expect(classify(reference, { ...reference, type: text(20, false, 'utf8-bytes') })).toEqual({
      kind: 'column-type-changed',
      reasons: ['its length now counts utf8-bytes where it counted code-page-bytes, though the database still spells it varchar(20)'],
    })
  })

  // binary(n) pads a shorter value with zeros and varbinary(n) does not: what
  // is read back is a different value, not more or less of the same one.
  test('a binary that starts padding is a different type', () => {
    expect(compareTypes({ kind: 'binary', maxLength: 32, fixedLength: false }, { kind: 'binary', maxLength: 32, fixedLength: true })).toBe('changed')
    expect(compareTypes({ kind: 'binary', maxLength: 32, fixedLength: true }, { kind: 'binary', maxLength: 16, fixedLength: true })).toBe('tightened')
  })
})

describe('classify', () => {
  // One row per column in the review, however many things changed about it:
  // named by the most serious difference, listing every one.
  test('the most serious difference names the change, and every difference is listed', () => {
    const amount = col('amount', 'decimal(18,4)', decimal(18, 4))
    expect(classify(amount, amount)).toBeNull()
    // Comments and catalog positions are nothing a form binds.
    expect(classify(amount, { ...amount, comment: 'Net amount.', ordinal: 9 })).toBeNull()

    expect(classify(amount, { ...amount, databaseType: 'decimal(16,4)', type: decimal(16, 4), nullable: true })).toEqual({
      kind: 'column-tightened',
      reasons: ['it narrowed from decimal(18,4) to decimal(16,4)', 'it now accepts null'],
    })
    expect(classify(amount, { ...amount, databaseType: 'decimal(20,4)', type: decimal(20, 4), nullable: true })?.kind).toBe('column-loosened')
    // Named by the most serious even when a lesser difference is listed first:
    // wider and no longer nullable still refuses a value the form accepts.
    expect(classify({ ...amount, nullable: true }, { ...amount, databaseType: 'decimal(20,4)', type: decimal(20, 4) })).toEqual({
      kind: 'column-tightened',
      reasons: ['it widened from decimal(18,4) to decimal(20,4)', 'it no longer accepts null'],
    })
    expect(classify(amount, { ...amount, databaseType: 'float', type: { kind: 'float', bits: 64 }, generated: 'computed' })).toEqual({
      kind: 'column-type-changed',
      reasons: ['its type changed from decimal(18,4) to float', 'the database now generates it (computed)'],
    })
    expect(classify(amount, { ...amount, nullable: true, generated: 'computed' })?.kind).toBe('column-generation-changed')
  })

  // nvarchar to varchar keeps every normalised property and loses every
  // character outside the code page. The spelling is all that shows it.
  test('the same normalised type spelled differently is a changed type', () => {
    const notes = col('notes', 'nvarchar(max)', text(null), { nullable: true })
    expect(classify(notes, { ...notes, databaseType: 'varchar(max)' })).toEqual({
      kind: 'column-type-changed',
      reasons: [expect.stringMatching(/spells its type varchar\(max\) where it said nvarchar\(max\)/)],
    })
  })

  // A default is how a create may leave a NOT NULL column out. Losing it is a
  // new obligation; for a column that may be null, or that the database
  // generates, it only changes what an omitted value becomes.
  test('a lost default tightens a NOT NULL column; any other default change is a note', () => {
    const status = col('status', 'nvarchar(20)', text(20), { hasDefault: true, defaultExpression: "('placed')" })
    const lost = { hasDefault: false, defaultExpression: null }
    expect(classify(status, { ...status, ...lost })).toEqual({ kind: 'column-tightened', reasons: ['it lost its default, so a create must give it a value'] })
    expect(classify({ ...status, nullable: true }, { ...status, nullable: true, ...lost })?.kind).toBe('column-default-changed')
    expect(classify({ ...status, generated: 'computed' }, { ...status, generated: 'computed', ...lost })?.kind).toBe('column-default-changed')
    expect(classify(status, { ...status, defaultExpression: "('new')" })).toEqual({ kind: 'column-default-changed', reasons: ['its default changed'] })
    expect(classify({ ...status, ...lost }, status)).toEqual({ kind: 'column-loosened', reasons: ['it gained a default'] })
  })

  // A generated column cannot be written, and one that stopped being
  // generated must be given a value. Either way the form's write changes.
  test('the database starting or stopping generating a column is a generation change', () => {
    const id = col('id', 'bigint', INT64, { generated: 'identity-always' })
    expect(classify(id, { ...id, generated: 'none' })).toEqual({ kind: 'column-generation-changed', reasons: ['the database no longer generates it (it was identity-always)'] })
  })

  // ALWAYS refuses a value and BY DEFAULT accepts one. Reported as no change,
  // a column that starts accepting values would go unreviewed; reported as
  // "now generates it", the reason would claim it was not generated before.
  test('identity-always to identity-by-default is a generation change, named both ways', () => {
    const id = col('id', 'integer', INT32, { generated: 'identity-always' })
    expect(classify(id, { ...id, generated: 'identity-by-default' })).toEqual({
      kind: 'column-generation-changed',
      reasons: ['the database generates it as identity-by-default where it was identity-always'],
    })
    expect(classify({ ...id, generated: 'identity-by-default' }, id)).toEqual({
      kind: 'column-generation-changed',
      reasons: ['the database generates it as identity-always where it was identity-by-default'],
    })
    expect(classify({ ...id, generated: 'none' }, { ...id, generated: 'identity-by-default' })?.reasons).toEqual(['the database now generates it (identity-by-default)'])
  })
})
