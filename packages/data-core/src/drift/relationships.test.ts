import { describe, expect, test } from 'vitest'
import type { GenerationRequest } from '../generate/types.js'
import type { ForeignKeyMeta, NormalizedType, ObjectMeta, ObjectRef } from '../metadata.js'
import {
  addColumn,
  col,
  column,
  CUSTOMER_REF,
  drift,
  dropColumn,
  dropForeignKey,
  EMPLOYEE,
  EMPLOYEE_REF,
  foreignKey,
  gap,
  INT32,
  kinds,
  named,
  object,
  only,
  ORDER,
  ORDER_REF,
  remove,
  snapshot,
  table,
  text,
} from './fixture.js'

describe('diffSnapshots: lookups', () => {
  // Plan section 14: a changed foreign key behind a lookup requires
  // relationship review. The lookup offers the rows of one table by one key;
  // if either moved, a selection would store a key that means something else.
  test('a changed foreign key behind a lookup blocks the lookup until reviewed', () => {
    const swapped = drift((objects) => (foreignKey(objects, 'fk_order_customer').references = { table: CUSTOMER_REF, columns: ['customer_no', 'tenant_id'] }))
    expect(only(swapped)).toEqual({
      kind: 'lookup-changed',
      severity: 'blocking',
      subject: { kind: 'foreign-key', object: ORDER_REF, name: 'fk_order_customer' },
      affects: ['customer'],
      message: expect.stringMatching(/its target from crm\.customer \(tenant_id, customer_no\) to crm\.customer \(customer_no, tenant_id\)/),
    })
    expect(swapped.writable).toEqual({ create: false, update: false })

    // Every property counts, the actions and enforcement included: a lookup
    // over a key the database stopped enforcing can hold values that resolve
    // to nothing, and reviewing one is cheap.
    const edits: Array<(key: ForeignKeyMeta) => void> = [
      (key) => (key.columns = ['customer_no', 'tenant_id']),
      (key) => (key.onUpdate = 'cascade'),
      (key) => (key.onDelete = 'cascade'),
      (key) => (key.enforced = false),
      (key) => (key.validated = false),
    ]
    for (const edit of edits) expect(only(drift((objects) => edit(foreignKey(objects, 'fk_order_customer')))).kind).toBe('lookup-changed')

    const gone = drift((objects) => dropForeignKey(objects, 'fk_order_customer'))
    expect(only(gone)).toMatchObject({ kind: 'lookup-changed', severity: 'blocking', message: expect.stringMatching(/^fk_order_customer is gone/) })
  })

  // Both engines allow a dot in a schema or table name and a comma in a column
  // name, so two different foreign keys can read alike: a.b.c is schema a.b's
  // table c and schema a's table b.c, and (tenant_id, customer_no) is two
  // columns or one. Compared as sentences, a key retargeted from one to the
  // other was unchanged, and the lookup kept storing keys that now resolve in
  // a different table; the same for a key moved onto one oddly named column.
  test('a foreign key is compared by what it is, never by how it reads', () => {
    const schemas = ['a', 'a.b', 'crm', 'sales']
    const twins = (target: ObjectRef) => (objects: ObjectMeta[]) => {
      const customer = object(objects, 'customer')
      objects.push({ ...customer, ref: { schema: 'a.b', name: 'c' } }, { ...customer, ref: { schema: 'a', name: 'b.c' } })
      foreignKey(objects, 'fk_order_customer').references = { table: target, columns: ['tenant_id', 'customer_no'] }
    }
    const retargeted = drift(twins({ schema: 'a', name: 'b.c' }), { schemas }, ORDER, snapshot(twins({ schema: 'a.b', name: 'c' }), { schemas }))
    // The generator names the lookup's field after its target, here c.
    expect(only(retargeted)).toMatchObject({ kind: 'lookup-changed', severity: 'blocking', subject: { kind: 'foreign-key', object: ORDER_REF, name: 'fk_order_customer' }, affects: ['c'] })
    expect(retargeted.writable).toEqual({ create: false, update: false })

    // Both sides moved onto one column, and both still read (tenant_id, customer_no).
    const merged = drift((objects) => {
      const pair = col('tenant_id, customer_no', 'int', INT32, { nullable: true })
      addColumn(objects, 'order', pair)
      addColumn(objects, 'customer', pair)
      object(objects, 'customer').uniqueKeys.push({ name: 'uq_customer_pair', columns: [pair.name] })
      Object.assign(foreignKey(objects, 'fk_order_customer'), { columns: [pair.name], references: { table: CUSTOMER_REF, columns: [pair.name] } })
    })
    expect(merged.changes.map((change) => [change.kind, change.severity, named(change)])).toEqual([
      ['lookup-changed', 'blocking', 'fk_order_customer'],
      ['column-added', 'review', 'tenant_id, customer_no'],
    ])
    expect(merged.writable).toEqual({ create: false, update: false })
  })

  // The other half of the relationship: the key the foreign key points at,
  // the target itself, and the columns a person recognises a row by.
  test("a lookup's target key, table or display column gone blocks the lookup too", () => {
    const keyless = (objects: ObjectMeta[]) => (object(objects, 'customer').primaryKey = null)
    const report = drift(keyless)
    expect(only(report)).toMatchObject({ kind: 'lookup-changed', severity: 'blocking', subject: { kind: 'key', object: CUSTOMER_REF, name: 'pk_customer' }, affects: ['customer'] })
    expect(report.writable).toEqual({ create: false, update: false })

    const display = (objects: ObjectMeta[]) => dropColumn(objects, 'customer', 'name')
    expect(only(drift(display))).toMatchObject({ kind: 'lookup-changed', subject: { kind: 'column', object: CUSTOMER_REF, name: 'name' } })

    // A catalog cannot drop a referenced table and keep the foreign key, but a
    // snapshot can be wrong, and the lookup fails closed on it.
    const vanished = (objects: ObjectMeta[]) => remove(objects, 'customer')
    expect(only(drift(vanished))).toMatchObject({ kind: 'lookup-changed', subject: { kind: 'object', object: CUSTOMER_REF } })

    // Behind a gap, each of these is an access problem, said once; outside a
    // narrowed scope, a scope problem.
    expect(only(drift(vanished, { gaps: [gap(CUSTOMER_REF, 'objects')] }))).toMatchObject({ kind: 'access-narrowed', severity: 'blocking', affects: ['customer'] })
    expect(only(drift(keyless, { gaps: [gap(CUSTOMER_REF, 'keys')] }))).toMatchObject({ kind: 'access-narrowed', subject: { kind: 'key', object: CUSTOMER_REF, name: 'pk_customer' } })
    expect(only(drift(display, { gaps: [gap(CUSTOMER_REF, 'columns')] }))).toMatchObject({ kind: 'access-narrowed', subject: { kind: 'column', object: CUSTOMER_REF, name: 'name' } })
    expect(only(drift(vanished, { schemas: ['sales'] }))).toMatchObject({ kind: 'scope-narrowed', severity: 'blocking', subject: { kind: 'object', object: CUSTOMER_REF } })

    // A candidate key declared again over the same columns, in another order,
    // still identifies one row.
    const redeclared = drift((objects) => {
      const customer = object(objects, 'customer')
      customer.primaryKey = null
      customer.uniqueKeys = [{ name: 'uq_customer', columns: ['customer_no', 'tenant_id'] }]
    })
    expect(redeclared.changes).toEqual([])
    // And a key the base never saw cannot have been lost.
    const unseen = snapshot(keyless, { gaps: [gap(CUSTOMER_REF, 'keys', 'Hidden.')] })
    expect(drift(keyless, { gaps: [gap(CUSTOMER_REF, 'keys', 'Hidden, reworded.')] }, ORDER, unseen).changes).toEqual([])
  })

  // A foreign key whose target the connection can no longer see is reported
  // with no target (0004). The lookup cannot be checked, and that is access,
  // not a changed relationship.
  test('a lookup whose foreign key lost its visible target, or vanished behind a gap, is an access problem', () => {
    const hidden = (objects: ObjectMeta[]) => (foreignKey(objects, 'fk_order_customer').references = null)
    const report = drift(hidden, { gaps: [gap(ORDER_REF, 'foreign-keys', 'The target of fk_order_customer is not visible.')] })
    expect(only(report)).toMatchObject({
      kind: 'access-narrowed',
      severity: 'blocking',
      subject: { kind: 'foreign-key', object: ORDER_REF, name: 'fk_order_customer' },
      affects: ['customer'],
      message: expect.stringMatching(/"The target of fk_order_customer is not visible\."/),
    })
    expect(report.writable).toEqual({ create: false, update: false })
    // The snapshot says so by itself, even with no gap.
    expect(only(drift(hidden))).toMatchObject({ kind: 'access-narrowed', message: expect.stringMatching(/^What fk_order_customer references is not visible to this connection\. /) })

    const gone = drift((objects) => dropForeignKey(objects, 'fk_order_customer'), { gaps: [gap(ORDER_REF, 'foreign-keys')] })
    expect(only(gone)).toMatchObject({ kind: 'access-narrowed', subject: { kind: 'foreign-key', object: ORDER_REF, name: 'fk_order_customer' } })
  })
})

