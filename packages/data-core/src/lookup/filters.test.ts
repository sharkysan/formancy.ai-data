import { describe, expect, test } from 'vitest'
import type { ColumnMeta, NormalizedType, ObjectMeta } from '../metadata.js'
import { rowFilterColumnProblem, rowFilterTerms, scopeRowFilters } from './filters.js'
import type { RowFilterType, RowFilters } from './types.js'

/** What a caller outside the type system can hand an adapter: a policy read from JSON, or JavaScript. */
const untyped = (value: unknown): RowFilters => value as RowFilters

const INT32: RowFilterType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const CODE: RowFilterType = { kind: 'text', maxLength: 10, lengthUnit: 'utf16-code-units', fixedLength: false }
const FIXED: RowFilterType = { kind: 'text', maxLength: 3, lengthUnit: 'code-points', fixedLength: true }
const UUID: RowFilterType = { kind: 'uuid' }

const restricted = (...equal: unknown[]): RowFilters => untyped({ kind: 'restricted', equal })

function col(name: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, ordinal: 1, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra }
}

/** A tenant's items: a key kind of every sort a filter can compare, and three it cannot. */
const ITEM: ObjectMeta = {
  ref: { schema: 'parity', name: 'tenant_item' },
  kind: 'table',
  comment: null,
  columns: [
    col('tenant_id', INT32),
    col('tenant_code', CODE),
    col('fixed_code', FIXED, { databaseType: 'character' }),
    col('owner', UUID),
    col('active', { kind: 'boolean' }),
    col('weight', { kind: 'float', bits: 64 }, { databaseType: 'double precision' }),
    col('changed_at', { kind: 'timestamp', withTimeZone: true, precision: 6 }, { databaseType: 'timestamp with time zone' }),
    col('secret', INT32, { access: { select: false, insert: true, update: true } }),
  ],
  primaryKey: null,
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
}

