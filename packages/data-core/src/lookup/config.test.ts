import { describe, expect, test } from 'vitest'
import type { ColumnMeta, ForeignKeyMeta, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { createSnapshot } from '../snapshot.js'
import { generateForm } from '../generate/generate.js'
import type { FormBindings, LookupChoice } from '../generate/types.js'
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

describe('buildLookupConfig', () => {
  // The config is everything an adapter is allowed to know about the lookup.
  // A key column out of order would put each value of a token in the wrong
  // column, and a sort without the key would let a page boundary fall between
  // two rows with the same name, showing one twice and the other never.
  test('derives the lookup from generated bindings: the key in order, and an order that is total', () => {
    const source = snapshot()
    expect(buildLookupConfig(bindingsFor(source, ['name', 'city']), 'customer', { snapshot: source })).toEqual({
      source: 'erp-sales-order-fk-order-customer',
      foreignKey: 'fk_order_customer',
      target: { schema: 'sales', name: 'customer' },
      targetColumns: ['tenant_id', 'customer_no'],
      display: ['name', 'city'],
      search: ['name', 'city'],
      sort: [
        { column: 'name', direction: 'asc' },
        { column: 'city', direction: 'asc' },
        { column: 'tenant_id', direction: 'asc' },
        { column: 'customer_no', direction: 'asc' },
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
      { column: 'since', direction: 'desc' },
      { column: 'tenant_id', direction: 'asc' },
      { column: 'customer_no', direction: 'asc' },
    ])
    expect(buildLookupConfig(bindings, 'customer', { snapshot: source, sort: [{ column: 'customer_no', direction: 'desc' }] }).sort).toEqual([
      { column: 'customer_no', direction: 'desc' },
      { column: 'tenant_id', direction: 'asc' },
    ])
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

  // Bindings are stored, and a stored file can be stale or edited. A config
  // built from bindings that do not match the snapshot would quote column names
  // the database may not have.
  test('refuses bindings from another snapshot, or naming what the snapshot does not have', () => {
    const source = snapshot()
    const bindings = bindingsFor(source, ['name'])
    const changed = snapshot((objects) => objects[0]?.columns.push(col('vip', 8, { kind: 'boolean' })))
    expect(() => buildLookupConfig(bindings, 'customer', { snapshot: changed })).toThrow(/different snapshot/)

    const retarget = (edit: (target: { table: { schema: string; name: string }; columns: string[] }) => void): FormBindings => {
      const copy = copyOf(bindings)
      for (const field of copy.fields) if (field.kind === 'lookup') edit(field.target)
      return copy
    }
    expect(() => buildLookupConfig(retarget((target) => (target.table.name = 'nope')), 'customer', { snapshot: source })).toThrow(/sales\.nope is outside the snapshot/)
    expect(() => buildLookupConfig(retarget((target) => (target.columns = ['tenant_id', 'nope'])), 'customer', { snapshot: source })).toThrow(/has no column nope/)
    expect(() => buildLookupConfig({ ...bindings, version: 2 as 1 }, 'customer', { snapshot: source })).toThrow(/version 2/)
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
