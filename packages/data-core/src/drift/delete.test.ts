import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { GenerationRequest } from '../generate/types.js'
import type { InboundKey, ObjectMeta } from '../metadata.js'
import { DELETING, drift, gap, INT32, INT64, NO_FILTERS, object, only, ORDER, ORDER_REF, retype, snapshot, text } from './fixture.js'

/*
 * What stops a delete in drift review (0050). A delete is a read's WHERE
 * and the version, so it is stopped by what stops reading, by a change to
 * the key or the token it names the record by, by the root becoming a view,
 * and by what the generator would no longer offer it over: the DELETE grant,
 * a key the database numbers on a version-column table, and what refers to
 * the root -- compared only between two snapshots that both record it (0049).
 *
 * Every snapshot here records 0049's facts (`facts: true`), so the order
 * form, on SQL Server with its rowversion and a key the database numbers,
 * offers delete. `DELETING` is a policy that lets somebody delete, under
 * which a change that stops delete is blocking; under `NO_FILTERS` nobody
 * may, and the same change is for review.
 */

const FACTS = { facts: true } as const

/** The snapshot the order form is published from: one that records what a delete rests on. */
function published(kind: 'sqlserver' | 'postgres' = 'sqlserver') {
  return snapshot(undefined, { kind, facts: true })
}

/** The order's key column, numbered by the database another way or not at all. */
function numbering(generated: 'none' | 'identity-by-default'): (objects: ObjectMeta[]) => void {
  return (objects) => {
    const id = object(objects, 'order').columns.find((candidate) => candidate.name === 'id') as ObjectMeta['columns'][number]
    id.generated = generated
  }
}

/** The default each engine fills a key with that never repeats, as its catalog spells it (0057). */
const NEVER_REPEATING = { postgres: 'gen_random_uuid()', sqlserver: '(newsequentialid())' } as const

/**
 * The order keyed by a uuid its default fills, the default spelled
 * `expression` -- `null` for none, or for one whose definition the account
 * may not read where `hasDefault` says it has one (0056, 0057). On SQL
 * Server its token is a version column the module maintains too, not the
 * rowversion, which proves a record whatever its key.
 */
function uuidKey(kind: 'postgres' | 'sqlserver', expression: string | null, hasDefault = expression !== null): (objects: ObjectMeta[]) => void {
  return (objects) => {
    const order = object(objects, 'order')
    const id = order.columns.find((candidate) => candidate.name === 'id') as ObjectMeta['columns'][number]
    Object.assign(id, { databaseType: kind === 'postgres' ? 'uuid' : 'uniqueidentifier', type: { kind: 'uuid' }, generated: 'none', hasDefault, defaultExpression: expression })
    const version = order.columns.find((candidate) => candidate.name === 'row_version') as ObjectMeta['columns'][number]
    if (kind === 'sqlserver') Object.assign(version, { databaseType: 'bigint', type: INT64, generated: 'none', hasDefault: true, defaultExpression: '((0))' })
  }
}

/** A foreign key of the order over `columns`, onto the employee's id, as one added since the form was published. */
function referring(name: string, columns: string[]): (objects: ObjectMeta[]) => void {
  return (objects) => {
    object(objects, 'order').foreignKeys.push({ name, columns, references: { table: { schema: 'sales', name: 'employee' }, columns: ['id'] }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true })
  }
}

/** A key from a table outside the snapshot that refers to the order, as discovery names one (0049). */
function referrer(onDelete: InboundKey['onDelete'], name = 'fk_order_copy_order'): InboundKey {
  return { table: { schema: 'audit', name: 'order_copy' }, name, columns: ['order_id'], referencedColumns: ['id'], onDelete, onUpdate: 'no-action', enforced: true }
}

function referredBy(objects: ObjectMeta[], key: InboundKey): void {
  const order = object(objects, 'order')
  order.referencedBy = [...(order.referencedBy ?? []), key]
}

