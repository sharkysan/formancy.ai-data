import { describe, expect, test } from 'vitest'
import type { DatabaseKind, MetadataSnapshot, NormalizedType, ObjectMeta } from '@formancy/data-core'
import { createSnapshot } from '@formancy/data-core'
import { restrictedDisagreements, snapshotDisagreements } from './conformance.js'
import { FIXTURE_MODEL } from './model.js'

/**
 * The snapshot a perfect adapter would produce, built from the model itself.
 * Every test below starts from it and breaks one thing, so each proves the
 * comparator notices exactly that thing.
 */
function perfect(kind: DatabaseKind): ObjectMeta[] {
  return FIXTURE_MODEL.map((entry) => ({
    ref: { ...entry.ref },
    kind: entry.kind,
    comment: entry.comment ?? null,
    columns: entry.columns.map((column, index) => {
      const facts = { ...column, ...(column.byKind?.[kind] ?? {}) }
      return {
        name: column.name,
        ordinal: index + 1,
        databaseType: 'fixture',
        type: (facts.type ?? { kind: 'unsupported' }) as unknown as NormalizedType,
        nullable: facts.nullable ?? true,
        hasDefault: facts.hasDefault ?? false,
        defaultExpression: null,
        generated: facts.generated ?? 'none',
        comment: null,
      }
    }),
    // Copied, never shared: the model is frozen, and these are edited below.
    primaryKey: entry.primaryKey === null ? null : { name: `pk_${entry.ref.name}`, columns: [...entry.primaryKey] },
    uniqueKeys: Object.entries(entry.uniqueKeys).map(([name, columns]) => ({ name, columns: [...columns] })),
    foreignKeys: entry.foreignKeys.map((foreignKey) => ({
      name: foreignKey.name,
      columns: [...foreignKey.columns],
      references: { table: { ...foreignKey.references.table }, columns: [...foreignKey.references.columns] },
      onUpdate: 'no-action' as const,
      onDelete: foreignKey.onDelete,
      enforced: true,
      validated: foreignKey.validated,
    })),
    checks: entry.checks.map((name) => ({ name, expression: null, validated: true })),
  }))
}

function snapshot(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}, gaps: MetadataSnapshot['gaps'] = []): MetadataSnapshot {
  const objects = perfect(kind)
  edit(objects)
  return createSnapshot({ kind, serverVersion: 'x', scope: { schemas: ['sales'] }, objects, gaps })
}

function object(objects: ObjectMeta[], name: string): ObjectMeta {
  const found = objects.find((entry) => entry.ref.name === name)
  if (found === undefined) throw new Error(`no ${name}`)
  return found
}

describe('snapshotDisagreements', () => {
  // The baseline. A comparator that complained about a perfect snapshot would
  // make every adapter suite red for a reason in the test, not the adapter.
  test('a perfect snapshot has no disagreements, on either engine', () => {
    expect(snapshotDisagreements(snapshot('postgres'))).toEqual([])
    expect(snapshotDisagreements(snapshot('sqlserver'))).toEqual([])
  })

  // The per-engine difference is real: a PostgreSQL snapshot claiming a
  // rowversion column would be an adapter inventing a type the engine lacks.
  test('holds each engine to its own edition of the one deliberate difference', () => {
    const swapped = snapshot('postgres', (objects) => {
      const column = object(objects, 'order').columns.find((entry) => entry.name === 'row_version')
      if (column !== undefined) column.type = { kind: 'rowversion' }
    })
    expect(snapshotDisagreements(swapped)).toEqual([expect.stringMatching(/sales\.order\.row_version type kind is "rowversion", expected "integer"/)])
  })

  // Every suite in a process shares the model. A test that edited it would make
  // later comparisons compare the model with itself and pass vacuously.
  test('the model cannot be edited by a test', () => {
    const order = FIXTURE_MODEL.find((entry) => entry.ref.name === 'order')
    expect(() => {
      ;(order?.foreignKeys[0]?.references.columns as string[]).push('x')
    }).toThrow(TypeError)
  })

  // SQL Server's catalog reports nvarchar lengths in bytes. An adapter that
  // forgot to halve it would say four hundred characters, and a form would
  // accept names the database then refuses.
  test('notices a text length that is twice what it should be', () => {
    const doubled = snapshot('sqlserver', (objects) => {
      const column = object(objects, 'customer').columns.find((entry) => entry.name === 'name')
      if (column !== undefined) column.type = { kind: 'text', maxLength: 400, fixedLength: false }
    })
    expect(snapshotDisagreements(doubled)).toEqual([expect.stringMatching(/customer\.name type maxLength is 400, expected 200/)])
  })

  // A composite key's order is its pairing. Reversed, a lookup would join
  // tenant to customer number.
  test('notices a composite key in the wrong order, on either side of a foreign key', () => {
    const reversed = snapshot('postgres', (objects) => {
      const customer = object(objects, 'customer')
      if (customer.primaryKey !== null) customer.primaryKey.columns = ['customer_no', 'tenant_id']
      const foreignKey = object(objects, 'order').foreignKeys.find((entry) => entry.name === 'fk_order_customer')
      if (foreignKey?.references) foreignKey.references.columns = ['customer_no', 'tenant_id']
    })
    const found = snapshotDisagreements(reversed)
    expect(found).toContainEqual(expect.stringMatching(/customer primary key is \["customer_no","tenant_id"\]/))
    expect(found).toContainEqual(expect.stringMatching(/fk_order_customer pairs with \[customer_no, tenant_id\]/))
  })

  // A NOT VALID constraint reported as validated is a claim about existing rows
  // that is false — employee 3 has a manager that does not exist.
  test('notices an unvalidated foreign key reported as validated, and a dropped one', () => {
    const wrong = snapshot('postgres', (objects) => {
      const employee = object(objects, 'employee')
      const manager = employee.foreignKeys[0]
      if (manager !== undefined) manager.validated = true
      object(objects, 'order').foreignKeys = object(objects, 'order').foreignKeys.filter((entry) => entry.name !== 'fk_order_created_by')
    })
    const found = snapshotDisagreements(wrong)
    expect(found).toContainEqual(expect.stringMatching(/fk_employee_manager validated is true, expected false/))
    expect(found).toContainEqual(expect.stringMatching(/sales\.order foreign keys are \[fk_order_approved_by, fk_order_customer\]/))
  })

  // An object the model does not know, a missing one, a wrong kind, a lost
  // comment, a missing check: each a different adapter bug, each named.
  test('notices extra, missing and mis-kinded objects, comments and checks', () => {
    const wrong = snapshot('postgres', (objects) => {
      objects.splice(objects.indexOf(object(objects, 'employee')), 1)
      object(objects, 'customer_summary').kind = 'table'
      object(objects, 'customer').comment = null
      object(objects, 'order').checks = []
      objects.push({ ...object(objects, 'country'), ref: { schema: 'sales', name: 'stray' } })
    })
    const found = snapshotDisagreements(wrong)
    expect(found).toContainEqual('sales.employee is missing')
    expect(found).toContainEqual('sales.stray is reported and the model has no such object')
    expect(found).toContainEqual('sales.customer_summary is a table, expected a view')
    expect(found).toContainEqual(expect.stringMatching(/customer comment is null/))
    expect(found).toContainEqual(expect.stringMatching(/sales\.order checks are \[\]/))
  })

  // Discovered as the owner, nothing is hidden. A gap is an adapter that
  // failed to read what it could have.
  test('treats any gap as a disagreement when discovering as the owner', () => {
    const gapped = snapshot('postgres', () => {}, [{ object: { schema: 'sales', name: 'order' }, aspect: 'checks', detail: 'x' }])
    expect(snapshotDisagreements(gapped)).toEqual([expect.stringMatching(/unexpected gap on sales\.order \(checks\)/)])
  })
})

