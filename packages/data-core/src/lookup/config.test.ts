import { describe, expect, test } from 'vitest'
import type { ColumnMeta, ForeignKeyMeta, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { createSnapshot } from '../snapshot.js'
import { generateForm } from '../generate/generate.js'
import type { FieldBinding, FormBindings, LookupChoice } from '../generate/types.js'
import { buildLookupConfig, DEFAULT_MAX_PAGE_SIZE } from './config.js'
import { validateLookupQuery } from './query.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const text = (maxLength: number | null): NormalizedType => ({ kind: 'text', maxLength, fixedLength: false })

function col(name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, ...extra }
}

function fk(name: string, columns: string[], target: string, targetColumns: string[]): ForeignKeyMeta {
  return {
    name,
    columns,
    references: { table: { schema: 'sales', name: target }, columns: targetColumns },
    onUpdate: 'no-action',
    onDelete: 'no-action',
    enforced: true,
    validated: true,
  }
}

function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta>): ObjectMeta {
  return { ref: { schema: 'sales', name }, kind: 'table', comment: null, columns, primaryKey: null, uniqueKeys: [], foreignKeys: [], checks: [], ...extra }
}

/** A customer with a composite key and columns of every kind a lookup treats differently; a rate keyed by a float. */
function snapshot(edit: (objects: ObjectMeta[]) => void = () => {}): MetadataSnapshot {
  const objects = [
    table(
      'customer',
      [
        col('tenant_id', 1, INT32),
        col('customer_no', 2, INT32),
        col('name', 3, text(200)),
        col('city', 4, text(100), { nullable: true }),
        col('since', 5, { kind: 'date' }),
        col('photo', 6, { kind: 'binary', maxLength: null }, { nullable: true, databaseType: 'bytea' }),
        col('notes', 7, text(null), { nullable: true }),
      ],
      { primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] } },
    ),
    table('rate', [col('factor', 1, { kind: 'float', bits: 64 }, { databaseType: 'double precision' }), col('label', 2, text(50))], {
      primaryKey: { name: 'pk_rate', columns: ['factor'] },
    }),
    table(
      'order',
      [col('id', 1, INT32, { generated: 'identity' }), col('tenant_id', 2, INT32), col('customer_no', 3, INT32), col('rate_factor', 4, { kind: 'float', bits: 64 }, { nullable: true })],
      {
        primaryKey: { name: 'pk_order', columns: ['id'] },
        foreignKeys: [fk('fk_order_customer', ['tenant_id', 'customer_no'], 'customer', ['tenant_id', 'customer_no']), fk('fk_order_rate', ['rate_factor'], 'rate', ['factor'])],
      },
    ),
  ]
  edit(objects)
  return createSnapshot({ kind: 'postgres', serverVersion: '17.6', scope: { schemas: ['sales'] }, objects, gaps: [] })
}

/** Bindings exactly as the generator makes them, for a customer lookup showing `display`. */
function bindingsFor(source: MetadataSnapshot, display: string[], more: LookupChoice[] = []): FormBindings {
  const lookups = [{ foreignKey: 'fk_order_customer', display }, ...more]
  return generateForm(source, { connection: 'erp', root: { schema: 'sales', name: 'order' }, formId: 'sales-order', title: 'Order', lookups }).bindings
}

/** A deep copy to edit, so one test's tampering never reaches another's bindings. `structuredClone` is a host API this package does not compile against. */
function copyOf(bindings: FormBindings): FormBindings {
  return JSON.parse(JSON.stringify(bindings)) as FormBindings
}

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/** The bindings with the customer lookup edited, as a stored file can be. */
function editedLookup(bindings: FormBindings, edit: (lookup: LookupBinding) => void): FormBindings {
  const copy = copyOf(bindings)
  for (const field of copy.fields) if (field.kind === 'lookup' && field.field === 'customer') edit(field)
  return copy
}

/** The snapshot with order's foreign key to customer edited. */
function withCustomerKey(edit: (key: ForeignKeyMeta) => void): MetadataSnapshot {
  return snapshot((objects) => {
    const key = objects.find((object) => object.ref.name === 'order')?.foreignKeys.find((candidate) => candidate.name === 'fk_order_customer')
    if (key !== undefined) edit(key)
  })
}