describe('diffSnapshots: the identity', () => {
  // Plan section 14: a changed candidate key behind the identity requires
  // review. Update finds "this record" by those columns; with no key over
  // them, one update could change two rows, or the wrong one.
  test('a changed key behind the identity blocks update, and only update', () => {
    const widened = drift((objects) => (object(objects, 'order').primaryKey = { name: 'pk_order', columns: ['id', 'tenant_id'] }))
    expect(only(widened)).toMatchObject({
      kind: 'identity-key-changed',
      severity: 'blocking',
      subject: { kind: 'key', object: ORDER_REF, name: 'pk_order' },
      affects: ['id'],
      message: expect.stringMatching(/^pk_order is over \(id, tenant_id\) where it was over \(id\)/),
    })
    expect(widened.writable).toEqual({ create: true, update: false })

    const keyless = (objects: ObjectMeta[]) => (object(objects, 'order').primaryKey = null)
    expect(only(drift(keyless))).toMatchObject({ kind: 'identity-key-changed', message: expect.stringMatching(/^pk_order is gone/) })

    // Behind a gap, the key is out of sight, not gone.
    const hidden = drift(keyless, { gaps: [gap(ORDER_REF, 'keys')] })
    expect(only(hidden)).toMatchObject({ kind: 'access-narrowed', subject: { kind: 'key', object: ORDER_REF, name: 'pk_order' } })
    expect(hidden.writable).toEqual({ create: true, update: false })

    // A form that never offered update loses nothing.
    expect(only(drift((objects) => (object(objects, 'employee').primaryKey = null), {}, EMPLOYEE)).severity).toBe('info')

    // A key renamed over the same columns still identifies a record: the
    // rename is noted, and the identity is intact.
    const renamed = drift((objects) => (object(objects, 'order').primaryKey = { name: 'order_pkey', columns: ['id'] }))
    expect(renamed.changes.map((change) => [change.kind, change.severity, named(change)])).toEqual([
      ['key-changed', 'info', 'order_pkey'],
      ['key-changed', 'info', 'pk_order'],
    ])
    expect(renamed.writable).toEqual({ create: true, update: true })

    // So does the primary key declared again as a unique key under its name:
    // the new role is noted, and update stays open.
    const demoted = drift((objects) => {
      const order = object(objects, 'order')
      order.primaryKey = null
      order.uniqueKeys.push({ name: 'pk_order', columns: ['id'] })
    })
    expect(only(demoted)).toMatchObject({ kind: 'key-changed', severity: 'info', message: expect.stringMatching(/^pk_order changed: its role from primary to unique\./) })
    expect(demoted.writable).toEqual({ create: true, update: true })
  })

  // A key column no field shows still addresses the record an update changes.
  // If its type changes, so does what the update matches on.
  test('a key column the form does not show still blocks update when its type changes', () => {
    const node = (databaseType: string, type: NormalizedType) => (objects: ObjectMeta[]) => {
      objects.push(
        table('node', [col('path', databaseType, type), col('label', 'nvarchar(50)', text(50)), col('row_version', 'rowversion', { kind: 'rowversion' }, { generated: 'rowversion' })], {
          primaryKey: { name: 'pk_node', columns: ['path'] },
        }),
      )
    }
    const request: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'node' }, formId: 'sales-node', title: 'Node', lookups: [] }
    const report = drift(node('nvarchar(4000)', text(4000)), {}, request, snapshot(node('hierarchyid', { kind: 'unsupported' })))
    expect(only(report)).toMatchObject({ kind: 'column-type-changed', severity: 'blocking', subject: { kind: 'column', name: 'path' }, affects: [] })
    expect(report.writable).toEqual({ create: false, update: false })
  })
})

