import { describe, expect, test } from 'vitest'
import type { ColumnMeta, DatabaseKind, MetadataSnapshot, NormalizedType, ObjectMeta, RowSecurity } from '@formancy/data-core'
import { createSnapshot } from '@formancy/data-core'
import { accessDisagreements, READER_ACCESS, WRITER_ACCESS } from './access.js'
import { restrictedDisagreements, snapshotDisagreements, structuralDisagreements } from './conformance.js'
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
        access: { select: true, insert: true, update: true },
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
    checks: entry.checks.map((check) => {
      const facts = { ...check, ...(check.byKind?.[kind] ?? {}) }
      return { name: check.name, expression: null, enforced: facts.enforced ?? true, validated: facts.validated ?? true }
    }),
    rowSecurity: typeof entry.rowSecurity === 'string' ? entry.rowSecurity : (entry.rowSecurity[kind] as RowSecurity),
  }))
}

function columnOf(objects: ObjectMeta[], table: string, name: string): ColumnMeta {
  const found = object(objects, table).columns.find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`no ${table}.${name}`)
  return found
}

function snapshot(kind: DatabaseKind, edit: (objects: ObjectMeta[]) => void = () => {}, gaps: MetadataSnapshot['gaps'] = []): MetadataSnapshot {
  const objects = perfect(kind)
  edit(objects)
  return createSnapshot({ kind, serverVersion: 'x', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['sales'] }, objects, gaps })
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
      if (column !== undefined) column.type = { kind: 'text', maxLength: 400, lengthUnit: 'utf16-code-units', fixedLength: false }
    })
    expect(snapshotDisagreements(doubled)).toEqual([expect.stringMatching(/customer\.name type maxLength is 400, expected 200/)])
  })

  // shipment.reference is varchar(20) under a UTF-8 collation on SQL Server.
  // An adapter that read every varchar as code-page bytes would hand the codec
  // a characters rule, and three é in varchar(4) would reach the server as 2628.
  test('notices a text column counted in the wrong unit', () => {
    const wrong = snapshot('sqlserver', (objects) => {
      columnOf(objects, 'shipment', 'reference').type = { kind: 'text', maxLength: 20, lengthUnit: 'code-page-bytes', fixedLength: false }
    })
    expect(snapshotDisagreements(wrong)).toEqual([expect.stringMatching(/sales\.shipment\.reference type lengthUnit is "code-page-bytes", expected "utf8-bytes"/)])
    // The same column is characters on PostgreSQL, and nothing else.
    const postgres = snapshot('postgres', (objects) => {
      columnOf(objects, 'shipment', 'reference').type = { kind: 'text', maxLength: 20, lengthUnit: 'utf8-bytes', fixedLength: false }
    })
    expect(snapshotDisagreements(postgres)).toEqual([expect.stringMatching(/sales\.shipment\.reference type lengthUnit is "utf8-bytes", expected "code-points"/)])
  })

  // ALWAYS refuses a value and BY DEFAULT accepts one. An adapter that read
  // attidentity as a yes or no would call them alike, and a form would treat
  // a column that takes values as one that refuses them, or the reverse.
  test('notices an always identity reported as by default, and the reverse', () => {
    const wrong = snapshot('postgres', (objects) => {
      columnOf(objects, 'country', 'id').generated = 'identity-by-default'
      columnOf(objects, 'shipment', 'id').generated = 'identity-always'
    })
    expect(snapshotDisagreements(wrong)).toEqual([
      'sales.country.id generated is identity-by-default, expected identity-always',
      'sales.shipment.id generated is identity-always, expected identity-by-default',
    ])
  })

  // SQL Server's sequence default numbers a row a create leaves out and takes
  // a value given by hand, as BY DEFAULT does, and collides later the same
  // way (measured: 2627). An adapter that reported it as an ordinary default
  // made the shared table's id writable on SQL Server and read-only on
  // PostgreSQL. Its default is real, so it keeps `hasDefault`.
  test("notices SQL Server's sequence default reported as an ordinary column", () => {
    const wrong = snapshot('sqlserver', (objects) => {
      columnOf(objects, 'shipment', 'id').generated = 'none'
    })
    expect(snapshotDisagreements(wrong)).toEqual(['sales.shipment.id generated is none, expected identity-by-default'])
    const lost = snapshot('sqlserver', (objects) => {
      columnOf(objects, 'shipment', 'id').hasDefault = false
    })
    expect(snapshotDisagreements(lost)).toEqual(['sales.shipment.id hasDefault is false, expected true'])
  })

  // A disabled SQL Server check is also untrusted, so an adapter that ignored
  // is_disabled would report it exactly like a WITH NOCHECK one — enforced —
  // and pass, while the database checked no new row against it.
  test('notices a check reported enforced where SQL Server disabled it', () => {
    const wrong = snapshot('sqlserver', (objects) => {
      const check = object(objects, 'shipment').checks.find((entry) => entry.name === 'ck_shipment_reference')
      if (check !== undefined) check.enforced = true
    })
    expect(snapshotDisagreements(wrong)).toEqual(['sales.shipment ck_shipment_reference enforced is true, expected false'])
    // PostgreSQL cannot disable one, so the same check is enforced and validated there.
    const postgres = snapshot('postgres', (objects) => {
      const carrier = object(objects, 'shipment').checks.find((entry) => entry.name === 'ck_shipment_carrier')
      if (carrier !== undefined) carrier.validated = true
    })
    expect(snapshotDisagreements(postgres)).toEqual(['sales.shipment ck_shipment_carrier validated is true, expected false'])
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

  // PostgreSQL files a stored generated column's expression in pg_attrdef,
  // where defaults live. An adapter that read it as a default would make the
  // generator treat a computed column as one the database fills on insert —
  // found by the PostgreSQL discovery spike, and pinned here for both engines.
  test('notices a computed or identity column reported as having a default', () => {
    const wrong = snapshot('postgres', (objects) => {
      const total = object(objects, 'order_line').columns.find((entry) => entry.name === 'line_total')
      if (total !== undefined) total.hasDefault = true
      const id = object(objects, 'order').columns.find((entry) => entry.name === 'id')
      if (id !== undefined) id.hasDefault = true
    })
    const found = snapshotDisagreements(wrong)
    expect(found).toContainEqual(expect.stringMatching(/order_line\.line_total hasDefault is true, expected false/))
    expect(found).toContainEqual(expect.stringMatching(/sales\.order\.id hasDefault is true, expected false/))
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
    const gapped = snapshot('postgres', () => {}, [{ subject: { kind: 'object', object: { schema: 'sales', name: 'order' } }, aspect: 'checks', detail: 'x' }])
    expect(snapshotDisagreements(gapped)).toEqual([expect.stringMatching(/unexpected gap on sales\.order \(checks\)/)])
    // A gap about a schema says which (0027): "the scope" would send a reader to the wrong place.
    const schema = snapshot('sqlserver', () => {}, [{ subject: { kind: 'schema', schema: 'sales' }, aspect: 'objects', detail: 'no VIEW DEFINITION' }])
    expect(snapshotDisagreements(schema)).toEqual(['unexpected gap on schema sales (objects): no VIEW DEFINITION'])
    expect(snapshotDisagreements(snapshot('sqlserver', () => {}, [{ subject: { kind: 'scope' }, aspect: 'row-security', detail: 'x' }]))).toEqual([
      'unexpected gap on the scope (row-security): x',
    ])
  })

  // The owner may do everything (0027). A capability reported false for it is
  // an adapter misreading a privilege check, and a form generated as the
  // owner would leave out what the owner may in fact write.
  test('an owner snapshot with one capability false is a disagreement', () => {
    const narrowed = snapshot('postgres', (objects) => {
      const amount = columnOf(objects, 'order', 'amount')
      amount.access = { ...amount.access, update: false }
    })
    expect(snapshotDisagreements(narrowed)).toEqual(['sales.order.amount access is select, insert and not update, expected every privilege'])
  })

  // SQL Server applies an enabled policy to every account, dbo included;
  // PostgreSQL exempts the superuser who owns the fixture. One table, two
  // genuine answers, each held to its own engine.
  test('customer reported with no row security on SQL Server, or with it on PostgreSQL, is a disagreement', () => {
    const silent = snapshot('sqlserver', (objects) => {
      object(objects, 'customer').rowSecurity = 'none'
    })
    expect(snapshotDisagreements(silent)).toEqual(['sales.customer row security is none, expected applies'])
    const policed = snapshot('postgres', (objects) => {
      object(objects, 'customer').rowSecurity = 'applies'
    })
    expect(snapshotDisagreements(policed)).toEqual(['sales.customer row security is applies, expected none'])
  })
})