describe('buildLookupConfig', () => {
  // The config is everything an adapter is allowed to know about the lookup.
  // A key column out of order would put each value of a token in the wrong
  // column, a key without its type would leave each adapter to decide what a
  // value of it looks like, and a sort without the key would let a page
  // boundary fall between two rows with the same name, showing one twice and
  // the other never.
  test('derives the lookup from generated bindings: the key in order with its types, and an order that is total', () => {
    const source = snapshot()
    expect(buildLookupConfig(bindingsFor(source, ['name', 'city']), 'customer', { snapshot: source })).toEqual({
      source: 'erp-sales-order-fk-order-customer',
      foreignKey: 'fk_order_customer',
      target: { schema: 'sales', name: 'customer' },
      targetColumns: [
        { name: 'tenant_id', type: INT32 },
        { name: 'customer_no', type: INT32 },
      ],
      display: ['name', 'city'],
      search: ['name', 'city'],
      sort: [
        { column: 'name', direction: 'asc', nulls: 'last' },
        { column: 'city', direction: 'asc', nulls: 'last' },
        { column: 'tenant_id', direction: 'asc', nulls: 'last' },
        { column: 'customer_no', direction: 'asc', nulls: 'last' },
      ],
      maxPageSize: DEFAULT_MAX_PAGE_SIZE,
    })
  })

  // formancy's select asks for fifty rows unless the host says otherwise
  // (MAX_ROWS in @formancy/react and @formancy/angular). A default page size
  // below that would refuse every search the default control makes.
  test('by default, accepts the page formancy\'s control asks for', () => {
    const source = snapshot()
    const config = buildLookupConfig(bindingsFor(source, ['name']), 'customer', { snapshot: source })
    expect(validateLookupQuery(config, { search: 'Acme', offset: 0, limit: 50 })).toMatchObject({ ok: true })
    expect(buildLookupConfig(bindingsFor(source, ['name']), 'customer', { snapshot: source, maxPageSize: 10 }).maxPageSize).toBe(10)
  })

  // A chosen order still has to be total. The key is appended after it, once,
  // so a key column the administrator already sorts by keeps its direction.
  test('ends any chosen order with the key columns it does not already name', () => {
    const source = snapshot()
    const bindings = bindingsFor(source, ['name'])
    expect(buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'since', direction: 'desc' }] }).sort).toEqual([
      { column: 'since', direction: 'desc', nulls: 'last' },
      { column: 'tenant_id', direction: 'asc', nulls: 'last' },
      { column: 'customer_no', direction: 'asc', nulls: 'last' },
    ])
    expect(buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'customer_no', direction: 'desc' }] }).sort).toEqual([
      { column: 'customer_no', direction: 'desc', nulls: 'last' },
      { column: 'tenant_id', direction: 'asc', nulls: 'last' },
    ])
  })

  // PostgreSQL puts NULLs last in an ascending order and SQL Server puts them
  // first, so an order over a nullable column that left it to the engine would
  // show a different first page on each. Every column of the order says where
  // NULLs go — last unless the administrator chose otherwise, in either
  // direction — and each adapter spells that, so neither engine decides it.
  test('says where NULLs go in every column of the order', () => {
    const source = snapshot()
    const bindings = bindingsFor(source, ['name', 'city'])
    expect(buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'city', direction: 'desc' }] }).sort[0]).toEqual({
      column: 'city',
      direction: 'desc',
      nulls: 'last',
    })
    expect(buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'city', direction: 'asc', nulls: 'first' }] }).sort[0]).toEqual({
      column: 'city',
      direction: 'asc',
      nulls: 'first',
    })
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'city', direction: 'asc', nulls: 'middle' as 'first' }] })).toThrow(
      /city puts NULLs first or last/,
    )
  })

  // formancy narrows a list by its label and nothing else, because matching
  // data the person cannot see makes a filter behave inexplicably. A search
  // column that is not displayed would do exactly that. And a date searched
  // as text matches each engine's spelling of it — PostgreSQL's depends on a
  // session setting — so only text and integers, which both spell alike, are searched.
  test('searches only displayed text and integer columns', () => {
    const source = snapshot()
    expect(buildLookupConfig(bindingsFor(source, ['customer_no', 'name', 'since']), 'customer', { snapshot: source }).search).toEqual(['customer_no', 'name'])
    expect(buildLookupConfig(bindingsFor(source, ['since']), 'customer', { snapshot: source }).search).toEqual([])

    const bindings = bindingsFor(source, ['name', 'city', 'since'])
    expect(buildLookupConfig(bindings, 'customer', { snapshot: source, search: ['city'] }).search).toEqual(['city'])
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: source, search: ['notes'] })).toThrow(/notes is not displayed/)
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: source, search: ['since'] })).toThrow(/since is date; only text and integer/)
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: source, search: ['name', 'name'] })).toThrow(/name is named twice/)
  })

  // A float is not equal to its own decimal spelling in general, so a token
  // holding one could fail to find the row it came from. Binary has no text
  // form a token or a label can carry. Each is refused, naming the column.
  test('refuses a key no token can hold exactly, and a display or sort column with no text form', () => {
    const source = snapshot()
    const rate = bindingsFor(source, ['name'], [{ foreignKey: 'fk_order_rate', display: ['label'] }])
    expect(() => buildLookupConfig(rate, 'rate', { snapshot: source })).toThrow(/key column factor is double precision; a floating-point value cannot be referenced exactly/)
    const binaryKeyed = snapshot((objects) => {
      const factor = objects.find((object) => object.ref.name === 'rate')?.columns[0]
      if (factor !== undefined) Object.assign(factor, { type: { kind: 'binary', maxLength: 16 }, databaseType: 'bytea' })
    })
    const binaryRate = bindingsFor(binaryKeyed, ['name'], [{ foreignKey: 'fk_order_rate', display: ['label'] }])
    expect(() => buildLookupConfig(binaryRate, 'rate', { snapshot: binaryKeyed })).toThrow(/key column factor is bytea, which has no text form for a token/)
    expect(() => buildLookupConfig(bindingsFor(source, ['photo']), 'customer', { snapshot: source })).toThrow(/display column photo is bytea/)
    expect(() => buildLookupConfig(bindingsFor(source, ['name']), 'customer', { snapshot: source, sort: [{ column: 'photo', direction: 'asc' }] })).toThrow(
      /photo is bytea, which has no order/,
    )
  })

  // lookupKeys asks the database only about values spelled as the key column
  // holds them, so that a value one engine reads and the other refuses is
  // never bound. For a boolean, a time or a timestamp no such spelling is
  // settled — the engines read many spellings of each and round fractional
  // seconds to their own precision — so a key of one is refused here, naming
  // the column, rather than asked about in a spelling the engines read apart.
  test('refuses a key whose values have no settled spelling, and carries the type of one that has', () => {
    const keyedBy = (type: NormalizedType, databaseType: string): MetadataSnapshot =>
      snapshot((objects) => {
        const factor = objects.find((object) => object.ref.name === 'rate')?.columns[0]
        if (factor !== undefined) Object.assign(factor, { type, databaseType })
      })
    const unsettled: Array<[NormalizedType, string]> = [
      [{ kind: 'boolean' }, 'boolean'],
      [{ kind: 'time', precision: 6 }, 'time'],
      [{ kind: 'timestamp', withTimeZone: true, precision: 6 }, 'timestamptz'],
    ]
    for (const [type, databaseType] of unsettled) {
      const keyed = keyedBy(type, databaseType)
      const bindings = bindingsFor(keyed, ['name'], [{ foreignKey: 'fk_order_rate', display: ['label'] }])
      expect(() => buildLookupConfig(bindings, 'rate', { snapshot: keyed }), databaseType).toThrow(
        new RegExp(`key column factor is ${databaseType}; a lookup has no settled spelling for its values`),
      )
    }

    const dated = keyedBy({ kind: 'date' }, 'date')
    const bindings = bindingsFor(dated, ['name'], [{ foreignKey: 'fk_order_rate', display: ['label'] }])
    expect(buildLookupConfig(bindings, 'rate', { snapshot: dated }).targetColumns).toEqual([{ name: 'factor', type: { kind: 'date' } }])
  })

  // Bindings are stored, and a stored file can be stale or edited. A config
  // built from bindings that do not match the snapshot would quote column names
  // the database may not have.
  test('refuses bindings from another snapshot, or naming what the snapshot does not have', () => {
    const source = snapshot()
    const bindings = bindingsFor(source, ['name'])
    const changed = snapshot((objects) => objects[0]?.columns.push(col('vip', 8, { kind: 'boolean' })))
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: changed })).toThrow(/different snapshot/)

    // A foreign key may reach a table outside the discovered scope; bindings
    // that say so honestly still name a table the snapshot cannot vouch for.
    const outside = withCustomerKey((key) => {
      if (key.references !== null) key.references.table.name = 'elsewhere'
    })
    const elsewhere = editedLookup(bindings, (lookup) => (lookup.target.table.name = 'elsewhere'))
    elsewhere.snapshotFingerprint = outside.fingerprint
    expect(() => buildLookupConfig(elsewhere, 'customer', { snapshot: outside })).toThrow(/sales\.elsewhere is outside the snapshot/)

    expect(() => buildLookupConfig(editedLookup(bindings, (lookup) => (lookup.display = ['nope'])), 'customer', { snapshot: source })).toThrow(/has no column nope/)
    expect(() => buildLookupConfig({ ...bindings, version: 2 as 1 }, 'customer', { snapshot: source })).toThrow(/version 2/)
  })

  // The fingerprint is the snapshot's, not the bindings': an edited file keeps
  // it. A lookup aimed anywhere but where its foreign key points — another
  // table, or columns of this one that are not the referenced key — would
  // offer rows the column was never meant to hold, under a "key" nothing makes
  // unique, so the order would not be total and one token could name several
  // rows. The foreign key in the snapshot is the authority, and the bindings
  // have to say exactly what it says, column order included.
  test('refuses a lookup that is not what its foreign key references', () => {
    const source = snapshot()
    const bindings = bindingsFor(source, ['name'])
    const build = (edited: FormBindings) => () => buildLookupConfig(edited, 'customer', { snapshot: source })
    const mismatch = /the bindings do not say what fk_order_customer does: it goes from \(tenant_id, customer_no\) to sales\.customer \(tenant_id, customer_no\)/

    const anotherTable = editedLookup(bindings, (lookup) => {
      lookup.target = { table: { schema: 'sales', name: 'rate' }, columns: ['label'] }
      lookup.display = ['label']
    })
    expect(build(anotherTable)).toThrow(mismatch)
    expect(build(editedLookup(bindings, (lookup) => (lookup.target.columns = ['name', 'city'])))).toThrow(mismatch)
    expect(build(editedLookup(bindings, (lookup) => (lookup.target.columns = ['customer_no', 'tenant_id'])))).toThrow(mismatch)
    expect(build(editedLookup(bindings, (lookup) => (lookup.target.columns = ['tenant_id'])))).toThrow(mismatch)
    expect(build(editedLookup(bindings, (lookup) => (lookup.columns = ['customer_no', 'tenant_id'])))).toThrow(mismatch)
    expect(build(editedLookup(bindings, (lookup) => (lookup.target.table.schema = 'other')))).toThrow(/do not say what fk_order_customer does/)
    expect(build(editedLookup(bindings, (lookup) => (lookup.foreignKey = 'fk_order_rate')))).toThrow(/do not say what fk_order_rate does/)
    expect(build(editedLookup(bindings, (lookup) => (lookup.foreignKey = 'fk_nope')))).toThrow(/sales\.order has no foreign key fk_nope/)
    expect(build({ ...copyOf(bindings), root: { schema: 'sales', name: 'nope' } })).toThrow(/the form's table sales\.nope is outside the snapshot/)

    // A permission revoked since: the key is still there, and where it points is not.
    const hidden = withCustomerKey((key) => (key.references = null))
    const unseen = { ...copyOf(bindings), snapshotFingerprint: hidden.fingerprint }
    expect(() => buildLookupConfig(unseen, 'customer', { snapshot: hidden })).toThrow(/this connection cannot see what fk_order_customer references/)
  })

  // Each of these is a configuration that cannot mean what it says.
  test('refuses a field that is not a lookup, and options that cannot be honoured', () => {
    const source = snapshot()
    const bindings = bindingsFor(source, ['name'])
    expect(() => buildLookupConfig(bindings, 'nope', { snapshot: source })).toThrow(/nope is not a field/)
    expect(() => buildLookupConfig(bindings, 'id', { snapshot: source })).toThrow(/id is bound to the column id, not to a lookup/)
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'name', direction: 'up' as 'asc' }] })).toThrow(/asc or desc/)
    expect(() =>
      buildLookupConfig(bindings, 'customer', {
        snapshot: source,
        sort: [
          { column: 'name', direction: 'asc' },
          { column: 'name', direction: 'desc' },
        ],
      }),
    ).toThrow(/name is named twice/)
    for (const maxPageSize of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildLookupConfig(bindings, 'customer', { snapshot: source, maxPageSize }), String(maxPageSize)).toThrow(/at least 1/)
    }

    const empty = copyOf(bindings)
    for (const field of empty.fields) if (field.kind === 'lookup') field.display = []
    expect(() => buildLookupConfig(empty, 'customer', { snapshot: source })).toThrow(/at least one display column/)
  })
})