describe('diffSnapshots: delete', () => {
  // The form offers delete only where its snapshot says it can be made, and
  // review keeps exactly what it offered while nothing changed.
  test('the order form offers delete from a snapshot that records the facts, and keeps it while nothing changed', () => {
    const base = published()
    expect(generateForm(base, ORDER).bindings.operations).toEqual({ create: true, update: true, delete: true })
    const report = drift(undefined, { ...FACTS, serverVersion: '16.0.4135' }, ORDER, base)
    expect(report.changes).toEqual([])
    expect(report.writable).toEqual({ create: true, update: true, delete: true })
  })

  // A delete finds its record by the key and proves it by the version, as
  // an update does: a key gone, a token retyped and a root that became a
  // view each stop it, and so does whatever stops reading -- a bound column
  // retyped (watched failing with delete stopped by none of them).
  test('what stops update by the key or the token, what makes the root a view, and what stops reading stop delete', () => {
    const cases: Array<[string, (objects: ObjectMeta[]) => void]> = [
      ['the identity key dropped', (objects) => void (object(objects, 'order').primaryKey = null)],
      ['the token retyped', (objects) => retype(objects, 'order', 'row_version', 'binary(8)', { kind: 'binary', maxLength: 8, fixedLength: true })],
      ['the identity column retyped', (objects) => retype(objects, 'order', 'id', 'nvarchar(20)', text(20))],
      ['the root a view', (objects) => void (object(objects, 'order').kind = 'view')],
      ['a bound column retyped', (objects) => retype(objects, 'order', 'amount', 'int', INT32)],
    ]
    for (const [name, edit] of cases) {
      const base = published()
      const report = drift(edit, { ...FACTS, policy: DELETING }, ORDER, base)
      expect({ name, delete: report.writable.delete, blocking: report.blocking }).toEqual({ name, delete: false, blocking: true })
      expect({ name, delete: report.runtime.writable.delete }).toEqual({ name, delete: false })
    }
  })

  // A column the form writes, narrowed, refuses values a save might send;
  // a delete sends none. Stopped, every delete would be refused for a
  // change that cannot touch it (watched failing with delete stopped by
  // every change that stops a write).
  test('a narrowed column the form writes stops create and update, and not delete', () => {
    const report = drift((objects) => retype(objects, 'order', 'notes', 'nvarchar(100)', text(100)), { ...FACTS, policy: DELETING }, ORDER, published())
    expect(only(report)).toMatchObject({ kind: 'column-tightened', severity: 'blocking' })
    expect(report.writable).toEqual({ create: false, update: false, delete: true })
  })

  // A form does not offer what its account cannot do (0027): DELETE
  // revoked stops delete, as a privilege change, and DELETE granted where
  // the form offered none is a note -- regenerating may offer it.
  test('DELETE revoked stops delete, and granted is a note', () => {
    const revoked = drift((objects) => void (object(objects, 'order').access = { delete: false }), { ...FACTS, policy: DELETING }, ORDER, published())
    expect(only(revoked)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', subject: { kind: 'object', object: ORDER_REF }, message: expect.stringMatching(/may no longer DELETE from sales\.order/) })
    expect(revoked.writable).toEqual({ create: true, update: true, delete: false })
    // The runtime decides over the root's description, which holds no grant; the database refuses the delete itself (0041).
    expect(revoked.runtime.writable.delete).toBe(true)

    const base = snapshot((objects) => void (object(objects, 'order').access = { delete: false }), FACTS)
    const granted = drift(undefined, FACTS, ORDER, base)
    expect(only(granted)).toMatchObject({ kind: 'privilege-widened', severity: 'info' })
    expect(granted.writable.delete).toBe(false)
  })

  // The generator's version rule, asked again (0050): on PostgreSQL the
  // order's version column proves a record only while the database numbers
  // its key. A key it no longer numbers is one a record can be created
  // again under, at the version a deleted one had, so delete stops; one
  // numbered another way still proves it (watched failing with the rule
  // not asked: delete kept).
  test('a key the database no longer numbers stops delete on a version-column form', () => {
    const request: GenerationRequest = { ...ORDER, versionColumn: 'row_version' }
    const base = published('postgres')
    expect(generateForm(base, request).bindings.operations.delete).toBe(true)
    const typed = drift(numbering('none'), { kind: 'postgres', ...FACTS, policy: DELETING }, request, base)
    expect(typed.writable.delete).toBe(false)
    expect(typed.changes.find((change) => change.kind === 'column-generation-changed')).toMatchObject({ severity: 'blocking', message: expect.stringMatching(/no longer numbers a column of the key/) })
    const byDefault = drift(numbering('identity-by-default'), { kind: 'postgres', ...FACTS, policy: DELETING }, request, base)
    expect(byDefault.writable.delete).toBe(true)
  })

  // The same rule over a key a default fills (0057), on each engine: the
  // order keyed by a uuid from the engine's never-repeating default offers
  // delete over its version column, and the key's default changed to
  // anything else -- a constant, another function -- dropped, or hidden
  // from the account leaves a key a record can be created again under, so
  // review and the runtime stop delete, blocking where somebody may delete.
  // The default spelled the same, or another column's default changed,
  // stops nothing (watched failing with the rule asked only when the key's
  // generation changes: review and the runtime kept delete for each, and
  // called the constant and the other function a note; and on SQL Server
  // with the rule asked of PostgreSQL's spelling: its key counted neither
  // before nor after, and every change kept delete).
  test('a key whose never-repeating default is changed, dropped or hidden stops delete on a version-column form, on either engine', () => {
    const request: GenerationRequest = { ...ORDER, versionColumn: 'row_version' }
    const changes: Record<'postgres' | 'sqlserver', Array<[string, string | null, boolean?]>> = {
      postgres: [
        ['a constant', "'2b7e1516-28ae-4d2a-a6f7-15880945cf4f'::uuid"],
        ['another function', 'uuid_generate_v4()'],
        ['dropped', null],
      ],
      sqlserver: [
        ['a constant', "('2b7e1516-28ae-4d2a-a6f7-15880945cf4f')"],
        ['another function', '(newid())'],
        ['dropped', null],
        ['hidden', null, true],
      ],
    }
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const base = snapshot(uuidKey(kind, NEVER_REPEATING[kind]), { kind, facts: true })
      expect({ kind, delete: generateForm(base, request).bindings.operations.delete }).toEqual({ kind, delete: true })
      const reports = changes[kind].map(([name, expression, hasDefault]) => {
        const report = drift(uuidKey(kind, expression, hasDefault), { kind, ...FACTS, policy: DELETING }, request, base)
        const key = report.changes.find((change) => change.subject.kind === 'column' && change.subject.name === 'id')
        return { kind, name, delete: report.writable.delete, runtime: report.runtime.writable.delete, severity: key?.severity, numbering: key?.message.includes('no longer numbers a column of the key') }
      })
      expect(reports).toEqual(changes[kind].map(([name]) => ({ kind, name, delete: false, runtime: false, severity: 'blocking', numbering: true })))
      const same = drift(uuidKey(kind, NEVER_REPEATING[kind]), { kind, ...FACTS, policy: DELETING }, request, base)
      expect({ kind, changes: same.changes }).toEqual({ kind, changes: [] })
      const status = drift(
        (objects) => {
          uuidKey(kind, NEVER_REPEATING[kind])(objects)
          const column = object(objects, 'order').columns.find((candidate) => candidate.name === 'status') as ObjectMeta['columns'][number]
          column.defaultExpression = "('open')"
        },
        { kind, ...FACTS, policy: DELETING },
        request,
        base,
      )
      expect({ kind, delete: status.writable.delete }).toEqual({ kind, delete: true })
    }
  })

  // A foreign key added over such a key is a lookup any form may offer, and
  // a lookup writes the key from the record a person chooses, so a record
  // deleted is created again under its key the next time that record is
  // chosen: review and the runtime stop delete, blocking where somebody may
  // delete, and say so on the foreign key. One over another column stops
  // nothing (watched failing with the foreign keys not asked: both engines
  // kept delete in review and at runtime, and called the key a note).
  test('a foreign key added over a key its never-repeating default fills stops delete, on either engine', () => {
    const request: GenerationRequest = { ...ORDER, versionColumn: 'row_version' }
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const keyed = uuidKey(kind, NEVER_REPEATING[kind])
      const base = snapshot(keyed, { kind, facts: true })
      const over = (columns: string[]) =>
        drift(
          (objects) => {
            keyed(objects)
            referring('fk_order_employee', columns)(objects)
          },
          { kind, ...FACTS, policy: DELETING },
          request,
          base,
        )
      const key = over(['id'])
      expect({ kind, delete: key.writable.delete, runtime: key.runtime.writable.delete, change: key.changes.find((change) => change.kind === 'foreign-key-changed') }).toEqual({
        kind,
        delete: false,
        runtime: false,
        change: expect.objectContaining({ severity: 'blocking', subject: { kind: 'foreign-key', object: ORDER_REF, name: 'fk_order_employee' }, message: expect.stringMatching(/a lookup over it writes the key/) }),
      })
      const other = over(['created_by'])
      expect({ kind, delete: other.writable.delete, runtime: other.runtime.writable.delete, severity: other.changes.find((change) => change.kind === 'foreign-key-changed')?.severity }).toEqual({ kind, delete: true, runtime: true, severity: 'info' })
    }
  })

  // What refers to the root is what a delete also does. A new key that
  // would cascade stops delete, by the predicate the publish check refuses
  // a grant by; one that only refuses a delete is the database's to enforce.
  test('a new key onto the root that acts on delete stops it, and one that only refuses is for review', () => {
    const cascading = drift((objects) => referredBy(objects, referrer('cascade')), { ...FACTS, policy: DELETING }, ORDER, published())
    expect(only(cascading)).toMatchObject({
      kind: 'referrer-added',
      severity: 'blocking',
      subject: { kind: 'foreign-key', object: { schema: 'audit', name: 'order_copy' }, name: 'fk_order_copy_order' },
      message: expect.stringMatching(/Deleting a record of sales\.order also deletes rows of audit\.order_copy \(fk_order_copy_order, ON DELETE CASCADE\), which this form does not offer/),
    })
    expect(cascading.writable.delete).toBe(false)
    // Review's alone: the request's description holds nothing that refers to the root, and the statement's guard refuses it there (0050).
    expect(cascading.runtime.writable.delete).toBe(true)

    const refusing = drift((objects) => referredBy(objects, referrer('no-action')), { ...FACTS, policy: DELETING }, ORDER, published())
    expect(only(refusing)).toMatchObject({ kind: 'referrer-added', severity: 'review', message: expect.stringMatching(/refuses to delete a record of sales\.order while rows of audit\.order_copy refer to it/) })
    expect(refusing.writable.delete).toBe(true)
  })

  // A SQL Server account that lost database VIEW DEFINITION can no longer
  // see every key that refers to the root (0049), so what a delete also
  // does cannot be told.
  test('a referenced-by gap that appeared stops delete', () => {
    const report = drift(undefined, { ...FACTS, policy: DELETING, gaps: [gap(null, 'referenced-by', 'No VIEW DEFINITION on the database.')] }, ORDER, published())
    expect(only(report)).toMatchObject({ kind: 'access-narrowed', severity: 'blocking', subject: { kind: 'scope' } })
    expect(report.writable).toEqual({ create: true, update: true, delete: false })
  })

  // The generator offers delete on every table it can be made against, and
  // most policies let nobody delete. A change that stops only delete is for
  // review there, never blocking: a form nobody deletes with loses nothing
  // by it (watched failing with severity decided by the bindings alone).
  test('a change that stops only delete blocks a form somebody may delete with, and is for review otherwise', () => {
    const cascade = (objects: ObjectMeta[]) => referredBy(objects, referrer('set-null'))
    expect(only(drift(cascade, { ...FACTS, policy: DELETING }, ORDER, published())).severity).toBe('blocking')
    const nobody = drift(cascade, { ...FACTS, policy: NO_FILTERS }, ORDER, published())
    expect(only(nobody)).toMatchObject({ severity: 'review', message: expect.stringMatching(/also sets order_id of audit\.order_copy to NULL in the rows that refer to it/) })
    expect(nobody).toMatchObject({ blocking: false, writable: { create: true, update: true, delete: false } })
  })

  // A base taken before 0049 never asked whether its account may delete,
  // or what refers to each table, and a form generated from it offers no
  // delete. Against it, a snapshot that records a new cascade, a revoked
  // DELETE and a referenced-by gap reports nothing: otherwise every form
  // published before 0049 would light up with every key and grant there is
  // (watched failing with the facts compared against such a base).
  test('against a base taken before 0049, the facts recorded since report nothing', () => {
    const before = snapshot()
    expect(generateForm(before, ORDER).bindings.operations.delete).toBe(false)
    const report = drift(
      (objects) => {
        referredBy(objects, referrer('cascade'))
        object(objects, 'order').access = { delete: false }
      },
      { ...FACTS, policy: DELETING, gaps: [gap(null, 'referenced-by', 'No VIEW DEFINITION on the database.')] },
      ORDER,
      before,
    )
    expect(report.changes).toEqual([])
  })
})