describe('structuralDisagreements', () => {
  // An account that may read every catalog entry and not every table — the
  // PostgreSQL reader, SQL Server with database VIEW DEFINITION — describes
  // the same structure as the owner, with other privileges. Comparing
  // structure only is how "it sees sales.order exactly as the owner does" is
  // checked without the owner's privileges.
  test('ignores access and row security, and nothing else', () => {
    const reader = snapshot('postgres', (objects) => {
      for (const entry of objects) {
        entry.rowSecurity = 'applies'
        for (const column of entry.columns) column.access = { select: false, insert: false, update: false }
      }
    })
    expect(structuralDisagreements(reader)).toEqual([])
    expect(snapshotDisagreements(reader)).not.toEqual([])
    const short = snapshot('postgres', (objects) => {
      object(objects, 'order').columns.pop()
    })
    expect(structuralDisagreements(short)).toEqual([expect.stringMatching(/sales\.order columns are/)])
  })
})

/** A snapshot as `account` would take it: the model's objects with that account's privileges, `edit`ed. */
function asAccount(kind: DatabaseKind, access: (objects: ObjectMeta[]) => void, gaps: MetadataSnapshot['gaps'] = []): MetadataSnapshot {
  return snapshot(kind, access, gaps)
}

/** Every column of every object narrowed to what `expected` grants, the way an adapter reading the fixture's grants would. */
function grantsOf(expected: typeof READER_ACCESS, kind: DatabaseKind) {
  return (objects: ObjectMeta[]): void => {
    for (const entry of objects) {
      const granted = { ...expected[entry.ref.name], ...expected[entry.ref.name]?.byKind?.[kind] }
      const has = (list: unknown, name: string) => list === 'all' || (Array.isArray(list) && list.includes(name))
      for (const column of entry.columns) {
        column.access = { select: has(granted.select, column.name), insert: has(granted.insert, column.name), update: has(granted.update, column.name) }
      }
      const rowSecurity = granted.rowSecurity ?? 'none'
      entry.rowSecurity = typeof rowSecurity === 'string' ? rowSecurity : (rowSecurity[kind] ?? 'none')
    }
  }
}

