import { describe, expect, test } from 'vitest'
import type { ColumnMeta, CoverageGap, MetadataSnapshot, ObjectMeta } from './metadata.js'
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
    access: { select: true, insert: true, update: true },
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
    rowSecurity: 'none',
    ...extra,
  }
}

const OWNER = { user: 'owner', login: 'owner' }

function snapshot(objects: ObjectMeta[], extra: Partial<Omit<MetadataSnapshot, 'fingerprint'>> = {}): MetadataSnapshot {
  return createSnapshot({ kind: 'postgres', serverVersion: '17.6', account: OWNER, scope: { schemas: ['sales'] }, objects, gaps: [], ...extra })
}

const onObject = (name: string, aspect: CoverageGap['aspect'] = 'foreign-keys'): CoverageGap => ({ subject: { kind: 'object', object: { schema: 'sales', name } }, aspect, detail: 'hidden' })

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
    const narrowed = snapshot(objects, { gaps: [onObject('a')] })
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

  // The principal is who the database evaluates grants and policies for: the
  // same connection under another current_user reads other rows (B5). Left
  // out of the hash, a snapshot taken as another principal would hash the same
  // and drift's fast path would hide the change. The login is who connected:
  // a login mapped to the same user is the same principal, and a rename of it
  // is not drift; neither is a patch upgrade.
  test("the account's user is in the fingerprint; its login and the server version are not", () => {
    const objects = [table('a', [column('x', 1)])]
    const base = snapshot(objects)
    expect(snapshot(objects, { account: { user: 'clerk', login: 'owner' } }).fingerprint).not.toBe(base.fingerprint)
    expect(snapshot(objects, { account: { user: 'owner', login: 'app_login_2026' } }).fingerprint).toBe(base.fingerprint)
    expect(snapshot(objects, { serverVersion: '17.7' }).fingerprint).toBe(base.fingerprint)
    expect(base.account).toEqual(OWNER)
  })

  // What server the catalog was read from (0068) is carried for the
  // standing a person is shown, and is not what a form binds to: in the
  // hash, a major upgrade or a compatibility change would read as drift of
  // every form, and two servers holding one catalog would differ. Dropped,
  // nobody could say whether the server was tested.
  test('carries the server outside the fingerprint, and leaves it out of a snapshot that names none', () => {
    const objects = [table('a', [column('x', 1)])]
    const base = snapshot(objects)
    const on17 = snapshot(objects, { server: { product: 'postgresql', major: 17 } })
    expect(on17.server).toEqual({ product: 'postgresql', major: 17 })
    expect(on17.fingerprint).toBe(base.fingerprint)
    expect(snapshot(objects, { server: { product: 'postgresql', major: 18 } }).fingerprint).toBe(base.fingerprint)
    const sqlserver = snapshot(objects, { kind: 'sqlserver', server: { product: 'sqlserver', major: 16, compatibility: 140 } })
    expect(sqlserver.server).toEqual({ product: 'sqlserver', major: 16, compatibility: 140 })
    expect(snapshot(objects, { kind: 'sqlserver', server: { product: 'sqlserver', major: 16, compatibility: 160 } }).fingerprint).toBe(sqlserver.fingerprint)
    // A snapshot taken before 0068 has no such property, and gains none.
    expect(base).not.toHaveProperty('server')
  })

  // The server is outside the hash, so a posted bundle's could say anything
  // and still hash to its fingerprint: a product no adapter answers, or a
  // major that is not a whole number, is refused as no catalog's.
  test('refuses server facts no adapter could answer', () => {
    const objects = [table('a', [column('x', 1)])]
    expect(() => snapshot(objects, { server: { product: 'mysql' as never, major: 8 } })).toThrow(/the server's product "mysql" is not one the contract names/)
    expect(() => snapshot(objects, { server: { product: 'postgresql', major: 16.5 } })).toThrow(/the server's major 16.5 is neither a whole number nor null/)
    expect(() => snapshot(objects, { server: { product: 'sqlserver', major: 16, compatibility: '160' as never } })).toThrow(/the server's compatibility level 160 is not a whole number/)
  })

  // A revoked column grant is a change to what a form bound to the column can
  // do, so it must move the fingerprint, or drift's fast path would never look.
  // So must row security starting to apply.
  test('a revoked column privilege moves the fingerprint, and so does row security', () => {
    const before = snapshot([table('a', [column('x', 1)])])
    const revoked = snapshot([table('a', [{ ...column('x', 1), access: { select: true, insert: true, update: false } }])])
    expect(revoked.fingerprint).not.toBe(before.fingerprint)
    expect(snapshot([table('a', [column('x', 1)], { rowSecurity: 'applies' })]).fingerprint).not.toBe(before.fingerprint)
  })

  // An adapter that forgot privileges would otherwise read as no access or as
  // full access, depending on who reads the missing field; a stored pre-0027
  // bundle has no access at all and was hashed without it. Refused, naming the
  // column, and the old shape says when it was taken.
  test('refuses a column with no access or a capability that is not a boolean, and a snapshot in the shape 0026 wrote', () => {
    const { access: _access, ...bare } = column('x', 1)
    expect(() => snapshot([table('a', [bare as ColumnMeta])])).toThrow(/sales\.a: column x has no access; it was taken before 0027/)
    const half = { ...column('x', 1), access: { select: true, insert: 'yes', update: true } } as unknown as ColumnMeta
    expect(() => snapshot([table('a', [half])])).toThrow(/sales\.a: column x has an access insert that is not a boolean/)

    const { rowSecurity: _rowSecurity, ...oldTable } = table('a', [bare as ColumnMeta])
    const old = { kind: 'postgres', serverVersion: '17.6', scope: { schemas: ['sales'] }, objects: [oldTable], gaps: [] }
    expect(() => createSnapshot(old as unknown as Parameters<typeof createSnapshot>[0])).toThrow(/has no access; it was taken before 0027/)
    const noAccount = { ...old, objects: [table('a', [column('x', 1)])] }
    expect(() => createSnapshot(noAccount as unknown as Parameters<typeof createSnapshot>[0])).toThrow(/names no account; it was taken before 0027/)
    const oldGap = { ...noAccount, account: OWNER, gaps: [{ object: null, aspect: 'objects', detail: 'x' }] }
    expect(() => createSnapshot(oldGap as unknown as Parameters<typeof createSnapshot>[0])).toThrow(/a gap has no subject; it was taken before 0027/)
  })

  // Row security outside the three values is an adapter bug; an empty account
  // names nobody, and the fingerprint would hash a principal that does not exist.
  test('refuses a row security outside the three values, and an empty account user or login', () => {
    expect(() => snapshot([table('a', [column('x', 1)], { rowSecurity: 'maybe' as never })])).toThrow(/sales\.a: row security "maybe" is not one the contract names/)
    expect(() => snapshot([table('a', [column('x', 1)])], { account: { user: '', login: 'owner' } })).toThrow(/the account names no user/)
    expect(() => snapshot([table('a', [column('x', 1)])], { account: { user: 'owner', login: '' } })).toThrow(/the account names no login/)
  })

  // "Cannot tell" with no reason is the silent unknown: a reader cannot tell
  // an adapter that looked and failed from one that never looked. A gap about
  // row security on the scope, the object's schema or the object explains it;
  // one about another object, another schema or another aspect does not.
  test('unknown row security needs a row-security gap that covers the object', () => {
    const unknown = [table('a', [column('x', 1)], { rowSecurity: 'unknown' })]
    const rowGap = (subject: CoverageGap['subject']): CoverageGap => ({ subject, aspect: 'row-security', detail: 'cannot tell' })
    expect(() => snapshot(unknown)).toThrow(/sales\.a: row security is unknown and no row-security gap covers it/)
    expect(() => snapshot(unknown, { gaps: [onObject('b', 'row-security')] })).toThrow(/no row-security gap covers it/)
    expect(() => snapshot(unknown, { gaps: [onObject('a', 'objects')] })).toThrow(/no row-security gap covers it/)
    expect(() => snapshot(unknown, { gaps: [rowGap({ kind: 'schema', schema: 'audit' })] })).toThrow(/no row-security gap covers it/)
    expect(() => snapshot(unknown, { gaps: [rowGap({ kind: 'scope' })] })).not.toThrow()
    expect(() => snapshot(unknown, { gaps: [rowGap({ kind: 'schema', schema: 'sales' })] })).not.toThrow()
    expect(() => snapshot(unknown, { gaps: [rowGap({ kind: 'object', object: { schema: 'sales', name: 'a' } })] })).not.toThrow()
  })

  // A gap's subject is hashed. One with no schema name, or a subject of a
  // kind nobody wrote, would hash a place that does not exist.
  test('refuses a gap whose subject is malformed or whose schema is empty', () => {
    const objects = [table('a', [column('x', 1)])]
    const gapOf = (subject: unknown) => ({ subject, aspect: 'objects', detail: 'x' }) as CoverageGap
    expect(() => snapshot(objects, { gaps: [gapOf({ kind: 'schema', schema: '' })] })).toThrow(/a gap names an empty schema/)
    expect(() => snapshot(objects, { gaps: [gapOf({ kind: 'table', object: { schema: 'sales', name: 'a' } })] })).toThrow(/a gap's subject is not one the contract names/)
    expect(() => snapshot(objects, { gaps: [gapOf({ kind: 'object', object: { schema: 'sales', name: '' } })] })).toThrow(/a gap's subject is not one the contract names/)
    expect(() => snapshot(objects, { gaps: [{ ...gapOf({ kind: 'scope' }), aspect: 'rows' as never }] })).toThrow(/a gap's aspect "rows" is not one the contract names/)
  })

  // The fingerprint hashes the gaps in order, so the order must not depend on
  // the order an adapter found them in. And SQL Server matches a scope by the
  // database's collation: a scope spelled SALES finds the schema the catalog
  // spells sales, so a schema gap carries the catalog's spelling and is not
  // refused for differing from the scope's.
  test('gaps sort scope, then schema, then object, and a schema subject is not compared with the scope', () => {
    const objects = [table('a', [column('x', 1)])]
    const gaps: CoverageGap[] = [
      onObject('a', 'checks'),
      { subject: { kind: 'schema', schema: 'sales' }, aspect: 'objects', detail: 'no VIEW DEFINITION' },
      { subject: { kind: 'scope' }, aspect: 'row-security', detail: 'cannot tell' },
      { subject: { kind: 'schema', schema: 'audit' }, aspect: 'objects', detail: 'no VIEW DEFINITION' },
    ]
    const made = snapshot(objects, { gaps, scope: { schemas: ['SALES', 'audit'] } })
    expect(made.gaps.map((gap) => gap.subject)).toEqual([
      { kind: 'scope' },
      { kind: 'schema', schema: 'audit' },
      { kind: 'schema', schema: 'sales' },
      { kind: 'object', object: { schema: 'sales', name: 'a' } },
    ])
    expect(snapshot(objects, { gaps: [...gaps].reverse(), scope: { schemas: ['SALES', 'audit'] } }).fingerprint).toBe(made.fingerprint)
  })
})

describe('what a snapshot says about deleting (0049)', () => {
  /** `a`, keyed by `id`, and `b`, whose `a_id` refers to it and cascades: one key, seen from both ends. */
  const toA = {
    name: 'fk_b_a',
    columns: ['a_id'],
    references: { table: { schema: 'sales', name: 'a' }, columns: ['id'] },
    onUpdate: 'no-action' as const,
    onDelete: 'cascade' as const,
    enforced: true,
    validated: true,
  }
  const inboundToA = { table: { schema: 'sales', name: 'b' }, name: 'fk_b_a', columns: ['a_id'], referencedColumns: ['id'], onDelete: 'cascade' as const, onUpdate: 'no-action' as const, enforced: true }
  const a = (extra: Partial<ObjectMeta> = {}) => table('a', [column('id', 1)], { primaryKey: { name: 'pk_a', columns: ['id'] }, ...extra })
  const b = (extra: Partial<ObjectMeta> = {}) => table('b', [column('id', 1), column('a_id', 2)], { foreignKeys: [toA], ...extra })
  const withFacts = (deletable: boolean, extra: Partial<ObjectMeta> = {}): Partial<ObjectMeta> => ({ access: { delete: deletable }, referencedBy: [], ...extra })

  // Every bundle published before this record carries a snapshot with
  // neither fact, and the server hashes it again on every read (0019). A
  // contract that filled the absent facts in -- `delete: false`, no keys --
  // would hash those snapshots differently, and every published form would be
  // refused as edited after it was taken. The literal is what the release
  // before 0049 made of these two tables (data-core at 0cf7ce8).
  test('a snapshot taken before 0049, with neither fact on any object, validates and keeps the fingerprint it was stored with', () => {
    const stored = snapshot([a(), b()])
    expect(stored.fingerprint).toBe('5939f7cc8e1b1dda3c8b5e18421ee79301f9bda1e3b1648ca2f0c2b5c1390431')
    expect(stored.objects.map((object) => [object.access, object.referencedBy])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ])
    expect(stored.objects.every((object) => !('access' in object) && !('referencedBy' in object))).toBe(true)
  })

  // The two facts are one answer: whether a delete can be made, and what it
  // also does. A snapshot that said one and not the other would offer a delete
  // whose reach nobody looked at, or a reach with no word on the grant; one
  // object without them among objects with them is no catalog's answer.
  test('one fact without the other is refused, and so is an object without them among objects with them', () => {
    expect(() => snapshot([a({ access: { delete: true } })])).toThrow(/sales\.a: access without referencedBy/)
    expect(() => snapshot([a({ referencedBy: [] })])).toThrow(/sales\.a: referencedBy without access/)
    expect(() => snapshot([a(withFacts(true, { referencedBy: [inboundToA] })), b()])).toThrow(/sales\.b: has neither access nor referencedBy, while sales\.a has both/)
    expect(() => snapshot([a({ access: { delete: 'yes' } as never, referencedBy: [] })])).toThrow(/sales\.a: access delete is not a boolean/)
    expect(() => snapshot([a({ access: { delete: true }, referencedBy: {} as never })])).toThrow(/sales\.a: referencedBy is not a list/)
  })

  // A key onto a table in scope is on another object of the same snapshot,
  // whose foreignKeys say it too. Two records of one fact are made from one
  // catalog read or they disagree, and a disagreement is an adapter bug that
  // would let review show one reach and the runtime guard another (0004).
  test('referencedBy and the referring table’s own foreign keys must agree, both ways, for a table in the snapshot', () => {
    expect(() => snapshot([a(withFacts(true)), b(withFacts(true))])).toThrow(/sales\.a: referencedBy lacks fk_b_a of sales\.b, which refers to it/)
    expect(() => snapshot([a(withFacts(true, { referencedBy: [inboundToA] })), b(withFacts(true, { foreignKeys: [] }))])).toThrow(
      /sales\.a: referencedBy names fk_b_a of sales\.b, which has no such foreign key onto it/,
    )
    expect(() => snapshot([a(withFacts(true, { referencedBy: [{ ...inboundToA, onDelete: 'set-null' }] })), b(withFacts(true))])).toThrow(
      /sales\.a: referencedBy says fk_b_a of sales\.b otherwise than its own foreign keys do/,
    )
    expect(() => snapshot([a(withFacts(true, { referencedBy: [{ ...inboundToA, enforced: false }] })), b(withFacts(true))])).toThrow(/otherwise than its own foreign keys do/)
    const agreed = snapshot([a(withFacts(true, { referencedBy: [inboundToA] })), b(withFacts(false))])
    expect(agreed.objects.map((object) => [object.ref.name, object.access, object.referencedBy])).toEqual([
      ['a', { delete: true }, [inboundToA]],
      ['b', { delete: false }, []],
    ])
  })

  // A key from a schema outside the scope has no object in the snapshot to
  // agree with: it is named, and that is all. Sorted by codepoint, as every
  // other list, so two reads of one catalog hash alike.
  test('a key from a table outside the snapshot is accepted, and referencedBy sorts by table and name in codepoint order', () => {
    const outside = (schema: string, name: string, key: string) => ({ ...inboundToA, table: { schema, name }, name: key })
    const listed = [outside('audit', 'copy', 'fk_z'), inboundToA, outside('Audit', 'copy', 'fk_a'), outside('audit', 'copy', 'fk_a')]
    const made = snapshot([a(withFacts(true, { referencedBy: listed })), b(withFacts(true))])
    expect(made.objects[0]?.referencedBy?.map((key) => `${key.table.schema}.${key.table.name}.${key.name}`)).toEqual(['Audit.copy.fk_a', 'audit.copy.fk_a', 'audit.copy.fk_z', 'sales.b.fk_b_a'])
    expect(snapshot([a(withFacts(true, { referencedBy: [...listed].reverse() })), b(withFacts(true))]).fingerprint).toBe(made.fingerprint)
    // A key whose target this connection cannot see (0007) refers to nothing it can name, and asks nothing of referencedBy.
    const hidden = { ...toA, name: 'fk_b_hidden', references: null }
    expect(() => snapshot([a(withFacts(true, { referencedBy: [inboundToA] })), b(withFacts(true, { foreignKeys: [toA, hidden] }))])).not.toThrow()
  })

  // What no catalog could have produced, refused naming the object, as a
  // foreign key's own shape is: a key named twice, one with no columns, two
  // sides of different lengths, a column this table does not have, an action
  // outside the five, an enforced flag that is not one.
  test('refuses an inbound key no catalog could have produced', () => {
    const refused = (key: Record<string, unknown>) => () => snapshot([a(withFacts(true, { referencedBy: [key as never] }))])
    const outside = { ...inboundToA, table: { schema: 'audit', name: 'copy' } }
    expect(() => snapshot([a(withFacts(true, { referencedBy: [outside, outside] }))])).toThrow(/sales\.a: referencedBy names fk_b_a of audit\.copy twice/)
    expect(refused({ ...outside, columns: [], referencedColumns: [] })).toThrow(/sales\.a: inbound key fk_b_a of audit\.copy has no columns/)
    expect(refused({ ...outside, columns: ['x', 'y'] })).toThrow(/sales\.a: inbound key fk_b_a of audit\.copy pairs 2 columns with 1/)
    expect(refused({ ...outside, referencedColumns: ['nope'] })).toThrow(/sales\.a: inbound key fk_b_a of audit\.copy refers to nope, which the table does not have/)
    expect(refused({ ...outside, onDelete: 'erase' })).toThrow(/sales\.a: inbound key fk_b_a of audit\.copy has an action that is not one the contract names/)
    expect(refused({ ...outside, onUpdate: undefined })).toThrow(/has an action that is not one the contract names/)
    expect(refused({ ...outside, enforced: 'yes' })).toThrow(/sales\.a: inbound key fk_b_a of audit\.copy has no enforced flag/)
    expect(refused({ ...outside, table: { schema: '', name: 'copy' } })).toThrow(/sales\.a: an inbound key's table is not one the contract names/)
    expect(refused({ ...outside, name: '' })).toThrow(/sales\.a: an inbound key of audit\.copy has no name/)
  })

  // A key from a table outside the snapshot has no foreign key of its own
  // to agree with, so its referring columns are held here or nowhere: a
  // later reach that clears them would name what no table has. Neither
  // engine accepts a referenced column twice (PostgreSQL "foreign key
  // referenced-columns list must not contain duplicates", SQL Server 8136),
  // and neither lets a key refer to a view, materialized or indexed (42809,
  // 1768), measured on postgres:17-alpine (17.11) and 16.0.4295.3,
  // 2026-10-11. PostgreSQL does accept a referring column twice --
  // `foreign key (a, a) references t (x, y)` -- so that is not refused.
  test('refuses an inbound key whose columns are not names, a referenced column twice, and a key onto a view', () => {
    const refused = (key: Record<string, unknown>) => () => snapshot([a(withFacts(true, { referencedBy: [key as never] }))])
    const outside = { ...inboundToA, table: { schema: 'audit', name: 'copy' } }
    expect(refused({ ...outside, columns: [42] })).toThrow(/sales\.a: inbound key fk_b_a of audit\.copy names a column that is not a name/)
    expect(refused({ ...outside, columns: [''] })).toThrow(/names a column that is not a name/)
    expect(refused({ ...outside, columns: [null] })).toThrow(/names a column that is not a name/)
    const wide = table('a', [column('id', 1), column('n', 2)], { primaryKey: { name: 'pk_a', columns: ['id', 'n'] } })
    expect(() => snapshot([{ ...wide, ...withFacts(true, { referencedBy: [{ ...outside, columns: ['x', 'y'], referencedColumns: ['id', 'id'] }] }) }])).toThrow(
      /sales\.a: inbound key fk_b_a of audit\.copy refers to id twice/,
    )
    expect(() => snapshot([{ ...wide, ...withFacts(true, { referencedBy: [{ ...outside, columns: ['x', 'x'], referencedColumns: ['id', 'n'] }] }) }])).not.toThrow()
    const view = table('a', [column('id', 1)], { kind: 'view' })
    expect(() => snapshot([{ ...view, ...withFacts(true, { referencedBy: [outside] }) }])).toThrow(/sales\.a: a view, which no foreign key can refer to, has referencedBy/)
    expect(() => snapshot([{ ...view, ...withFacts(true) }])).not.toThrow()
  })

  // A revoked DELETE grant, and a key that now refers to the table, are
  // changes to what a delete may do, so each moves the fingerprint, or
  // drift's fast path would never look. The gap that says the list may be
  // short is an aspect the contract names.
  test('both facts are in the fingerprint, and a referenced-by gap is one the contract names', () => {
    const outside = { ...inboundToA, table: { schema: 'audit', name: 'copy' } }
    const before = snapshot([a(withFacts(true))])
    expect(snapshot([a(withFacts(false))]).fingerprint).not.toBe(before.fingerprint)
    expect(snapshot([a(withFacts(true, { referencedBy: [outside] }))]).fingerprint).not.toBe(before.fingerprint)
    const gap: CoverageGap = { subject: { kind: 'scope' }, aspect: 'referenced-by', detail: 'a key this account cannot see may refer to any table' }
    expect(snapshot([a(withFacts(true))], { gaps: [gap] }).gaps).toEqual([gap])
  })
})
