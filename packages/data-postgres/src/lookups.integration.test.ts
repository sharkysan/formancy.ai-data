import { buildLookupConfig, encodeKeyToken, generateForm } from '@formancy/data-core'
import type { LookupConfig, LookupOptions, LookupQuery, MetadataSnapshot, ObjectRef, RowFilters } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { covers, EDGE_VALUES, edgeCase, startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresLookups, discoverPostgres } from './index.js'

/**
 * The lookup half of the operations port against REAL PostgreSQL, loaded with
 * the shared fixture (0005), as its owner and as the restricted reader.
 *
 * Every config is built the way a deployment builds one: discovery, then the
 * generator, then `buildLookupConfig`, so each identifier the adapter quotes
 * came from the catalog. The rows this file adds to `sales.customer` are data,
 * not structure; the shapes the fixture does not have live in schema `lk`.
 */
let fixture: PostgresFixture
let owner: Sql
let reader: Sql
let sales: MetadataSnapshot
let lk: MetadataSnapshot

/** sales.customer's and lk.contact's tenant_id, an integer, as the snapshot types it and `scopeRowFilters` would. */
const TENANT_ID = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const TENANT_1: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: TENANT_ID, value: '1' }] }
const TENANT_2: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: TENANT_ID, value: '2' }] }
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }
const FIRST_PAGE: LookupQuery = { search: '', offset: 0, limit: 50 }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  reader = postgres(fixture.reader, { onnotice: () => {} })

  // Names that hold LIKE's wildcards literally, and their near misses, which
  // a pattern that let the wildcard through would also match.
  await owner.unsafe(`
    insert into sales.customer (tenant_id, customer_no, name, country_code) values
      (1, 1002, '100% Bio', null),
      (1, 1003, '100 Prozent', 'DE'),
      (1, 1004, 'snake_case AG', 'CH'),
      (1, 1005, 'snakeXcase AG', null),
      (1, 1006, '[Klammer] AG', 'DE'),
      (1, 1007, 'Über AG', 'CH'),
      (2, 1002, '100% Fremd', 'DE');

    create schema lk;
    -- A unique key over a nullable column: a row whose key is NULL exists,
    -- and no foreign key value can reference it.
    create table lk.code_item (code varchar(10) constraint uq_code_item unique, label text not null);
    create table lk.code_use (id integer primary key, code varchar(10) constraint fk_code_use_item references lk.code_item (code));
    insert into lk.code_item values ('A1', 'Alpha'), (null, 'Nobody'), ('B2', 'Beta');

    -- A key no token can carry: forty u-umlauts escape to two hundred characters.
    create table lk.long_key (code varchar(100) primary key, label text not null);
    create table lk.long_use (id integer primary key, code varchar(100) constraint fk_long_use_key references lk.long_key (code));
    insert into lk.long_key values (repeat('ü', 40), 'Too long to reference'), ('short', 'Short enough');

    -- Equality that is not string equality, two ways: a case-insensitive
    -- collation, and blank-padded char(n), which ignores trailing spaces.
    create collation lk.ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
    create table lk.ci_code (code text collate lk.ci primary key, name text not null);
    create table lk.ci_use (id integer primary key, code text collate lk.ci constraint fk_ci_use_code references lk.ci_code (code));
    insert into lk.ci_code values ('ACME', 'Acme Corporation');
    create table lk.fixed (code char(3) primary key, name text not null);
    create table lk.fixed_use (id integer primary key, code char(3) constraint fk_fixed_use_code references lk.fixed (code));
    insert into lk.fixed values ('AB', 'Padded to three');

    -- A filter on a boolean column, and a key that is a date.
    create table lk.flagged (id integer primary key, name text not null, active boolean not null);
    create table lk.flagged_use (id integer primary key, flagged_id integer constraint fk_flagged_use_flagged references lk.flagged (id));
    insert into lk.flagged values (1, 'Switched on', true), (2, 'Switched off', false);
    create table lk.day (day date primary key, name text not null);
    create table lk.day_use (id integer primary key, day date constraint fk_day_use_day references lk.day (day));
    insert into lk.day values ('2026-10-08', 'The order date'), ('0001-01-01', 'The first day');

    -- A tenant's contacts, on a table with a domain that refuses NULL.
    create domain lk.email as text not null;
    create table lk.contact (tenant_id integer not null, contact_no integer not null, name text not null, email lk.email, primary key (tenant_id, contact_no));
    create table lk.contact_use (id integer primary key, tenant_id integer, contact_no integer,
      constraint fk_contact_use_contact foreign key (tenant_id, contact_no) references lk.contact (tenant_id, contact_no));
    insert into lk.contact values (1, 1, 'Ours', 'ours@example.com'), (2, 1, 'Theirs', 'theirs@example.com');
  `)
  ;[sales, lk] = await Promise.all([discoverPostgres(owner, { schemas: ['sales'] }), discoverPostgres(owner, { schemas: ['lk'] })])
})