describe('rowFilterTerms', () => {
  // An empty list used to mean "this actor sees every row", and an empty list
  // is exactly what `policy?.filters ?? []` produces when there is no policy:
  // the fail-open default. Seeing everything is now a value somebody has to
  // write, and every way of saying nothing — the old empty list, an empty
  // restriction, no filters at all — is refused before a query is built.
  test('reads no restriction only from an explicit unrestricted, and refuses every way of saying nothing', () => {
    expect(rowFilterTerms({ kind: 'unrestricted' })).toEqual([])
    for (const nothing of [[], { kind: 'restricted', equal: [] }, { kind: 'restricted' }, {}, undefined, null, 'unrestricted']) {
      expect(() => rowFilterTerms(untyped(nothing)), JSON.stringify(nothing) ?? 'undefined').toThrow(/at least one equality/)
    }
  })

  // A policy that says both "unrestricted" and "only tenant 7" contradicts
  // itself, and reading either half would be a guess. Refused, so the one
  // that grants more is never the one that won.
  test('refuses filters that carry more than their kind says', () => {
    const term = { column: 'tenant_id', type: INT32, value: '7' }
    expect(() => rowFilterTerms(untyped({ kind: 'unrestricted', equal: [term] }))).toThrow(/at least one equality/)
    expect(() => rowFilterTerms(untyped({ kind: 'restricted', equal: [term], or: [] }))).toThrow(/at least one equality/)
  })

  // The adapter quotes each column, binds each value as its type and compares
  // it exactly (0028). A column that is not a name, or a value that is not
  // text, would reach the query as something nobody checked; and the terms
  // and their types are fresh, so nothing else the filters carried reaches one.
  test('returns each equality as a fresh column, type and text value, and refuses one that is not', () => {
    const filters = restricted({ column: 'tenant_id', type: INT32, value: '7', extra: 'dropped' }, { column: 'region', type: CODE, value: '' })
    const terms = rowFilterTerms(filters)
    expect(terms).toEqual([
      { column: 'tenant_id', type: INT32, value: '7' },
      { column: 'region', type: CODE, value: '' },
    ])
    if (filters.kind !== 'restricted') throw new Error('restricted above')
    expect(terms[0]).not.toBe(filters.equal[0])
    expect(terms[0]?.type).not.toBe(filters.equal[0].type)

    for (const entry of [{ column: '', type: INT32, value: '7' }, { column: 'tenant_id', type: INT32, value: 7 }, { column: 'tenant_id', type: INT32 }, null, 'tenant_id=7']) {
      expect(() => rowFilterTerms(restricted(entry)), JSON.stringify(entry)).toThrow(/a column name and a text value/)
    }
  })

  // A term without its column's type leaves the engine to convert the value:
  // PostgreSQL's `unknown` parameter compared under the column's collation and
  // let `ACME` through for `acme` (C3c), and a boolean once inverted there. A
  // kind outside the settled ones, or a type no snapshot could hold, is
  // refused before anything is bound.
  test('refuses a term with no type, a kind a filter cannot compare, or a malformed type', () => {
    const types: unknown[] = [
      undefined,
      null,
      'integer',
      { kind: 'boolean' },
      { kind: 'float', bits: 64 },
      { kind: 'timestamp', withTimeZone: true, precision: 6 },
      { kind: 'time', precision: null },
      { kind: 'text', maxLength: 10, fixedLength: false },
      { kind: 'text', maxLength: 10, lengthUnit: 'bytes', fixedLength: false },
      { kind: 'text', maxLength: -1, lengthUnit: 'code-points', fixedLength: false },
      { kind: 'text', maxLength: 1.5, lengthUnit: 'code-points', fixedLength: false },
      { kind: 'text', maxLength: 10, lengthUnit: 'code-points', fixedLength: 'no' },
      { kind: 'integer', min: -1, max: '1' },
      { kind: 'integer', min: '-1', max: '1e3' },
      { kind: 'decimal', precision: '14', scale: 2 },
      { kind: 'decimal', precision: 14, scale: 0.5 },
    ]
    for (const type of types) {
      expect(() => rowFilterTerms(restricted({ column: 'c', type, value: '1' })), JSON.stringify(type) ?? 'undefined').toThrow(/its column's type/)
    }
    // Every shape the contract does name passes, and comes back without anything it did not.
    for (const type of [INT32, CODE, FIXED, UUID, { kind: 'date' }, { kind: 'decimal', precision: null, scale: null }, { kind: 'text', maxLength: null, lengthUnit: 'code-page-bytes', fixedLength: false }]) {
      const value = type.kind === 'uuid' ? '0f8fad5b-d9cb-469f-a165-70867728950e' : type.kind === 'date' ? '2026-10-09' : '1'
      expect(rowFilterTerms(restricted({ column: 'c', type: { ...type, extra: true }, value }))[0]?.type, type.kind).toEqual(type)
    }
  })

  // A value its type refuses is one each engine would convert its own way:
  // '042' is 42 to both, 'AB ' matches 'AB' in char(3) on both and in nothing
  // as exact text, an upper-case uuid is a spelling no row reads back as, and
  // an unpaired surrogate reaches PostgreSQL as U+FFFD and SQL Server as itself.
  test("refuses a value its column's type does not hold in that spelling", () => {
    for (const [type, value] of [[INT32, '042'], [INT32, 'acme'], [FIXED, 'AB '], [UUID, '0F8FAD5B-D9CB-469F-A165-70867728950E'], [CODE, 'x'.repeat(11)], [CODE, 'x\uD800']] as const) {
      expect(() => rowFilterTerms(restricted({ column: 'c', type, value })), value).toThrow(/not spelled as its column holds it/)
    }
  })
})

describe('rowFilterColumnProblem', () => {
  // The publish check, the studio and the planner ask this one function, so
  // a column one of them offers is never one another refuses.
  test('names an absent column, one the account may not read, and a kind a filter cannot compare', () => {
    expect(rowFilterColumnProblem(ITEM, 'tenant_code')).toBeNull()
    expect(rowFilterColumnProblem(ITEM, 'fixed_code')).toBeNull()
    expect(rowFilterColumnProblem(ITEM, 'nope')).toBe('tenant_item has no column nope')
    expect(rowFilterColumnProblem(ITEM, 'secret')).toBe("secret is a column this connection's account may not read")
    expect(rowFilterColumnProblem(ITEM, 'active')).toMatch(/^active is boolean, which a row filter cannot compare/)
    expect(rowFilterColumnProblem(ITEM, 'weight')).toMatch(/^weight is double precision, which a row filter cannot compare/)
    expect(rowFilterColumnProblem(ITEM, 'changed_at')).toMatch(/^changed_at is timestamp with time zone, which a row filter cannot compare/)
  })
})

describe('scopeRowFilters', () => {
  // A lookup's filter and a record request's filter are scoped by this one
  // function, so a lookup can no longer list rows a record request refuses:
  // the lookup route used to pass the policy's text through untyped.
  test("types each term from the object's column, and keeps [] the only spelling of unrestricted", () => {
    expect(scopeRowFilters(ITEM, [{ column: 'tenant_code', value: 'acme' }, { column: 'tenant_id', value: '7' }], 'lookups.item')).toEqual({
      ok: true,
      filters: {
        kind: 'restricted',
        equal: [
          { column: 'tenant_code', type: CODE, value: 'acme' },
          { column: 'tenant_id', type: INT32, value: '7' },
        ],
      },
    })
    expect(scopeRowFilters(ITEM, [], 'lookups.item')).toEqual({ ok: true, filters: { kind: 'unrestricted' } })
  })

  // Each is a policy that cannot be applied the same way on both engines, or
  // at all by this connection: refused as the policy's fault, naming where.
  test('refuses an absent, unreadable or uncomparable column as invalid-policy', () => {
    for (const column of ['nope', 'secret', 'active', 'changed_at', 'weight']) {
      expect(scopeRowFilters(ITEM, [{ column, value: '1' }], 'rowFilters'), column).toMatchObject({ ok: false, code: 'invalid-policy', message: expect.stringMatching(/^rowFilters: /) as unknown as string })
    }
  })

  // The trusted value is the host's: one not spelled as the column holds it
  // is a deployment problem, and never something an engine converts — nor
  // text the two drivers would send as two different strings.
  test('refuses a misspelled trusted value as invalid-context', () => {
    for (const [column, value] of [['tenant_id', '042'], ['fixed_code', 'AB '], ['owner', '0F8FAD5B-D9CB-469F-A165-70867728950E'], ['tenant_code', 'x\uD800']] as const) {
      expect(scopeRowFilters(ITEM, [{ column, value }], 'lookups.item'), value).toMatchObject({ ok: false, code: 'invalid-context' })
    }
  })
})
