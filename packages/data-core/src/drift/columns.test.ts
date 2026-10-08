import { describe, expect, test } from 'vitest'
import type { GenerationRequest } from '../generate/types.js'
import type { ObjectMeta } from '../metadata.js'
import {
  addColumn,
  col,
  column,
  decimal,
  drift,
  dropColumn,
  gap,
  INT16,
  INT32,
  INT64,
  kinds,
  only,
  ORDER,
  ORDER_REF,
  retype,
  snapshot,
  SUMMARY,
  text,
} from './fixture.js'

describe('diffSnapshots: columns', () => {
  // Plan section 14: a new nullable or defaulted column is an optional
  // inclusion, and the published form is preserved. Blocking on it would stop
  // every form on a table each time somebody added a column.
  test('a new nullable, defaulted or generated column is an optional inclusion and stops nothing', () => {
    const report = drift((objects) => {
      addColumn(objects, 'order', col('discount', 'decimal(5,2)', decimal(5, 2), { nullable: true }))
      addColumn(objects, 'order', col('priority', 'int', INT32, { hasDefault: true, defaultExpression: '((0))' }))
      addColumn(objects, 'order', col('total', 'decimal(19,4)', decimal(19, 4), { generated: 'computed' }))
    })
    expect(report.changes.map((change) => [change.kind, change.severity, change.subject, change.affects])).toEqual(
      ['discount', 'priority', 'total'].map((name) => ['column-added', 'review', { kind: 'column', object: ORDER_REF, name }, []]),
    )
    expect(report.changes[0]?.message).toMatch(/^discount is new \(decimal\(5,2\), nullable\)\. It can be added to the form/)
    expect(report).toMatchObject({ blocking: false, writable: { create: true, update: true } })
  })

  // Every INSERT from the published form leaves the new column out, and the
  // database refuses each one. That is create's problem, not update's: an
  // UPDATE that does not name the column leaves it alone.
  test('a new NOT NULL column with no default and no generator makes create impossible, and only create', () => {
    const region = col('region', 'nvarchar(10)', text(10))
    const report = drift((objects) => addColumn(objects, 'order', region))
    expect(only(report)).toMatchObject({ kind: 'column-added', severity: 'blocking', affects: [], message: expect.stringMatching(/no field of this form can/) })
    expect(report.writable).toEqual({ create: false, update: true })

    // A form that never offered create loses nothing by it.
    expect(only(drift((objects) => addColumn(objects, 'customer_summary', region), {}, SUMMARY)).severity).toBe('review')
  })

  // A statement that names a column that is gone fails, every time. A dropped
  // column the form never bound is somebody else's change.
  test('a dropped bound column blocks the writes that use it; a dropped unbound one is only noted', () => {
    const notes = drift((objects) => dropColumn(objects, 'order', 'notes'))
    expect(only(notes)).toMatchObject({ kind: 'column-dropped', severity: 'blocking', subject: { kind: 'column', object: ORDER_REF, name: 'notes' }, affects: ['notes'] })
    expect(notes.writable).toEqual({ create: false, update: false })

    const attachment = drift((objects) => dropColumn(objects, 'order', 'attachment'))
    expect(only(attachment)).toMatchObject({ kind: 'column-dropped', severity: 'info', affects: [] })
    expect(attachment).toMatchObject({ blocking: false, writable: { create: true, update: true } })

    // A view's form writes nothing, and still cannot show a column that is gone.
    expect(only(drift((objects) => dropColumn(objects, 'customer_summary', 'order_count'), {}, SUMMARY)).severity).toBe('blocking')
  })

  // The form reads and writes a column with the codec it was published with.
  // A different type means the codec is wrong for it. nvarchar to varchar
  // keeps every normalised property and loses every character outside the
  // code page, so the database's spelling counts too.
  test('a bound column whose type changed blocks the form, including a change only the spelling shows', () => {
    const float = drift((objects) => retype(objects, 'order', 'amount', 'float', { kind: 'float', bits: 64 }))
    expect(only(float)).toMatchObject({ kind: 'column-type-changed', severity: 'blocking', affects: ['amount'], message: expect.stringMatching(/from decimal\(18,4\) to float/) })
    expect(float.writable).toEqual({ create: false, update: false })

    const spelling = drift((objects) => (column(objects, 'order', 'notes').databaseType = 'varchar(max)'))
    expect(only(spelling)).toMatchObject({ kind: 'column-type-changed', severity: 'blocking', affects: ['notes'] })

    // A view's form writes nothing, and still reads the column with the published codec.
    expect(only(drift((objects) => retype(objects, 'customer_summary', 'order_count', 'decimal(20,0)', decimal(20, 0)), {}, SUMMARY)).severity).toBe('blocking')
    // A column no field binds changes nothing the form does.
    const unbound = drift((objects) => retype(objects, 'order', 'attachment', 'nvarchar(max)', text(null)))
    expect(only(unbound)).toMatchObject({ kind: 'column-type-changed', severity: 'info' })
    expect(unbound.writable).toEqual({ create: true, update: true })
  })

  // Plan section 14: tightened precision, scale, length or nullability is a
  // validation-impact change. The published form would accept a value the
  // database now refuses, and the person would find out at save time from a
  // database error. Loosened, every value the form accepts is still accepted.
  test('tightened on a bound column blocks writes of that field; loosened is informational', () => {
    const tightened: Array<[string, (objects: ObjectMeta[]) => void]> = [
      ['amount', (objects) => retype(objects, 'order', 'amount', 'decimal(16,4)', decimal(16, 4))],
      ['amount', (objects) => retype(objects, 'order', 'amount', 'decimal(18,2)', decimal(18, 2))],
      ['amount', (objects) => retype(objects, 'order', 'amount', 'decimal(18,6)', decimal(18, 6))],
      ['status', (objects) => retype(objects, 'order', 'status', 'nvarchar(10)', text(10))],
      ['created_by', (objects) => retype(objects, 'order', 'created_by', 'smallint', INT16)],
      ['notes', (objects) => (column(objects, 'order', 'notes').nullable = false)],
      ['status', (objects) => Object.assign(column(objects, 'order', 'status'), { hasDefault: false, defaultExpression: null })],
    ]
    for (const [field, edit] of tightened) {
      const report = drift(edit)
      expect(only(report)).toMatchObject({ kind: 'column-tightened', severity: 'blocking', affects: [field], message: expect.stringMatching(/database now refuses/) })
      expect(report.writable).toEqual({ create: false, update: false })
    }

    const loosened: Array<(objects: ObjectMeta[]) => void> = [
      (objects) => retype(objects, 'order', 'amount', 'decimal(20,4)', decimal(20, 4)),
      (objects) => retype(objects, 'order', 'status', 'nvarchar(40)', text(40)),
      (objects) => (column(objects, 'order', 'order_date').nullable = true),
      (objects) => Object.assign(column(objects, 'order', 'notes'), { hasDefault: true, defaultExpression: "('')" }),
    ]
    for (const edit of loosened) {
      const report = drift(edit)
      expect(only(report)).toMatchObject({ kind: 'column-loosened', severity: 'info' })
      expect(report).toMatchObject({ blocking: false, writable: { create: true, update: true } })
    }

    // A different default refuses nothing; it changes what an omitted value becomes.
    expect(only(drift((objects) => (column(objects, 'order', 'status').defaultExpression = "('draft')")))).toMatchObject({ kind: 'column-default-changed', severity: 'info' })
  })

  // Narrowing a column cannot break a field that never writes it: every value
  // it shows was valid before and still is.
  test('a tightened column the form only shows stops nothing', () => {
    const report = drift((objects) => retype(objects, 'order', 'id', 'int', INT32))
    expect(only(report)).toMatchObject({ kind: 'column-tightened', severity: 'info', affects: ['id'] })
    expect(report.writable).toEqual({ create: true, update: true })
    // Nor one no field binds at all.
    expect(only(drift((objects) => retype(objects, 'order', 'attachment', 'varbinary(100)', { kind: 'binary', maxLength: 100 })))).toMatchObject({ kind: 'column-tightened', severity: 'info', affects: [] })
  })

  // Wider is harmless only while the published field can hold every value.
  // A number field rounds past 2^53 in the browser, and a save writes the
  // rounded number back (0009); a checkbox has no "unknown", so a NULL read
  // into it is saved as false. Both are silent data changes.
  test('a widened column the published field cannot hold blocks writes of it', () => {
    const wide = drift((objects) => retype(objects, 'order', 'created_by', 'bigint', INT64))
    expect(only(wide)).toMatchObject({ kind: 'column-outgrew-field', severity: 'blocking', affects: ['created_by'], message: expect.stringMatching(/published number field/) })
    expect(wide.writable).toEqual({ create: false, update: false })
    expect(only(drift((objects) => (column(objects, 'order', 'paid').nullable = true)))).toMatchObject({ kind: 'column-outgrew-field', severity: 'blocking', affects: ['paid'] })

    // Longer text becomes a textarea on regeneration, and both hold any string.
    expect(only(drift((objects) => retype(objects, 'order', 'status', 'nvarchar(400)', text(400))))).toMatchObject({ kind: 'column-loosened', severity: 'info' })
    // A lookup's select holds an encoded key, never the column's value as a number.
    expect(only(drift((objects) => retype(objects, 'order', 'customer_no', 'bigint', INT64)))).toMatchObject({ kind: 'column-loosened', severity: 'info' })
    // A field that only shows the value shows it rounded and never writes it back: for review.
    expect(only(drift((objects) => retype(objects, 'customer_summary', 'tenant_id', 'bigint', INT64), {}, SUMMARY))).toMatchObject({ kind: 'column-outgrew-field', severity: 'review' })
  })

  // SQL Server refuses an INSERT naming an identity column, and both engines
  // refuse a value for a computed one. A column the database stops generating
  // needs a value from somewhere, and a read-only field gives none.
  test('a column the database starts generating blocks writes to it; one it stops generating can make create impossible', () => {
    const computed = drift((objects) => (column(objects, 'order', 'status').generated = 'computed'))
    expect(only(computed)).toMatchObject({ kind: 'column-generation-changed', severity: 'blocking', affects: ['status'] })
    expect(computed.writable).toEqual({ create: false, update: false })

    const plain = drift((objects) => (column(objects, 'order', 'id').generated = 'none'))
    expect(only(plain)).toMatchObject({ kind: 'column-generation-changed', severity: 'blocking', affects: ['id'], message: expect.stringMatching(/no field of this form can/) })
    expect(plain.writable).toEqual({ create: false, update: true })

    expect(only(drift((objects) => (column(objects, 'order', 'attachment').generated = 'computed')))).toMatchObject({ severity: 'info' })
  })

  // The concurrency token is how a stale update is detected (0009). Gone or
  // different, an update could silently overwrite somebody else's change. A
  // create never used it.
  test('the concurrency column gone or changed blocks update', () => {
    const gone = drift((objects) => dropColumn(objects, 'order', 'row_version'))
    expect(only(gone)).toMatchObject({ kind: 'concurrency-changed', severity: 'blocking', subject: { kind: 'column', object: ORDER_REF, name: 'row_version' }, affects: [] })
    expect(gone.writable).toEqual({ create: true, update: false })

    // A confirmed PostgreSQL version column that may now be null: a null
    // version matches nothing and proves nothing.
    const postgres = snapshot(undefined, { kind: 'postgres' })
    const confirmed: GenerationRequest = { ...ORDER, versionColumn: 'row_version' }
    const nullable = (objects: ObjectMeta[]) => (column(objects, 'order', 'row_version').nullable = true)
    const changed = drift(nullable, { kind: 'postgres' }, confirmed, postgres)
    expect(only(changed)).toMatchObject({ kind: 'concurrency-changed', severity: 'blocking' })
    expect(changed.writable).toEqual({ create: true, update: false })

    // An inferred version column was never used, so the form loses nothing.
    expect(only(drift(nullable, { kind: 'postgres' }, ORDER, postgres))).toMatchObject({ kind: 'concurrency-changed', severity: 'info' })

    // One that lost its default must be given a value by every create, and no field gives one.
    const noDefault = (objects: ObjectMeta[]) => Object.assign(column(objects, 'order', 'row_version'), { hasDefault: false, defaultExpression: null })
    expect(drift(noDefault, { kind: 'postgres' }, confirmed, postgres).writable).toEqual({ create: false, update: false })
  })

  // Plan section 14: an apparent rename requests confirmation, and is never
  // inferred from names. Taken as a rename, a column that was really dropped
  // and a different one added would carry the old field onto the wrong data.
  test('an apparent rename is two changes and a hint, never a rename', () => {
    const renamed = (objects: ObjectMeta[]) => {
      dropColumn(objects, 'order', 'order_date')
      addColumn(objects, 'order', col('placed_on', 'date', { kind: 'date' }))
    }
    const report = drift(renamed)
    expect(report.changes.map((change) => [change.kind, change.severity, change.subject])).toEqual([
      ['column-dropped', 'blocking', { kind: 'column', object: ORDER_REF, name: 'order_date' }],
      ['column-added', 'blocking', { kind: 'column', object: ORDER_REF, name: 'placed_on' }],
      ['possible-rename', 'review', { kind: 'column', object: ORDER_REF, name: 'order_date' }],
    ])
    expect(report.changes[2]).toMatchObject({ affects: ['order_date'], message: expect.stringMatching(/^order_date is gone and placed_on is new with the same definition \(date\)\. .*confirm/) })
    expect(report.writable).toEqual({ create: false, update: false })

    // Every candidate is named, and a column of another definition is none.
    const two = drift((objects) => {
      renamed(objects)
      addColumn(objects, 'order', col('shipped_on', 'date', { kind: 'date' }))
      addColumn(objects, 'order', col('ordered_at', 'datetimeoffset(7)', { kind: 'timestamp', withTimeZone: true, precision: 7 }))
    })
    expect(two.changes.find((change) => change.kind === 'possible-rename')?.message).toMatch(/placed_on, shipped_on are new/)
    const nullable = drift((objects) => {
      dropColumn(objects, 'order', 'order_date')
      addColumn(objects, 'order', col('placed_on', 'date', { kind: 'date' }, { nullable: true }))
    })
    expect(kinds(nullable)).not.toContain('possible-rename')

    // A hint about a column no field binds is only a note.
    const unbound = drift((objects) => {
      dropColumn(objects, 'order', 'attachment')
      addColumn(objects, 'order', col('scan', 'varbinary(max)', { kind: 'binary', maxLength: null }, { nullable: true }))
    })
    expect(unbound.changes.find((change) => change.kind === 'possible-rename')?.severity).toBe('info')
  })

  // A column-level DENY looks, in a permission-filtered catalog, exactly like
  // a dropped column. The gap is what tells them apart (0004).
  test('a bound column that vanished behind a gap is an access problem, not a dropped column', () => {
    const report = drift((objects) => dropColumn(objects, 'order', 'notes'), { gaps: [gap(ORDER_REF, 'columns', 'SELECT on notes is denied.')] })
    expect(only(report)).toMatchObject({
      kind: 'access-narrowed',
      severity: 'blocking',
      subject: { kind: 'column', object: ORDER_REF, name: 'notes' },
      affects: ['notes'],
      message: expect.stringMatching(/SELECT on notes is denied/),
    })
    expect(report.writable).toEqual({ create: false, update: false })

    // An unbound column out of sight is the gap's to report, once; and it is
    // no rename candidate, because nobody knows it is gone.
    const unbound = drift(
      (objects) => {
        dropColumn(objects, 'order', 'attachment')
        addColumn(objects, 'order', col('scan', 'varbinary(max)', { kind: 'binary', maxLength: null }, { nullable: true }))
      },
      { gaps: [gap(ORDER_REF, 'columns')] },
    )
    expect(unbound.changes.map((change) => [change.kind, change.subject.kind])).toEqual([
      ['access-narrowed', 'object'],
      ['column-added', 'column'],
    ])
  })
})
