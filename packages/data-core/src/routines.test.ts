import { describe, expect, test } from 'vitest'
import type { CoverageGap, DiscoveryScope, MetadataSnapshot, ObjectMeta } from './metadata.js'
import type { RoutineMeta, RoutineParameter } from './routines.js'
import { describeRoutine } from './routines.js'
import { createSnapshot } from './snapshot.js'

const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const INT64 = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const

const OBJECTS: ObjectMeta[] = [
  {
    ref: { schema: 'sales', name: 'order' },
    kind: 'table',
    comment: null,
    columns: [
      {
        name: 'id',
        ordinal: 1,
        databaseType: 'bigint',
        type: INT64,
        nullable: false,
        hasDefault: false,
        defaultExpression: null,
        generated: 'none',
        comment: null,
        access: { select: true, insert: true, update: true },
      },
    ],
    primaryKey: { name: 'pk_order', columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
  },
]

function parameter(name: string, typeId: string, extra: Partial<RoutineParameter> = {}): RoutineParameter {
  return { name, mode: 'in', databaseType: typeId === '20' ? 'bigint' : 'integer', typeId, type: typeId === '20' ? INT64 : INT32, hasDefault: false, ...extra }
}

/** The fixture's ship_order as PostgreSQL records it: a function returning void, executable, as its account. */
function routine(name = 'ship_order', extra: Partial<RoutineMeta> = {}): RoutineMeta {
  return {
    ref: { schema: 'sales', name, signature: 'pg_catalog.int8, pg_catalog.int4' },
    kind: 'function',
    parameters: [parameter('order_id', '20'), parameter('tenant', '23')],
    effects: 'writes',
    returns: 'void',
    result: null,
    reach: 'account',
    executable: true,
    ...extra,
  }
}

const ASKED: DiscoveryScope = { schemas: ['sales'], routines: true }

function snapshot(routines: unknown, extra: Partial<Omit<MetadataSnapshot, 'fingerprint'>> = {}): MetadataSnapshot {
  return createSnapshot({
    kind: 'postgres',
    serverVersion: '17.6',
    account: { user: 'owner', login: 'owner' },
    scope: ASKED,
    objects: OBJECTS,
    gaps: [],
    routines: routines as RoutineMeta[],
    ...extra,
  })
}

describe('routines in a snapshot (0158)', () => {
  // Read only when the scope asks, and present exactly then: a list without
  // the ask is a snapshot no adapter made, and an ask without a list is an
  // adapter that never looked, dressed as one that found none. An empty
  // list is an answer -- asked, and none in scope -- so it hashes otherwise
  // than a snapshot that did not ask, and the scope says it asked.
  test('routines are present exactly when the scope asks for them, and an empty list is an answer', () => {
    const empty = snapshot([])
    expect(empty.routines).toEqual([])
    expect(empty.scope).toEqual({ schemas: ['sales'], routines: true })
    const unasked = snapshot(undefined, { scope: { schemas: ['sales'] } })
    expect(unasked).not.toHaveProperty('routines')
    expect(unasked.scope).toEqual({ schemas: ['sales'] })
    expect(empty.fingerprint).not.toBe(unasked.fingerprint)
    expect(() => snapshot(undefined)).toThrow(/the scope asks for routines and the snapshot has no list of them/)
    expect(() => snapshot([routine()], { scope: { schemas: ['sales'] } })).toThrow(/the snapshot records routines its scope did not ask for/)
    expect(() => snapshot([], { scope: { schemas: ['sales'], routines: false as never } })).toThrow(
      /the scope asks for routines as false, which is neither true nor absent/,
    )
  })

  // A routines gap is a fact about routines, and only a snapshot whose scope
  // asked has any. One in a snapshot that did not ask is no adapter's -- and
  // since a server older than 0158 refuses the aspect, it would carry that
  // record's rollback cost to a snapshot that never asked for routines,
  // which is the bound the record names.
  test('a routines gap in a snapshot whose scope did not ask for routines is refused', () => {
    const hidden: CoverageGap = { subject: { kind: 'schema', schema: 'sales' }, aspect: 'routines', detail: 'a routine may be hidden' }
    expect(() => snapshot(undefined, { scope: { schemas: ['sales'] }, gaps: [hidden] })).toThrow(
      /the snapshot has a routines gap and its scope did not ask for routines/,
    )
    expect(snapshot([], { gaps: [hidden] }).gaps).toEqual([hidden])
    const elsewhere: CoverageGap = { ...hidden, aspect: 'objects' }
    expect(snapshot(undefined, { scope: { schemas: ['sales'] }, gaps: [elsewhere] }).gaps).toEqual([elsewhere])
  })

  // Two reads of one catalog list routines in whatever order the engine
  // returns them; sorted by codepoint, they hash alike. A parameter's
  // position is what a call passes it by, so the order a routine declares
  // them is kept, and two swapped are a change.
  test('routines sort by schema, name and signature in codepoint order, and parameters keep their order', () => {
    const overload = routine('ship_order', {
      ref: { schema: 'sales', name: 'ship_order', signature: 'pg_catalog.int8' },
      parameters: [parameter('order_id', '20')],
    })
    const made = snapshot([routine('Ship'), overload, routine(), routine('audit', { ref: { schema: 'Audit', name: 'audit', signature: '' } })])
    expect(made.routines?.map((entry) => describeRoutine(entry.ref))).toEqual([
      'Audit.audit()',
      'sales.Ship(pg_catalog.int8, pg_catalog.int4)',
      'sales.ship_order(pg_catalog.int8)',
      'sales.ship_order(pg_catalog.int8, pg_catalog.int4)',
    ])
    expect(snapshot([...(made.routines ?? [])].reverse()).fingerprint).toBe(made.fingerprint)
    const swapped = routine('ship_order', { parameters: [parameter('tenant', '23'), parameter('order_id', '20')] })
    expect(snapshot([swapped]).routines?.[0]?.parameters.map((entry) => entry.name)).toEqual(['tenant', 'order_id'])
    expect(snapshot([swapped]).fingerprint).not.toBe(snapshot([routine()]).fingerprint)
  })

  // Everything recorded of a routine is what drift will compare (0010): an
  // EXECUTE revoked, a parameter retyped -- varchar became text, which
  // pg_proc keeps no length for, so only its type's identity tells -- a
  // routine turned SECURITY DEFINER. Each moves the fingerprint, or drift's
  // fast path would never look. A routine gap is an aspect the contract names.
  test('what a routine records is in the fingerprint, and a routines gap is one the contract names', () => {
    const before = snapshot([routine()])
    expect(snapshot([routine('ship_order', { executable: false })]).fingerprint).not.toBe(before.fingerprint)
    expect(snapshot([routine('ship_order', { reach: 'owner' })]).fingerprint).not.toBe(before.fingerprint)
    const retyped = routine('ship_order', { parameters: [parameter('order_id', '20'), parameter('tenant', '1043', { databaseType: 'character varying' })] })
    expect(snapshot([retyped]).fingerprint).not.toBe(before.fingerprint)
    const defaulted = routine('ship_order', { parameters: [parameter('order_id', '20'), parameter('tenant', '23', { hasDefault: true })] })
    expect(snapshot([defaulted]).fingerprint).not.toBe(before.fingerprint)
    const gap: CoverageGap = {
      subject: { kind: 'schema', schema: 'sales' },
      aspect: 'routines',
      detail: 'a routine this account holds nothing on is not listed',
    }
    expect(snapshot([routine()], { gaps: [gap] }).gaps).toEqual([gap])
    expect(snapshot([routine()], { gaps: [gap] }).fingerprint).not.toBe(before.fingerprint)
  })

  // Whether the engine calls a routine given a NULL (0167) is recorded
  // where discovery read it, and a snapshot that does not say -- every one
  // taken before 0167, which every published bundle's is -- hashes to the
  // fingerprint it was published with: the literal is what data-core at
  // 7343512, the release before 0167, gave this snapshot. Read, the fact is
  // in the fingerprint, so drift's fast path looks when it changes.
  // Watched failing on 2026-11-19 with an absent fact recorded as
  // `called`: the literal moved, and the routine carried a fact nobody
  // read.
  test('whether a routine is called given a NULL is recorded where read, and a snapshot that does not say hashes as before 0167', () => {
    const before = snapshot([routine()])
    expect(before.fingerprint).toBe('d5fc427702a3363c1e94eae696a1b3ac3d4b675801428c34852dd27058c859e0')
    expect(before.routines?.[0]).not.toHaveProperty('onNull')
    const called = snapshot([routine('ship_order', { onNull: 'called' })])
    expect(called.routines?.[0]?.onNull).toBe('called')
    expect(called.fingerprint).not.toBe(before.fingerprint)
    expect(snapshot([routine('ship_order', { onNull: 'not-called' })]).fingerprint).not.toBe(called.fingerprint)
  })

  // Absent is "not read"; present, the fact is one of two. A null or a key
  // set to undefined is a third spelling no adapter writes, and would hash
  // otherwise than absence. Neither engine lets a procedure be declared
  // anything but called. Watched failing on 2026-11-19 with the ON_NULL
  // check taken out: each value was accepted; and with the procedure check
  // taken out.
  test('refuses whether a routine is called given a NULL as anything but the two, and a procedure not called', () => {
    const refused = (extra: Record<string, unknown>) => () => snapshot([{ ...routine(), ...extra }])
    expect(refused({ onNull: 'sometimes' })).toThrow(/sales\.ship_order\(.*\): onNull "sometimes" is not one the contract names/)
    expect(refused({ onNull: null })).toThrow(/onNull null is not one the contract names/)
    expect(refused({ onNull: undefined })).toThrow(/onNull undefined is not one the contract names/)
    expect(refused({ onNull: true })).toThrow(/onNull true is not one the contract names/)
    expect(refused({ kind: 'procedure', onNull: 'not-called' })).toThrow(/sales\.ship_order\(.*\): a procedure is called whatever its arguments/)
    expect(snapshot([routine('ship_order', { kind: 'procedure', onNull: 'called' })]).routines?.[0]?.onNull).toBe('called')
  })

  // What no catalog could have produced, refused naming the routine, as an
  // object's own shape is. A value outside a closed list, a scalar that
  // names no result or a void that names one, a parameter with no type
  // identity -- which is all an adapter may spell a cast from -- and SQL
  // Server, which has no overloads, with a signature.
  test('refuses a routine no catalog could have produced', () => {
    const refused = (extra: Record<string, unknown>) => () => snapshot([{ ...routine(), ...extra }])
    expect(() => snapshot([routine(), routine()])).toThrow(/sales\.ship_order\(pg_catalog\.int8, pg_catalog\.int4\) is reported twice/)
    expect(refused({ ref: { schema: '', name: 'x', signature: '' } })).toThrow(/a routine's ref is not one the contract names/)
    expect(refused({ ref: { schema: 'sales', name: 'x' } })).toThrow(/a routine's ref is not one the contract names/)
    expect(refused({ ref: undefined })).toThrow(/a routine's ref is not one the contract names: none/)
    expect(refused({ kind: 'aggregate' })).toThrow(/sales\.ship_order\(.*\): kind "aggregate" is not one the contract names/)
    expect(refused({ effects: 'maybe' })).toThrow(/effects "maybe" is not one the contract names/)
    expect(refused({ returns: 'table' })).toThrow(/returns "table" is not one the contract names/)
    expect(refused({ reach: 'definer' })).toThrow(/reach "definer" is not one the contract names/)
    expect(refused({ executable: 'yes' })).toThrow(/executable is not a boolean/)
    expect(refused({ returns: 'scalar' })).toThrow(/sales\.ship_order\(.*\): its result is not a type/)
    expect(refused({ result: { databaseType: 'integer', typeId: '23', type: INT32 } })).toThrow(/returns void and names a result/)
    expect(refused({ returns: 'set', result: { databaseType: 'integer', typeId: '23', type: INT32 } })).toThrow(/returns set and names a result/)
    expect(refused({ parameters: {} })).toThrow(/parameters is not a list/)
    expect(refused({ parameters: [parameter('a', '23', { typeId: '' })] })).toThrow(/parameter 1 has no type id/)
    expect(refused({ parameters: [parameter('a', '23', { mode: 'output' as never })] })).toThrow(
      /parameter 1 has a mode "output" that is not one the contract names/,
    )
    expect(refused({ parameters: [parameter('a', '23', { name: null as never })] })).toThrow(/parameter 1 has a name that is not a string/)
    expect(refused({ parameters: [parameter('a', '23', { hasDefault: undefined as never })] })).toThrow(
      /parameter 1 has a default that is neither a boolean nor null/,
    )
    expect(refused({ parameters: [parameter('a', '23', { hasDefault: 'yes' as never })] })).toThrow(
      /parameter 1 has a default that is neither a boolean nor null/,
    )
    expect(refused({ parameters: [parameter('a', '23', { databaseType: undefined as never })] })).toThrow(/parameter 1 has no database type/)
    expect(refused({ parameters: [parameter('a', '23', { type: { kind: 'json' } as never })] })).toThrow(
      /parameter 1 has a type that is not one the contract names/,
    )
    const unitless = { kind: 'text', maxLength: null, fixedLength: false } as never
    expect(refused({ parameters: [parameter('a', '25', { type: unitless })] })).toThrow(/parameter 1 is text with no length unit/)
    expect(refused({ parameters: ['a'] })).toThrow(/parameter 1 is not a type/)
    expect(() => snapshot([{ ...routine(), ref: { schema: 'sales', name: 'ship_order', signature: 'int' } }], { kind: 'sqlserver' })).toThrow(
      /SQL Server has no overloads, so a routine's signature is empty/,
    )
    // A parameter declared without a name is one PostgreSQL has, and the
    // generator's to refuse (0158): recorded, never dropped. A default SQL
    // Server's catalog does not keep is `null`, an answer of its own.
    expect(snapshot([routine('ship_order', { parameters: [parameter('', '23')] })]).routines?.[0]?.parameters[0]?.name).toBe('')
    expect(snapshot([routine('ship_order', { parameters: [parameter('a', '23', { hasDefault: null })] })]).routines?.[0]?.parameters[0]?.hasDefault).toBeNull()
  })
})