describe('accessDisagreements', () => {
  // The baseline: a snapshot that says exactly what the fixture grants. A
  // comparator that complained about it would fail every adapter for a reason
  // in the test.
  test('a snapshot with exactly the granted privileges has no disagreements, for the reader and the writer, on either engine', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      expect(accessDisagreements(asAccount(kind, grantsOf(READER_ACCESS, kind)), READER_ACCESS), kind).toEqual([])
      expect(accessDisagreements(asAccount(kind, grantsOf(WRITER_ACCESS, kind)), WRITER_ACCESS), kind).toEqual([])
    }
  })

  // One privilege misread is a form that offers a write the database refuses,
  // or leaves out one it allows. Named by column and capability.
  test('a capability other than the one granted is a disagreement', () => {
    const misread = asAccount('postgres', (objects) => {
      grantsOf(WRITER_ACCESS, 'postgres')(objects)
      const amount = columnOf(objects, 'order', 'amount')
      amount.access = { ...amount.access, update: true }
    })
    expect(accessDisagreements(misread, WRITER_ACCESS)).toEqual(['sales.order.amount update is true, expected false'])
    // SQL Server's writer may not update row_version, PostgreSQL's may: the one engine difference in the grants.
    const sqlServer = asAccount('sqlserver', (objects) => {
      grantsOf(WRITER_ACCESS, 'sqlserver')(objects)
      const version = columnOf(objects, 'order', 'row_version')
      version.access = { ...version.access, update: true }
    })
    expect(accessDisagreements(sqlServer, WRITER_ACCESS)).toEqual(['sales.order.row_version update is true, expected false'])
  })

  // The silent answer again: an object the account may use, missing with
  // nothing saying why, reads as "no such table". One it may not use may be
  // left out, provided a gap on its schema or the scope says the catalog
  // hides things.
  test('an object expected usable but absent with no gap is a disagreement; absent behind a schema gap with no expected access it is not', () => {
    const without = (name: string) => (objects: ObjectMeta[]) => {
      grantsOf(READER_ACCESS, 'sqlserver')(objects)
      objects.splice(objects.indexOf(object(objects, name)), 1)
    }
    expect(accessDisagreements(asAccount('sqlserver', without('order')), READER_ACCESS)).toEqual(['sales.order is missing, though the account may use it'])
    expect(accessDisagreements(asAccount('sqlserver', without('employee')), READER_ACCESS)).toEqual(['sales.employee is missing and no objects gap says why'])
    const behind = asAccount('sqlserver', without('employee'), [{ subject: { kind: 'schema', schema: 'sales' }, aspect: 'objects', detail: 'no VIEW DEFINITION' }])
    expect(accessDisagreements(behind, READER_ACCESS)).toEqual([])
    const scoped = asAccount('sqlserver', without('employee'), [{ subject: { kind: 'scope' }, aspect: 'objects', detail: '1 object denied' }])
    expect(accessDisagreements(scoped, READER_ACCESS)).toEqual([])
    // A usable object is never excused by a gap.
    expect(accessDisagreements(asAccount('sqlserver', without('order'), [{ subject: { kind: 'scope' }, aspect: 'objects', detail: 'x' }]), READER_ACCESS)).toEqual([
      'sales.order is missing, though the account may use it',
    ])
  })

  // The failure 0027 exists to remove: an adapter that reads a
  // privilege-filtered catalog leaves out the columns its account may not
  // read, and every column it does report then agrees with the grants. Only
  // comparing the described columns with the model's notices; the writer is
  // held by this comparison alone.
  test('an object described without the columns its account may not read is a disagreement', () => {
    const filtered = asAccount('postgres', (objects) => {
      grantsOf(WRITER_ACCESS, 'postgres')(objects)
      const customer = object(objects, 'customer')
      customer.columns = customer.columns.filter((column) => column.access.select)
      // What such a catalog shows of the keys over the hidden columns: nothing.
      const shown = (columns: readonly string[]) => columns.every((name) => customer.columns.some((column) => column.name === name))
      customer.foreignKeys = customer.foreignKeys.filter((foreignKey) => shown(foreignKey.columns))
      customer.uniqueKeys = customer.uniqueKeys.filter((unique) => shown(unique.columns))
    })
    const disagreements = accessDisagreements(filtered, WRITER_ACCESS)
    expect(disagreements).toHaveLength(1)
    expect(disagreements[0]).toMatch(/^sales\.customer columns are \[tenant_id, customer_no, name\], expected \[tenant_id, customer_no, name, .+\]$/)
  })

  // Row security is the expectation, or "cannot tell" with the gap that says
  // why. Unknown with no gap is the silent unknown, which createSnapshot
  // refuses too; a snapshot read back from a file is not made by it.
  test('row security other than expected is a disagreement, and unknown needs a covering gap', () => {
    const silent = asAccount('postgres', (objects) => {
      grantsOf(READER_ACCESS, 'postgres')(objects)
      object(objects, 'customer').rowSecurity = 'none'
    })
    expect(accessDisagreements(silent, READER_ACCESS)).toEqual(['sales.customer row security is none, expected applies'])

    const told = asAccount(
      'sqlserver',
      (objects) => {
        grantsOf(READER_ACCESS, 'sqlserver')(objects)
        object(objects, 'order').rowSecurity = 'unknown'
      },
      [{ subject: { kind: 'scope' }, aspect: 'row-security', detail: 'no VIEW DEFINITION on the database' }],
    )
    expect(accessDisagreements(told, READER_ACCESS)).toEqual([])
    expect(accessDisagreements({ ...told, gaps: [] }, READER_ACCESS)).toEqual(['sales.order row security is unknown and no row-security gap says why'])
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
    const gap = [{ subject: { kind: 'object' as const, object: { schema: 'sales', name: 'order' } }, aspect: 'foreign-keys' as const, detail: 'target not visible' }]
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
