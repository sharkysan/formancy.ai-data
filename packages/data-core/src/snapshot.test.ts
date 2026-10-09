import { describe, expect, test } from 'vitest'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from './metadata.js'
import { createSnapshot, findObject, isComplete } from './snapshot.js'

function column(name: string, ordinal: number): ColumnMeta {
  return {
    name,
    ordinal,
    databaseType: 'integer',
    type: { kind: 'integer', min: '-2147483648', max: '2147483647' },
    nullable: false,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
  }
}

function table(name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return {
    ref: { schema: 'sales', name },
    kind: 'table',
    comment: null,
    columns,
    primaryKey: null,
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    ...extra,
  }
}

function snapshot(objects: ObjectMeta[], extra: Partial<Omit<MetadataSnapshot, 'fingerprint'>> = {}): MetadataSnapshot {
  return createSnapshot({ kind: 'postgres', serverVersion: '17.6', scope: { schemas: ['sales'] }, objects, gaps: [], ...extra })
}

describe('createSnapshot', () => {
  // Two adapters, or one adapter on two days, may read the catalog in any order.
  // If the order reached the hash, the same database would report drift against
  // itself.
  test('the fingerprint does not depend on the order the catalog was read in', () => {
    const a = table('a', [column('x', 1), column('y', 2)])
    const b = table('b', [column('z', 1)])
    const forwards = snapshot([a, b])
    const backwards = snapshot([b, { ...a, columns: [...a.columns].reverse() }])
    expect(backwards.fingerprint).toBe(forwards.fingerprint)
    expect(backwards.objects.map((object) => object.ref.name)).toEqual(['a', 'b'])
    expect(backwards.objects[0]?.columns.map((entry) => entry.name)).toEqual(['x', 'y'])
  })

  // A patch upgrade of the server is not a change to anything a form is bound to.
  test('the server version is not part of the fingerprint', () => {
    const objects = [table('a', [column('x', 1)])]
    expect(snapshot(objects, { serverVersion: '17.7' }).fingerprint).toBe(snapshot(objects).fingerprint)
  })

  // A revoked permission must be noticed as a change, so drift review can say
  // "access changed" instead of staying silent.
  test('a new gap changes the fingerprint', () => {
    const objects = [table('a', [column('x', 1)])]
    const narrowed = snapshot(objects, { gaps: [{ object: { schema: 'sales', name: 'a' }, aspect: 'foreign-keys', detail: 'hidden' }] })
    expect(narrowed.fingerprint).not.toBe(snapshot(objects).fingerprint)
    expect(isComplete(narrowed)).toBe(false)
    expect(isComplete(snapshot(objects))).toBe(true)
  })

  // Locale-aware sorting would hash the same catalog differently on two hosts.
  // Uppercase sorts before lowercase by codepoint and after it in most locales.
  test('sorts by codepoint, not by locale', () => {
    const sorted = snapshot([table('b', [column('x', 1)]), table('B', [column('x', 1)]), table('a', [column('x', 1)])])
    expect(sorted.objects.map((object) => object.ref.name)).toEqual(['B', 'a', 'b'])
  })

  // An adapter bug that reported a key over a missing column would bind a form
  // to a column that is not there. It is refused here, naming the object.
  test('refuses a key over a column the table does not have', () => {
    const broken = table('a', [column('x', 1)], { primaryKey: { name: 'pk_a', columns: ['y'] } })
    expect(() => snapshot([broken])).toThrow(/sales\.a: key pk_a names y/)
  })

  // A composite foreign key whose sides differ in length cannot be paired, and
  // pairing it anyway would join on the wrong columns.
  test('refuses a foreign key whose two sides have different lengths', () => {
    const broken = table('a', [column('x', 1), column('y', 2)], {
      foreignKeys: [
        {
          name: 'fk_a_b',
          columns: ['x', 'y'],
          references: { table: { schema: 'sales', name: 'b' }, columns: ['id'] },
          onUpdate: 'no-action',
          onDelete: 'no-action',
          enforced: true,
          validated: true,
        },
      ],
    })
    expect(() => snapshot([broken])).toThrow(/pairs 2 columns with 1/)
  })

  // A foreign key whose target this connection cannot see is reported, not
  // dropped. Its sides cannot be compared, so that check must not throw.
  test('accepts a foreign key with an unknown target', () => {
    const partial = table('a', [column('x', 1)], {
      foreignKeys: [
        { name: 'fk_a_hidden', columns: ['x'], references: null, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true },
      ],
    })
    expect(snapshot([partial]).objects[0]?.foreignKeys[0]?.references).toBeNull()
  })

  // The same object twice is an adapter that joined the catalog wrongly.
  test('refuses an object reported twice, and a column reported twice', () => {
    expect(() => snapshot([table('a', [column('x', 1)]), table('a', [column('x', 1)])])).toThrow(/reported twice/)
    expect(() => snapshot([table('a', [column('x', 1), column('x', 2)])])).toThrow(/column x is reported twice/)
  })

  // A key with no columns is not a key, and neither is a foreign key with none.
  test('refuses a key or a foreign key with no columns', () => {
    expect(() => snapshot([table('a', [column('x', 1)], { uniqueKeys: [{ name: 'uq', columns: [] }] })])).toThrow(/has no columns/)
    expect(() =>
      snapshot([
        table('a', [column('x', 1)], {
          foreignKeys: [{ name: 'fk', columns: [], references: null, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }],
        }),
      ]),
    ).toThrow(/foreign key fk has no columns/)
    expect(() =>
      snapshot([
        table('a', [column('x', 1)], {
          foreignKeys: [{ name: 'fk', columns: ['nope'], references: null, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }],
        }),
      ]),
    ).toThrow(/foreign key fk names nope/)
  })

  // A snapshot stored before contract v2 — a published bundle, the examples
  // page's capture — has text with no length unit, binary with no fixedLength,
  // checks with no enforced flag and a bare 'identity'. Trusted, it would reach
  // a codec counting in no unit and a generator reading an identity it does
  // not know. Refused here, naming the column or check (0026).
  test("refuses a snapshot in the shape contract v1 wrote: a text with no length unit, a binary with no fixedLength, a check with no enforced flag, generated 'identity'", () => {
    const old = (columns: unknown[], checks: unknown[] = []) => () => snapshot([table('a', columns as ColumnMeta[], { checks: checks as ObjectMeta['checks'] })])
    const typed = (type: unknown, extra: Record<string, unknown> = {}) => ({ ...column('name', 1), type, ...extra })

    expect(old([typed({ kind: 'text', maxLength: 20, fixedLength: false })])).toThrow(/sales\.a: column name has no text length unit/)
    expect(old([typed({ kind: 'text', maxLength: 20, lengthUnit: 'characters', fixedLength: false })])).toThrow(/sales\.a: column name has no text length unit/)
    expect(old([typed({ kind: 'binary', maxLength: 16 })])).toThrow(/sales\.a: column name is binary with no fixedLength flag/)
    expect(old([typed({ kind: 'integer', min: '0', max: '1' }, { generated: 'identity' })])).toThrow(/sales\.a: column name has generation "identity", which is not one the contract names/)
    expect(old([column('x', 1)], [{ name: 'ck_a', expression: null, validated: true }])).toThrow(/sales\.a: check ck_a has no enforced flag/)

    // The shape contract v2 writes is accepted.
    expect(
      old(
        [
          typed({ kind: 'text', maxLength: 20, lengthUnit: 'utf8-bytes', fixedLength: false }),
          { ...column('id', 2), generated: 'identity-by-default' },
          { ...column('hash', 3), type: { kind: 'binary', maxLength: 32, fixedLength: true } },
        ],
        [{ name: 'ck_a', expression: null, enforced: false, validated: false }],
      ),
    ).not.toThrow()
  })

  // The scope is what the administrator approved; repeating a schema is not two scopes.
  test('normalises the scope and finds an object by reference', () => {
    const made = snapshot([table('a', [column('x', 1)])], { scope: { schemas: ['sales', 'audit', 'sales'] } })
    expect(made.scope.schemas).toEqual(['audit', 'sales'])
    expect(findObject(made, { schema: 'sales', name: 'a' })?.ref.name).toBe('a')
    expect(findObject(made, { schema: 'audit', name: 'a' })).toBeUndefined()
  })
})