afterAll(async () => {
  await Promise.all([owner?.end(), reader?.end()])
  await fixture?.stop()
})

/** A lookup config as a deployment builds one: discovered, generated, then derived. */
function lookupOver(snapshot: MetadataSnapshot, root: ObjectRef, foreignKey: string, display: string[], options: Omit<LookupOptions, 'snapshot'> = {}): LookupConfig {
  const { bindings } = generateForm(snapshot, { connection: 'test', root, formId: 'lookup-test', title: 'Lookup test', lookups: [{ foreignKey, display }] })
  const field = bindings.fields.find((candidate) => candidate.kind === 'lookup' && candidate.foreignKey === foreignKey)
  if (field === undefined) throw new Error(`the generator made no lookup for ${foreignKey}`)
  return buildLookupConfig(bindings, field.field, { snapshot, ...options })
}

function tokenOf(...key: string[]): string {
  const encoded = encodeKeyToken(key)
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

const ORDER: ObjectRef = { schema: 'sales', name: 'order' }
const customers = (options: Omit<LookupOptions, 'snapshot'> = {}): LookupConfig => lookupOver(sales, ORDER, 'fk_order_customer', ['name'], options)
/** Ordered by key, so an expectation does not depend on how this image's collation orders text. */
const customersByKey = (): LookupConfig => customers({ sort: [{ column: 'tenant_id', direction: 'asc' }] })

describe('a composite-key lookup over sales.customer, filtered by tenant', () => {
  // The leak the whole port exists to prevent: a select that offers another
  // tenant's customers, so one of them is saved into this tenant's order.
  test("offers only the tenant's own customers", async () => {
    const page = await createPostgresLookups(owner).search(customersByKey(), FIRST_PAGE, TENANT_1)
    expect(page).toEqual({
      rows: [
        { token: tokenOf('1', '1001'), label: 'Muster AG' },
        { token: tokenOf('1', '1002'), label: '100% Bio' },
        { token: tokenOf('1', '1003'), label: '100 Prozent' },
        { token: tokenOf('1', '1004'), label: 'snake_case AG' },
        { token: tokenOf('1', '1005'), label: 'snakeXcase AG' },
        { token: tokenOf('1', '1006'), label: '[Klammer] AG' },
        { token: tokenOf('1', '1007'), label: 'Über AG' },
      ],
      hasMore: false,
      omitted: 0,
    })
  })

  // A token is a reference, not a permission (0012): tenant 2's customer
  // 1001 exists, and a browser can spell its token, so membership has to be
  // decided under the actor's filters, in the same query.
  test("rejects another tenant's token for a customer that exists, and resolves only its own", async () => {
    const lookups = createPostgresLookups(owner)
    const ours = tokenOf('1', '1001')
    const theirs = tokenOf('2', '1001')
    expect(await lookups.rejects(customers(), [ours, theirs], TENANT_1)).toEqual([theirs])
    expect(await lookups.rejects(customers(), [ours, theirs], TENANT_2)).toEqual([ours])
    expect(await lookups.resolve(customers(), [theirs, ours], TENANT_1)).toEqual([{ token: ours, label: 'Muster AG' }])
  })

  // A filter term parsed by building a row of the table's type from NULL
  // runs every other column through its input function as NULL, so a
  // domain can check it. A NOT NULL domain on a column the lookup never
  // reads made every filtered search, resolve and membership check throw.
  test('filters a table with a domain that refuses NULL like any other', async () => {
    const config = lookupOver(lk, { schema: 'lk', name: 'contact_use' }, 'fk_contact_use_contact', ['name'])
    const lookups = createPostgresLookups(owner)
    const ours = tokenOf('1', '1')
    const theirs = tokenOf('2', '1')
    expect(await lookups.search(config, FIRST_PAGE, TENANT_1)).toEqual({ rows: [{ token: ours, label: 'Ours' }], hasMore: false, omitted: 0 })
    expect(await lookups.resolve(config, [ours, theirs], TENANT_1)).toEqual([{ token: ours, label: 'Ours' }])
    expect(await lookups.rejects(config, [ours, theirs], TENANT_1)).toEqual([theirs])
  })

  // `unrestricted` has to be written, and when it is, it means every row.
  test('an unrestricted actor is offered every tenant', async () => {
    const page = await createPostgresLookups(owner).search(customersByKey(), { search: '100', offset: 0, limit: 50 }, EVERY_ROW)
    expect(page.rows.map((row) => row.token)).toEqual([tokenOf('1', '1002'), tokenOf('1', '1003'), tokenOf('2', '1002')])
  })

  // An empty restriction is what `policy?.filters ?? []` produces when there
  // is no policy. Read as "no filter", it would offer every tenant's rows.
  test('filters that say nothing are refused before the database is asked', async () => {
    const lookups = createPostgresLookups(owner)
    const nothing = { kind: 'restricted', equal: [] } as unknown as RowFilters
    await expect(lookups.search(customers(), FIRST_PAGE, nothing)).rejects.toThrow(/anything else would read as every row/)
    await expect(lookups.rejects(customers(), [tokenOf('2', '1001')], undefined as unknown as RowFilters)).rejects.toThrow(/every row/)
  })
})

describe('the search', () => {
  // A wildcard that reached LIKE unescaped would make '%' match every name
  // and '_' match any character: 'snakeXcase' for 'snake_case'.
  test("matches '%', '_' and '[' as the characters themselves", async () => {
    const lookups = createPostgresLookups(owner)
    const labels = async (search: string): Promise<string[]> =>
      (await lookups.search(customers(), { search, offset: 0, limit: 50 }, TENANT_1)).rows.map((row) => row.label)
    expect(await labels('%')).toEqual(['100% Bio'])
    expect(await labels('_')).toEqual(['snake_case AG'])
    expect(await labels('e_c')).toEqual(['snake_case AG'])
    expect(await labels('[k')).toEqual(['[Klammer] AG'])
    expect(await labels('!')).toEqual([])
  })

  // A search is a value: bound, never spliced. Spliced, this text would end
  // the string literal and run a statement of its own.
  test('a search holding a quote and SQL is only text', async () => {
    const page = await createPostgresLookups(owner).search(customers(), { search: "'; drop table sales.customer; --", offset: 0, limit: 50 }, TENANT_1)
    expect(page.rows).toEqual([])
    const [count] = await owner<{ n: number }[]>`select count(*)::int as n from sales.customer`
    expect(count?.n).toBe(9)
  })

  // formancy narrows a list by what the person sees (0012), and an
  // administrator may narrow it further. A country code that is displayed but
  // not searched must not match.
  test('matches the configured search columns and no others', async () => {
    const lookups = createPostgresLookups(owner)
    const byName = lookupOver(sales, ORDER, 'fk_order_customer', ['name', 'country_code'], { search: ['name'] })
    const both = lookupOver(sales, ORDER, 'fk_order_customer', ['name', 'country_code'])
    expect(both.search.map((column) => column.name)).toEqual(['name', 'country_code'])
    expect((await lookups.search(byName, { search: 'CH', offset: 0, limit: 50 }, TENANT_1)).rows).toEqual([])
    expect((await lookups.search(both, { search: 'CH', offset: 0, limit: 50 }, TENANT_1)).rows.map((row) => row.label)).toEqual([
      'Muster AG · CH',
      'snake_case AG · CH',
      'Über AG · CH',
    ])
  })

  // How case and accents compare is the engine's, written down in the README:
  // PostgreSQL folds case through the database's default collation and does
  // not fold accents, where formancy's own narrowing folds both.
  test('folds case, through the default collation, and not accents', async () => {
    const lookups = createPostgresLookups(owner)
    const labels = async (search: string): Promise<string[]> =>
      (await lookups.search(customers(), { search, offset: 0, limit: 50 }, TENANT_1)).rows.map((row) => row.label)
    expect(await labels('über')).toEqual(['Über AG'])
    expect(await labels('MUSTER')).toEqual(['Muster AG'])
    expect(await labels('uber')).toEqual([])
  })

  // PostgreSQL 17 refuses LIKE and ILIKE outright on a column with a
  // nondeterministic collation (SQLSTATE 0A000). Searching through the
  // database's default collation is what lets such a column be searched at all.
  test('searches a column whose collation is nondeterministic', async () => {
    const config = lookupOver(lk, { schema: 'lk', name: 'ci_use' }, 'fk_ci_use_code', ['code'])
    const page = await createPostgresLookups(owner).search(config, { search: 'cm', offset: 0, limit: 50 }, EVERY_ROW)
    expect(page.rows).toEqual([{ token: tokenOf('ACME'), label: 'ACME' }])
  })
})

describe('the order and the page', () => {
  // PostgreSQL puts NULLs last in an ascending order and SQL Server first;
  // the config says where they go so both engines give one first page.
  test("follows the config's total order, NULLs where it says", async () => {
    const lookups = createPostgresLookups(owner)
    const byCountry = (nulls: 'first' | 'last'): LookupConfig =>
      lookupOver(sales, ORDER, 'fk_order_customer', ['name', 'country_code'], { sort: [{ column: 'country_code', direction: 'desc', nulls }] })
    const first = await lookups.search(byCountry('first'), FIRST_PAGE, TENANT_1)
    expect(first.rows.map((row) => row.token)).toEqual(
      ['1002', '1005', '1003', '1006', '1001', '1004', '1007'].map((number) => tokenOf('1', number)),
    )
    const last = await lookups.search(byCountry('last'), FIRST_PAGE, TENANT_1)
    expect(last.rows.map((row) => row.token)).toEqual(
      ['1003', '1006', '1001', '1004', '1007', '1002', '1005'].map((number) => tokenOf('1', number)),
    )
  })

  // Characterisation, not a promise: the order of text is the collation's
  // (0012). postgres:17-alpine names its default collation en_US.utf8, but
  // musl has no collation tables, so it orders by code point, exactly like
  // "C": '1' before 'M' before '[' before 's', 'X' before '_', and 'Ü' last.
  // The same database on a glibc image orders these differently. A change
  // in the image fails here, by name, before a conformance case is blamed.
  test("orders text as this image's default collation does, which on Alpine is code point order", async () => {
    const page = await createPostgresLookups(owner).search(customers(), FIRST_PAGE, TENANT_1)
    expect(page.rows.map((row) => row.label)).toEqual(['100 Prozent', '100% Bio', 'Muster AG', '[Klammer] AG', 'snakeXcase AG', 'snake_case AG', 'Über AG'])
  })

  // A config is typed, and a caller in JavaScript or one read from JSON is
  // not held to the type. A direction is spelled from a fixed table, so one
  // that is not asc or desc is refused rather than copied into ORDER BY.
  test('refuses an order it cannot spell, rather than copying it into the SQL', async () => {
    const config = customers()
    const forged = (direction: string, nulls: string) => ({ ...config, sort: [{ column: 'name', direction, nulls }] }) as unknown as LookupConfig
    const lookups = createPostgresLookups(owner)
    await expect(lookups.search(forged('asc; drop table sales.customer; --', 'last'), FIRST_PAGE, TENANT_1)).rejects.toThrow(/no order this adapter can spell/)
    // Every object has a `constructor`; a table kept in an object literal would find one.
    await expect(lookups.search(forged('constructor', 'last'), FIRST_PAGE, TENANT_1)).rejects.toThrow(/no order this adapter can spell/)
    await expect(lookups.search(forged('asc', 'toString'), FIRST_PAGE, TENANT_1)).rejects.toThrow(/no order this adapter can spell/)
  })

  // One extra row says there is more, without a COUNT per keystroke; a page
  // that fetched exactly `limit` could not tell a full page from the last one.
  test('says whether there is more, and pages from the offset', async () => {
    const lookups = createPostgresLookups(owner)
    const one = await lookups.search(customers(), { search: '', offset: 0, limit: 3 }, TENANT_1)
    const two = await lookups.search(customers(), { search: '', offset: 3, limit: 3 }, TENANT_1)
    const three = await lookups.search(customers(), { search: '', offset: 6, limit: 3 }, TENANT_1)
    expect([one.rows.length, two.rows.length, three.rows.length]).toEqual([3, 3, 1])
    expect([one.hasMore, two.hasMore, three.hasMore]).toEqual([true, true, false])
    const all = [...one.rows, ...two.rows, ...three.rows].map((row) => row.token)
    expect(new Set(all).size).toBe(7)
  })

  // No foreign key value can reference a NULL key, so the row is not a
  // choice at all: not offered, and not counted as one that could not be
  // represented either, which would send an operator looking for a long key.
  // Fetched and dropped, it would also take a place on the page, so a page
  // of two would come back with one row and say there is more.
  test('never offers a row whose key holds a NULL, and does not count it', async () => {
    const config = lookupOver(lk, { schema: 'lk', name: 'code_use' }, 'fk_code_use_item', ['label'])
    const lookups = createPostgresLookups(owner)
    expect(await lookups.search(config, FIRST_PAGE, EVERY_ROW)).toEqual({
      rows: [
        { token: tokenOf('A1'), label: 'Alpha' },
        { token: tokenOf('B2'), label: 'Beta' },
      ],
      hasMore: false,
      omitted: 0,
    })
    expect(await lookups.search(config, { search: '', offset: 0, limit: 2 }, EVERY_ROW)).toMatchObject({ hasMore: false, omitted: 0 })
  })

  // A row that silently is not there looks like a table that does not have
  // it. Counted, an operator can tell "not representable" from "not there".
  test('counts a row whose key cannot fit in a token, rather than dropping it silently', async () => {
    const config = lookupOver(lk, { schema: 'lk', name: 'long_use' }, 'fk_long_use_key', ['label'])
    const page = await createPostgresLookups(owner).search(config, FIRST_PAGE, EVERY_ROW)
    expect(page.rows).toEqual([{ token: tokenOf('short'), label: 'Short enough' }])
    expect(page.omitted).toBe(1)
  })
})

describe('membership', () => {
  // Under a case-insensitive collation `IN ('acme')` finds the row stored as
  // ACME, and char(n) ignores trailing spaces. The database says yes to a
  // token the lookup never offered; the re-encoded row says no.
  test('rejects a token spelled differently from the row the database matched', async () => {
    const lookups = createPostgresLookups(owner)
    const ci = lookupOver(lk, { schema: 'lk', name: 'ci_use' }, 'fk_ci_use_code', ['name'])
    expect(await lookups.rejects(ci, [tokenOf('acme'), tokenOf('ACME')], EVERY_ROW)).toEqual([tokenOf('acme')])
    expect(await lookups.resolve(ci, [tokenOf('acme')], EVERY_ROW)).toEqual([])

    const fixed = lookupOver(lk, { schema: 'lk', name: 'fixed_use' }, 'fk_fixed_use_code', ['name'])
    expect(await lookups.rejects(fixed, [tokenOf('AB'), tokenOf('AB ')], EVERY_ROW)).toEqual([tokenOf('AB ')])
    expect(await lookups.resolve(fixed, [tokenOf('AB ')], EVERY_ROW)).toEqual([])
  })

  // The fixture's order id is 2^53 + 1. A key that went through a JavaScript
  // number would be 2^53 and name no row, or the neighbouring one. This one
  // runs as the restricted reader, who may read sales.order.
  test('offers, resolves and accepts a bigint key past 2^53 exactly, as the restricted reader', covers('postgres', edgeCase('beyondSafeInteger'), edgeCase('orderDate')), async () => {
    const config = lookupOver(sales, { schema: 'sales', name: 'order_line' }, 'fk_order_line_order', ['order_date'])
    const lookups = createPostgresLookups(reader)
    const token = tokenOf(EDGE_VALUES.beyondSafeInteger)
    expect(await lookups.search(config, FIRST_PAGE, TENANT_1)).toEqual({ rows: [{ token, label: EDGE_VALUES.orderDate }], hasMore: false, omitted: 0 })
    expect(await lookups.resolve(config, [token], TENANT_1)).toEqual([{ token, label: EDGE_VALUES.orderDate }])
    expect(await lookups.rejects(config, [token, tokenOf('9007199254740992')], TENANT_1)).toEqual([tokenOf('9007199254740992')])
  })

  // formancy refuses a submission when its members port throws (formancy.ai
  // 0022). A reader the database refuses must reach that refusal; an empty
  // answer would accept every token.
  test('throws when the database refuses the account, rather than accepting or rejecting', async () => {
    await expect(createPostgresLookups(reader).rejects(customers(), [tokenOf('1', '1001')], TENANT_1)).rejects.toMatchObject({ code: '42501' })
  })

  // `IN ()` is a syntax error, and a token that cannot name a row needs no
  // query. Proved on a driver that has ended: any query would throw.
  test('asks the database nothing when no token can name a row', async () => {
    const ended = postgres(fixture.admin, { onnotice: () => {} })
    await ended.end()
    const lookups = createPostgresLookups(ended)
    const invented = ['k1:1,abc', 'garbage', tokenOf('1')]
    expect(await lookups.rejects(customers(), invented, TENANT_1)).toEqual(invented)
    expect(await lookups.resolve(customers(), invented, TENANT_1)).toEqual([])
    expect(await lookups.rejects(customers(), [], TENANT_1)).toEqual([])
  })
})

describe('what the composition root configured', () => {
  // A boolean has no spelling both engines compare alike, and postgres.js
  // once bound a filter of 'true' through its boolean serializer, which
  // writes 'f' for anything but the JavaScript `true`, so the filter selected
  // the FALSE rows. A boolean filter is refused (0028): `scopeRowFilters`
  // never makes one, and one that reaches the adapter by hand is thrown
  // before anything is sent — on a driver pointed at nothing, so a statement
  // that was sent would fail as unreachable instead.
  test('a boolean filter throws before anything is sent', async () => {
    const config = lookupOver(lk, { schema: 'lk', name: 'flagged_use' }, 'fk_flagged_use_flagged', ['name'])
    const on = { kind: 'restricted', equal: [{ column: 'active', type: { kind: 'boolean' }, value: 'true' }] } as unknown as RowFilters
    const nowhere = postgres({ host: '127.0.0.1', port: 1, connect_timeout: 1, onnotice: () => {} })
    try {
      const lookups = createPostgresLookups(nowhere)
      await expect(lookups.search(config, FIRST_PAGE, on)).rejects.toThrow(/carries its column's type/)
      await expect(lookups.resolve(config, [tokenOf('1')], on)).rejects.toThrow(/carries its column's type/)
      await expect(lookups.rejects(config, [tokenOf('1')], on)).rejects.toThrow(/carries its column's type/)
    } finally {
      await nowhere.end()
    }
  })

  // The adapter is handed a connected driver, and every one of these is the
  // composition root's to set: column names transformed, values transformed
  // after parsing, numerics parsed as numbers, dates spelled day-first, and a
  // zone with a 45-minute offset. None of them may change an answer.
  test('names, values, parsers, DateStyle and TimeZone do not change an answer', async () => {
    const configured = postgres(fixture.admin, {
      onnotice: () => {},
      transform: { ...postgres.camel, value: { from: (value: unknown) => (typeof value === 'string' ? value.toUpperCase() : value) } },
      types: { numeric: { to: 1700, from: [1700], parse: (raw: string) => Number(raw), serialize: (value: number) => String(value) } },
      connection: { DateStyle: 'SQL, DMY', TimeZone: 'Pacific/Chatham' },
    })
    try {
      const plain = createPostgresLookups(owner)
      const odd = createPostgresLookups(configured)
      expect(await odd.search(customers(), FIRST_PAGE, TENANT_1)).toEqual(await plain.search(customers(), FIRST_PAGE, TENANT_1))
      const days = lookupOver(lk, { schema: 'lk', name: 'day_use' }, 'fk_day_use_day', ['name'])
      const tokens = [tokenOf('2026-10-08'), tokenOf('0001-01-01'), tokenOf('2026-10-09')]
      expect(await odd.resolve(days, tokens, EVERY_ROW)).toEqual([
        { token: tokenOf('2026-10-08'), label: 'The order date' },
        { token: tokenOf('0001-01-01'), label: 'The first day' },
      ])
      expect(await odd.rejects(days, tokens, EVERY_ROW)).toEqual([tokenOf('2026-10-09')])
    } finally {
      await configured.end()
    }
  })
})

describe('objects planted on the search path', () => {
  /**
   * What a role may define with CREATE on `public` and no right on any table
   * — every login role on PostgreSQL 14 and earlier. An unqualified function
   * or operator is resolved through the search path, and an exact match in
   * `public` wins over pg_catalog's candidate when that one needs an
   * implicit cast or is polymorphic. Exact matches, type names and collation
   * names win only when the search path names pg_catalog after public, which
   * is the composition root's to set.
   */
  const PLANTED = `
    create function public.jsonb_populate_record(base sales.customer, fields pg_catalog.jsonb) returns sales.customer language sql
      as $$ select pg_catalog.jsonb_populate_record(base, '{"tenant_id": "2"}') $$;
    create function public.to_jsonb(pg_catalog.text) returns pg_catalog.jsonb language sql as $$ select '"PLANTED"'::pg_catalog.jsonb $$;
    create function public.planted_true(pg_catalog.text, pg_catalog.text) returns boolean language sql immutable as 'select true';
    create operator public.~~* (leftarg = pg_catalog.text, rightarg = pg_catalog.text, function = public.planted_true);
    create function public.planted_equal(integer, integer) returns boolean language sql immutable as 'select true';
    create operator public.= (leftarg = integer, rightarg = integer, function = public.planted_equal);
    create collation public."default" (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
    create domain public.text as pg_catalog.text check (false);`

  // A shadowed jsonb_populate_record offered another tenant's customers
  // through the tenant filter, and a shadowed to_jsonb wrote every label.
  // With pg_catalog last, the planted `=`, ILIKE, collation and text type
  // were the ones the SQL named. Each name is qualified now, so neither path
  // changes an answer.
  test('change no answer, whether pg_catalog is searched first or last', async () => {
    const ours = tokenOf('1', '1001')
    const theirs = tokenOf('2', '1001')
    const muster: LookupQuery = { search: 'muster', offset: 0, limit: 50 }
    const ask = async (driver: Sql) => {
      const lookups = createPostgresLookups(driver)
      return {
        page: await lookups.search(customersByKey(), FIRST_PAGE, TENANT_1),
        found: await lookups.search(customersByKey(), muster, TENANT_1),
        resolved: await lookups.resolve(customers(), [ours, theirs], TENANT_1),
        rejected: await lookups.rejects(customers(), [ours, theirs], TENANT_1),
      }
    }
    const expected = await ask(owner)
    expect(expected.found.rows).toEqual([{ token: ours, label: 'Muster AG' }])
    expect(expected.rejected).toEqual([theirs])

    await owner.begin(async (tx) => {
      await tx.unsafe('create role planter; grant create on schema public to planter; grant usage on schema sales to planter')
      await tx.unsafe(`set local role planter; ${PLANTED}`)
    })
    // Fresh drivers: a statement prepared before the planting keeps the
    // names it resolved then, and would pass for the wrong reason.
    const catalogFirst = postgres(fixture.admin, { onnotice: () => {} })
    const catalogLast = postgres(fixture.admin, { onnotice: () => {}, connection: { search_path: 'public, pg_catalog' } })
    try {
      expect(await ask(catalogFirst)).toEqual(expected)
      expect(await ask(catalogLast)).toEqual(expected)
    } finally {
      await Promise.all([catalogFirst.end(), catalogLast.end()])
      await owner.unsafe('drop owned by planter; drop role planter')
    }
  })
})