describe('diffSnapshots: constraints the form does not rest on', () => {
  // These are the database's to enforce. A new one can refuse a save the
  // form allows, with the database's own error: worth knowing, and not worth
  // stopping the form for.
  test('keys, foreign keys and checks the form does not rest on are noted, never blocking', () => {
    const base = snapshot((objects) => object(objects, 'order').uniqueKeys.push({ name: 'uq_order_date', columns: ['order_date'] }))
    const report = drift(
      (objects) => {
        const order = object(objects, 'order')
        order.uniqueKeys = [
          { name: 'uq_order_date', columns: ['order_date', 'created_by'] },
          { name: 'uq_order_notes', columns: ['notes'] },
        ]
        Object.assign(foreignKey(objects, 'fk_order_created_by'), { onDelete: 'set-null', enforced: false })
        order.foreignKeys.push({
          name: 'fk_order_approver',
          columns: ['created_by'],
          references: { table: EMPLOYEE_REF, columns: ['id'] },
          onUpdate: 'no-action',
          onDelete: 'no-action',
          enforced: true,
          validated: true,
        })
        order.checks = [
          { name: 'ck_order_amount', expression: '([amount]>(0))', validated: false },
          { name: 'ck_order_status', expression: "([status]<>'')", validated: false },
        ]
      },
      {},
      ORDER,
      base,
    )
    expect(report.changes.map((change) => [change.kind, change.severity, named(change), change.affects])).toEqual([
      ['check-changed', 'info', 'ck_order_amount', []],
      ['check-changed', 'info', 'ck_order_status', []],
      ['foreign-key-changed', 'info', 'fk_order_approver', ['created_by']],
      ['foreign-key-changed', 'info', 'fk_order_created_by', ['created_by']],
      ['key-changed', 'info', 'uq_order_date', ['order_date', 'created_by']],
      ['key-changed', 'info', 'uq_order_notes', ['notes']],
    ])
    expect(report.changes[0]?.message).toMatch(/expression from \(\[amount\]>=\(0\)\) to \(\[amount\]>\(0\)\); validation from validated to not validated/)
    expect(report.changes[3]?.message).toMatch(/on delete from no-action to set-null; enforcement from enforced to not enforced/)
    expect(report).toMatchObject({ blocking: false, writable: { create: true, update: true } })

    // Gone, or pointing at a target that can no longer be seen, they are still only noted.
    const gone = drift((objects) => {
      dropForeignKey(objects, 'fk_order_created_by')
      object(objects, 'order').checks = []
    })
    expect(gone.changes.map((change) => [change.kind, change.severity, change.message])).toEqual([
      ['check-changed', 'info', expect.stringMatching(/^ck_order_amount is gone/)],
      ['foreign-key-changed', 'info', expect.stringMatching(/^fk_order_created_by is gone/)],
    ])
    const blind = drift((objects) => (foreignKey(objects, 'fk_order_created_by').references = null))
    expect(only(blind)).toMatchObject({ kind: 'foreign-key-changed', severity: 'info', message: expect.stringMatching(/its target from sales\.employee \(id\) to not visible/) })

    // Compared by its columns, not by how they read: a key moved from two
    // columns onto one whose name has a comma in it read like the old key, and
    // went unnoted.
    const lookalike = drift(
      (objects) => {
        addColumn(objects, 'order', col('order_date, created_by', 'int', INT32, { nullable: true }))
        object(objects, 'order').uniqueKeys = [{ name: 'uq_order_date', columns: ['order_date, created_by'] }]
      },
      {},
      ORDER,
      snapshot((objects) => object(objects, 'order').uniqueKeys.push({ name: 'uq_order_date', columns: ['order_date', 'created_by'] })),
    )
    expect(lookalike.changes.map((change) => [change.kind, change.severity, named(change)])).toEqual([
      ['column-added', 'review', 'order_date, created_by'],
      ['key-changed', 'info', 'uq_order_date'],
    ])
  })

  // Out of sight is not gone, for a constraint as for a table. The gap says
  // so once, and a "dropped" note beside it would contradict it.
  test('a constraint the form does not rest on, gone behind a gap, is left to the gap', () => {
    expect(only(drift((objects) => (object(objects, 'order').checks = []), { gaps: [gap(ORDER_REF, 'checks')] }))).toMatchObject({ kind: 'access-narrowed', severity: 'info' })
    expect(kinds(drift((objects) => dropForeignKey(objects, 'fk_order_created_by'), { gaps: [gap(ORDER_REF, 'foreign-keys')] }))).toEqual(['access-narrowed'])

    // An expression that can no longer be read is a changed check, and noted as one.
    const unreadable = drift((objects) => (object(objects, 'order').checks = [{ name: 'ck_order_amount', expression: null, validated: true }]), { gaps: [gap(ORDER_REF, 'checks')] })
    expect(unreadable.changes.map((change) => [change.kind, change.severity])).toEqual([
      ['access-narrowed', 'info'],
      ['check-changed', 'info'],
    ])
    expect(unreadable.changes[1]?.message).toMatch(/expression from \(\[amount\]>=\(0\)\) to not readable/)
  })

  // Only what this form touches is compared. A table it neither binds nor
  // looks up can change freely, and so can what it never reads.
  test('changes to tables this form does not touch, to comments and to positions are left out', () => {
    const report = drift((objects) => {
      object(objects, 'employee').columns.push(col('email', 'nvarchar(200)', text(200), { ordinal: 3 }))
      object(objects, 'order').comment = 'Orders as placed.'
      Object.assign(column(objects, 'order', 'amount'), { comment: 'Net of tax.', ordinal: 99 })
      object(objects, 'customer').columns.push(col('segment', 'nvarchar(20)', text(20), { ordinal: 5 }))
      remove(objects, 'customer_summary')
    })
    expect(report).toEqual({ changes: [], blocking: false, writable: { create: true, update: true } })
  })
})