describe('restrictedDisagreements', () => {
  const withoutCustomerKey = (objects: ObjectMeta[]): void => {
    const order = object(objects, 'order')
    order.foreignKeys = order.foreignKeys.filter((entry) => entry.name !== 'fk_order_customer')
  }

  // The silent answer, which is the one that matters: a foreign key gone with
  // nothing saying so reads as "no relationship".
  test('a foreign key missing with no gap is a disagreement', () => {
    expect(restrictedDisagreements(snapshot('sqlserver', withoutCustomerKey))).toEqual([
      'fk_order_customer is missing and no gap says the reader cannot see it',
    ])
  })

  // "I cannot tell" is an acceptable answer, in either of its two shapes.
  test('a missing key or an unknown target is fine when a gap says so', () => {
    const gap = [{ object: { schema: 'sales', name: 'order' }, aspect: 'foreign-keys' as const, detail: 'target not visible' }]
    expect(restrictedDisagreements(snapshot('sqlserver', withoutCustomerKey, gap))).toEqual([])
    const unknownTarget = (objects: ObjectMeta[]): void => {
      const foreignKey = object(objects, 'order').foreignKeys.find((entry) => entry.name === 'fk_order_customer')
      if (foreignKey !== undefined) foreignKey.references = null
    }
    expect(restrictedDisagreements(snapshot('sqlserver', unknownTarget, gap))).toEqual([])
    expect(restrictedDisagreements(snapshot('sqlserver', unknownTarget))).toEqual(['fk_order_customer has an unknown target and no gap says why'])
  })

  // The reader may select sales.order. Not describing it is not caution, it is wrong.
  test('sales.order itself must be there, with all its columns', () => {
    const gone = snapshot('postgres', (objects) => {
      objects.splice(objects.indexOf(object(objects, 'order')), 1)
    })
    expect(restrictedDisagreements(gone)).toEqual(['sales.order is missing, though the reader may select from it'])
    const short = snapshot('postgres', (objects) => {
      object(objects, 'order').columns.pop()
    })
    expect(restrictedDisagreements(short)).toEqual([expect.stringMatching(/sales\.order columns are/)])
  })

  // A full, correct answer is of course also fine; a wrong target is not.
  test('a correct foreign key passes and a wrong target does not', () => {
    expect(restrictedDisagreements(snapshot('postgres'))).toEqual([])
    const wrongTarget = snapshot('postgres', (objects) => {
      const foreignKey = object(objects, 'order').foreignKeys.find((entry) => entry.name === 'fk_order_customer')
      if (foreignKey?.references) foreignKey.references.table = { schema: 'sales', name: 'employee' }
    })
    expect(restrictedDisagreements(wrongTarget)).toEqual(['fk_order_customer points at sales.employee, expected sales.customer'])
  })
})
