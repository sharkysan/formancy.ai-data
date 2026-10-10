import { canonicalFloat32, codecFor, findObject } from '@formancy/data-core'
import type {
  ApiValue,
  CodecOutcome,
  ColumnMeta,
  MetadataSnapshot,
  RecordColumn,
  RecordFailure,
  RecordOutcome,
  RecordTarget,
  RecordValue,
  RowFilters,
  UpdateRequest,
} from '@formancy/data-core'
import type { PostgresFixture, TcpHop } from '@formancy/data-fixtures'
import { covers, EDGE_VALUES, edgeCase, FIRST_SHIPMENT, SECOND_SHIPMENT, shipmentCase, startPostgresFixture, startTcpHop } from '@formancy/data-fixtures'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/**
 * The record half of the operations port against REAL PostgreSQL, loaded with
 * the shared fixture (0005), as its owner and as the restricted reader.
 *
 * Column types come from discovery, the way a deployment's bindings carry
 * them. Shapes the fixture does not have — every kind side by side, a name
 * with a dot and a quote, a trigger that refuses — live in schema `rec`.
 */
let fixture: PostgresFixture
let owner: Sql
let reader: Sql
let snapshot: MetadataSnapshot

/** sales.order's, sales.customer's and rec.contact's tenant_id, an integer, as `scopeRowFilters` types it. */
const TENANT_1: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, value: '1' }] }
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }
/** 63 bytes: PostgreSQL's longest identifier. One byte more and the server truncates to this. */
const LONGEST = 'x'.repeat(63)

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  reader = postgres(fixture.reader, { onnotice: () => {} })
  await owner.unsafe(`
    create schema rec;
    create table rec.kinds (
      id integer primary key,
      t text, b boolean, i2 smallint, i8 bigint, n numeric(14, 2), c char(3), u uuid,
      d date, tm time, ts timestamptz, tsl timestamp, f8 double precision, f4 real,
      version bigint not null default 1
    );
    create table rec."a.b" (id integer primary key, "say ""hi""" text);
    create table rec.${LONGEST} (id integer primary key, note text);
    insert into rec.${LONGEST} values (1, 'the table a longer name would be truncated to');
    create table rec.guarded (id integer primary key, amount integer not null);
    create function rec.refuse_negative() returns trigger language plpgsql as $$
      begin
        if new.amount < 0 then raise exception 'a negative amount is refused'; end if;
        return new;
      end $$;
    create trigger guarded_refuse before insert or update on rec.guarded for each row execute function rec.refuse_negative();
    create table rec.booking (id integer primary key, room text not null, constraint ex_booking_room exclude using hash (room with =));
    insert into rec.booking values (1, 'Aula');
    create table rec.indexed (id integer primary key, code text constraint uq_indexed_code unique);
    create table rec.defaults (id integer generated always as identity primary key, opened date not null default '2026-10-08', state text not null default 'new');
    create table rec.reals (id integer primary key, f4 real not null);
    insert into rec.reals values (1, '10.0152025'), (2, '0.1'), (3, '3.4028235e38'), (4, '1.17549435e-38'), (5, '7e-45'), (6, '1.26217745e-29'), (7, '805306368'), (8, '0.000244140625');
    -- Domains that refuse NULL, on a table a tenant filter reads: one NOT
    -- NULL, one whose CHECK says so.
    create domain rec.email as text not null;
    create domain rec.code as text check (value is not null and value <> '');
    create table rec.contact (id integer primary key, tenant_id integer not null, name text, email rec.email, code rec.code, version bigint not null default 1);
    insert into rec.contact values (1, 1, 'ours', 'ours@example.com', 'A', 1), (2, 2, 'theirs', 'theirs@example.com', 'B', 1);
    -- Writes the database declines without an error: a BEFORE trigger that
    -- returns NULL, and a rule that does nothing instead.
    create table rec.declined (id integer primary key, note text, version bigint not null default 1);
    insert into rec.declined values (1, 'kept', 1);
    create function rec.decline() returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger declined_decline before insert or update on rec.declined for each row execute function rec.decline();
    create table rec.ruled (id integer primary key, note text);
    create rule ruled_nothing as on insert to rec.ruled do instead nothing;
  `)
  snapshot = await discoverPostgres(owner, { schemas: ['sales', 'rec'] })
})

afterAll(async () => {
  await Promise.all([owner?.end(), reader?.end()])
  await fixture?.stop()
})

function meta(table: string, name: string, schema = ['kinds', 'guarded', 'booking', 'indexed', 'defaults', 'reals', 'contact', 'declined', 'ruled'].includes(table) ? 'rec' : 'sales'): ColumnMeta {
  const found = findObject(snapshot, { schema, name: table })?.columns.find((column) => column.name === name)
  if (found === undefined) throw new Error(`${schema}.${table} has no column ${name}`)
  return found
}

function col(table: string, name: string): RecordColumn {
  const { type } = meta(table, name)
  return { name, type }
}

function val(table: string, name: string, value: ApiValue): RecordValue {
  return { ...col(table, name), value }
}

const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const INT64 = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } as const
const TEXT = { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false } as const
const ORDER_ID: RecordColumn = { name: 'id', type: INT64 }
const ID: RecordColumn = { name: 'id', type: INT32 }
const TENANT_ID: RecordColumn = { name: 'tenant_id', type: INT32 }
const CUSTOMER_NO: RecordColumn = { name: 'customer_no', type: INT32 }

const ORDER = {
  table: { schema: 'sales', name: 'order' },
  identity: [ORDER_ID],
  concurrency: { kind: 'version-column', column: 'row_version' },
} as const satisfies RecordTarget

const CUSTOMER: RecordTarget = { table: { schema: 'sales', name: 'customer' }, identity: [TENANT_ID, CUSTOMER_NO], concurrency: null }

const KINDS = {
  table: { schema: 'rec', name: 'kinds' },
  identity: [ID],
  concurrency: { kind: 'version-column', column: 'version' },
} as const satisfies RecordTarget

const CONTACT = { ...KINDS, table: { schema: 'rec', name: 'contact' } } as const satisfies RecordTarget
const DECLINED = { ...KINDS, table: { schema: 'rec', name: 'declined' } } as const satisfies RecordTarget

const orderKey = (id: string): RecordValue[] => [{ ...ORDER_ID, value: id }]
const customerKey = (tenant: string, number: string): RecordValue[] => [
  { ...TENANT_ID, value: tenant },
  { ...CUSTOMER_NO, value: number },
]
const idKey = (id: string): RecordValue[] => [{ ...ID, value: id }]

const KIND_COLUMNS = ['t', 'b', 'i2', 'i8', 'n', 'c', 'u', 'd', 'tm', 'ts', 'tsl', 'f8', 'f4'] as const

function failed(outcome: RecordOutcome): RecordFailure {
  if (outcome.ok) throw new Error(`expected a failure, got ${JSON.stringify(outcome)}`)
  return outcome
}

function succeeded(outcome: RecordOutcome): Extract<RecordOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.code}: ${outcome.message}`)
  return outcome
}

/** The columns an order cannot be inserted without, with any of them replaced or more added. */
function orderValues(overrides: Record<string, ApiValue> = {}): RecordValue[] {
  return Object.entries({ tenant_id: '1', customer_no: '1001', order_date: '2026-10-09', amount: '1.0000', ...overrides }).map(([name, value]) => val('order', name, value))
}

/** An order of customer 1001, inserted through the adapter; its id and version. */
async function newOrder(notes: string | null = null, tenant = '1'): Promise<{ id: string; version: string }> {
  const outcome = succeeded(await createPostgresRecords(owner).insert({ target: ORDER, values: orderValues({ tenant_id: tenant, notes }), returning: [col('order', 'id')] }))
  return { id: String(outcome.values.id), version: String(outcome.version) }
}

function updateOf(id: string, expectedVersion: string, notes: string, filters: RowFilters = TENANT_1): UpdateRequest {
  return { target: ORDER, key: orderKey(id), set: [val('order', 'notes', notes)], expectedVersion, filters, returning: [col('order', 'notes')] }
}

async function notesOf(id: string): Promise<{ notes: string | null; row_version: string } | undefined> {
  const [row] = await owner<{ notes: string | null; row_version: string }[]>`select notes, row_version::text as row_version from sales."order" where id = ${id}`
  return row
}

describe('reading', () => {
  // The values a driver loses by default: 2^53 + 1, eighteen significant
  // digits, a computed product that is 0.30000000000000004 as a double, and a
  // date with no zone. Each must come back as the exact string it is.
  test('reads every edge value of the fixture back exactly', covers('postgres', edgeCase('beyondSafeInteger'), edgeCase('largestAmount'), edgeCase('orderDate'), edgeCase('largestCreditLimit'), edgeCase('smallestCreditLimit'), edgeCase('computedLineTotal')), async () => {
    const records = createPostgresRecords(owner)
    const order = succeeded(
      await records.read({
        target: ORDER,
        key: orderKey(EDGE_VALUES.beyondSafeInteger),
        columns: [col('order', 'id'), col('order', 'amount'), col('order', 'order_date'), col('order', 'group')],
        filters: TENANT_1,
      }),
    )
    expect(order.values).toEqual({ id: EDGE_VALUES.beyondSafeInteger, amount: EDGE_VALUES.largestAmount, order_date: EDGE_VALUES.orderDate, group: 'A' })

    const limit = async (tenant: string): Promise<ApiValue | undefined> =>
      succeeded(
        await records.read({
          target: CUSTOMER,
          key: customerKey(tenant, '1001'),
          columns: [col('customer', 'credit_limit')],
          filters: EVERY_ROW,
        }),
      ).values.credit_limit
    expect(await limit('1')).toBe(EDGE_VALUES.largestCreditLimit)
    expect(await limit('2')).toBe(EDGE_VALUES.smallestCreditLimit)

    const line = succeeded(
      await records.read({
        target: { table: { schema: 'sales', name: 'order_line' }, identity: [{ ...ORDER_ID, name: 'order_id' }, col('order_line', 'line_no')], concurrency: null },
        key: [
          { ...ORDER_ID, name: 'order_id', value: EDGE_VALUES.beyondSafeInteger },
          val('order_line', 'line_no', '1'),
        ],
        columns: [col('order_line', 'line_total')],
        filters: EVERY_ROW,
      }),
    )
    expect(line.values.line_total).toBe(EDGE_VALUES.computedLineTotal)
  })

  // The contract: a read returns exactly what `codecFor(column).parse` would
  // return for the stored value, so a value read and sent back unchanged is
  // not a change. Written through the adapter, read back, and held to the
  // codec column by column.
  test('reads every kind as the value its codec would return', async () => {
    const records = createPostgresRecords(owner)
    const written: Record<(typeof KIND_COLUMNS)[number], ApiValue> = {
      t: 'plain text',
      b: true,
      i2: '-32768',
      i8: EDGE_VALUES.beyondSafeInteger,
      n: '12.50',
      c: 'AB',
      u: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      d: '0001-01-01',
      tm: '23:59',
      ts: '2026-10-08T12:34:56Z',
      tsl: null,
      // 0.30000000000000004: seventeen significant digits, which a float's
      // text loses as soon as extra_float_digits is turned down.
      f8: 0.1 + 0.2,
      f4: 0.1,
    }
    succeeded(
      await records.insert({
        target: KINDS,
        values: [val('kinds', 'id', '1'), ...KIND_COLUMNS.filter((name) => name !== 'tsl').map((name) => val('kinds', name, written[name]))],
        returning: [],
      }),
    )
    const read = succeeded(await records.read({ target: KINDS, key: idKey('1'), columns: KIND_COLUMNS.map((name) => col('kinds', name)), filters: EVERY_ROW }))
    expect(read.values).toEqual(written)
    expect(read.version).toBe('1')
    for (const name of KIND_COLUMNS.filter((name) => name !== 'tsl')) {
      expect(codecFor(meta('kinds', name)).parse(read.values[name]), name).toEqual({ ok: true, value: read.values[name] })
    }
    // And the other boolean, written through the adapter: false is not NULL and not true.
    succeeded(await records.insert({ target: KINDS, values: [val('kinds', 'id', '8'), val('kinds', 'b', false)], returning: [] }))
    expect(succeeded(await records.read({ target: KINDS, key: idKey('8'), columns: [col('kinds', 'b')], filters: EVERY_ROW })).values).toEqual({ b: false })
  })

  // Values PostgreSQL holds and formancy's shapes cannot. An instant with
  // microseconds -- what now() writes into the fixture's own created_at --
  // and a time with seconds are read cut to the shape, as SQL Server reads
  // them (0040): to the second, in UTC, and to the minute, cut and never
  // rounded, so `.789012` carries into nothing. Read faithfully, as before
  // 0040, neither was a value its field accepts, and a host that sends every
  // field back could not save the record. What no shape can name -- an
  // infinite or BC date or instant, a five-digit year, 24:00, a NaN -- keeps
  // a spelling the codec refuses: cut, it would read as a value it is not;
  // nulled, a save would erase it.
  test('reads an instant to the second and a time to the minute, and what no shape names in a spelling the codec refuses', async () => {
    await owner.unsafe(`
      insert into rec.kinds (id, ts, tm, d, f8, tsl) values (2, '2026-10-08 12:34:56.789012+02', '10:30:59.999999', 'infinity', 'NaN', '2026-10-08 23:59:59');
      insert into rec.kinds (id, ts, d, f4) values (3, '0044-03-15 12:00:00.5+00 BC', '0044-03-15 BC', '-Infinity');
      insert into rec.kinds (id, ts, tm, d) values (4, 'infinity', '24:00:00', '10000-01-01');
      insert into rec.kinds (id, ts, tm) values (9, '9999-12-31 23:59:59.999999+00', '23:59:59.999999')`)
    const records = createPostgresRecords(owner)
    const read = async (id: string): Promise<Record<string, ApiValue>> =>
      succeeded(await records.read({ target: KINDS, key: idKey(id), columns: ['ts', 'tm', 'd', 'f8', 'f4', 'tsl'].map((name) => col('kinds', name)), filters: EVERY_ROW })).values
    expect(await read('2')).toEqual({ ts: '2026-10-08T10:34:56Z', tm: '10:30', d: 'infinity', f8: 'NaN', f4: null, tsl: '2026-10-08T23:59:59' })
    expect(await read('3')).toEqual({ ts: '0044-03-15T12:00:00.500000Z BC', tm: null, d: '0044-03-15 BC', f8: null, f4: '-Infinity', tsl: null })
    expect(await read('4')).toEqual({ ts: 'infinity', tm: '24:00', d: '10000-01-01 AD', f8: null, f4: null, tsl: null })
    expect(await read('9')).toEqual({ ts: '9999-12-31T23:59:59Z', tm: '23:59', d: null, f8: null, f4: null, tsl: null })
    for (const [name, value] of [['ts', '2026-10-08T10:34:56Z'], ['tm', '10:30'], ['ts', '9999-12-31T23:59:59Z'], ['tm', '23:59']] as const) {
      expect(codecFor(meta('kinds', name)).parse(value), `${name} ${value}`).toEqual({ ok: true, value })
    }
    for (const [name, value] of [['ts', '0044-03-15T12:00:00.500000Z BC'], ['ts', 'infinity'], ['tm', '24:00'], ['d', 'infinity'], ['d', '10000-01-01 AD'], ['f8', 'NaN']] as const) {
      expect(codecFor(meta('kinds', name)).parse(value).ok, `${name} ${value}`).toBe(false)
    }
  })

  // Every one of these is the composition root's to set on the driver it
  // hands over: names transformed to camelCase, every string value
  // transformed after parsing, numeric parsed as a number, dates spelled
  // day-first, and a zone 13:45 ahead. A `::text` cast alone survives none of
  // the first two, and `date::text` follows DateStyle.
  test('reads the same values however the driver and the session are configured', async () => {
    const configured = postgres(fixture.admin, {
      onnotice: () => {},
      transform: { ...postgres.camel, value: { from: (value: unknown) => (typeof value === 'string' ? value.toUpperCase() : value) } },
      types: { numeric: { to: 1700, from: [1700], parse: (raw: string) => Number(raw), serialize: (value: number) => String(value) } },
      connection: { DateStyle: 'SQL, DMY', TimeZone: 'Pacific/Chatham', IntervalStyle: 'sql_standard', extra_float_digits: '-3' },
    })
    try {
      // A row of its own, so this test cannot pass by reading nothing twice.
      await owner.unsafe(`
        insert into rec.kinds (id, t, b, i8, n, c, u, d, tm, ts, tsl, f8, f4)
        values (5, 'lower case', true, 9007199254740993, 12.50, 'AB', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                '2026-10-08', '23:59', '2026-10-08 12:34:56+00', '2026-10-08 12:34:56', 0.1::float8 + 0.2::float8, 0.1)`)
      const request = { target: KINDS, key: idKey('5'), columns: KIND_COLUMNS.map((name) => col('kinds', name)), filters: EVERY_ROW }
      const expected = {
        t: 'lower case',
        b: true,
        i2: null,
        i8: EDGE_VALUES.beyondSafeInteger,
        n: '12.50',
        c: 'AB',
        u: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        d: '2026-10-08',
        tm: '23:59',
        ts: '2026-10-08T12:34:56Z',
        tsl: '2026-10-08T12:34:56',
        f8: 0.1 + 0.2,
        f4: 0.1,
      }
      expect(succeeded(await createPostgresRecords(owner).read(request))).toEqual({ ok: true, values: expected, version: '1' })
      expect(succeeded(await createPostgresRecords(configured).read(request))).toEqual({ ok: true, values: expected, version: '1' })
      // Bound the other way: a wall-clock timestamp as a key, in the spelling
      // the read gave it, finds the row under a day-first DateStyle too.
      const byWallClock = { ...request, target: { ...KINDS, identity: [col('kinds', 'tsl')] }, key: [val('kinds', 'tsl', expected.tsl)], columns: [col('kinds', 't')] }
      expect(succeeded(await createPostgresRecords(configured).read(byWallClock)).values).toEqual({ t: 'lower case' })
      const edge = { target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [col('order', 'amount'), col('order', 'order_date')], filters: TENANT_1 }
      expect(succeeded(await createPostgresRecords(configured).read(edge)).values).toEqual({ amount: EDGE_VALUES.largestAmount, order_date: EDGE_VALUES.orderDate })
    } finally {
      await configured.end()
    }
  })

  // A real is a 32-bit float. Its exact value as a double is long
  // (0.1 is 0.10000000149011612). Read from its bits, it must come back as
  // data-core's canonicalFloat32 names it — what the codec accepts and the
  // SQL Server adapter reads too (0026) — and PostgreSQL's own text is the
  // independent check on it: the same float, never in more digits.
  // PostgreSQL's text is not the spelling, and the last three rows say why:
  // 2^-96 (row 6) once came back in nine digits where PostgreSQL, and now
  // canonicalFloat32, use eight; 805306368 (row 7) is named by 805306400,
  // halfway to the next float and rounded to this one, which PostgreSQL's
  // printer does not take; 2^-12 (row 8) ends in an exact tie, which
  // PostgreSQL breaks to even and toExponential away from zero.
  test('reads a real as the shortest decimal naming its float, never longer than PostgreSQL prints it', async () => {
    const records = createPostgresRecords(owner)
    const target: RecordTarget = { table: { schema: 'rec', name: 'reals' }, identity: [ID], concurrency: null }
    const printed = await owner<{ id: number; f4: string }[]>`select id, f4::text as f4 from rec.reals order by id`
    expect(printed.map((row) => row.f4)).toEqual([
      '10.0152025',
      '0.1',
      '3.4028235e+38',
      '1.1754944e-38',
      '7e-45',
      '1.2621775e-29',
      '8.0530637e+08',
      '0.00024414062',
    ])
    const digits = (value: number): number => value.toExponential().replace(/^-|e.*$|\./g, '').length
    const reads: unknown[] = []
    for (const row of printed) {
      const read = succeeded(await records.read({ target, key: idKey(String(row.id)), columns: [col('reals', 'f4')], filters: EVERY_ROW }))
      const value = read.values.f4 as number
      expect(Math.fround(value), row.f4).toBe(Math.fround(Number(row.f4)))
      expect(digits(value), row.f4).toBeLessThanOrEqual(digits(Number(row.f4)))
      expect(value, row.f4).toBe(canonicalFloat32(Number(row.f4)))
      reads.push(value)
    }
    expect(reads).toEqual([10.0152025, 0.1, 3.4028235e38, 1.1754944e-38, 7e-45, 1.2621775e-29, 805306400, 0.00024414063])
  })

  // Another tenant's row exists, and a different answer for it than for a
  // row that does not would disclose that it exists (0015).
  test('a record outside the filters is not-found, exactly like one that does not exist', async () => {
    const records = createPostgresRecords(owner)
    const customer = (tenant: string, number: string) => ({
      target: CUSTOMER,
      key: customerKey(tenant, number),
      columns: [col('customer', 'name')],
      filters: TENANT_1,
    })
    expect(succeeded(await records.read(customer('1', '1001'))).values).toEqual({ name: 'Muster AG' })
    expect(failed(await records.read(customer('2', '1001'))).code).toBe('not-found')
    expect(failed(await records.read(customer('1', '9999'))).code).toBe('not-found')
    // A read of no columns asks only whether the record is there, and must
    // draw the same line: its statement selects a constant, not nothing.
    const there = (tenant: string) => records.read({ ...customer(tenant, '1001'), columns: [] })
    expect(succeeded(await there('1'))).toEqual({ ok: true, values: {}, version: null })
    expect(failed(await there('2')).code).toBe('not-found')
  })

  // The boolean serializer of postgres.js turns every value that is not the
  // JavaScript `true` into 'f', so an untyped filter of 'true' once selected
  // the FALSE rows. A boolean has no spelling both engines compare alike,
  // so a boolean filter is refused (0028), and one that reaches the adapter
  // by hand is thrown before anything is sent, for a read and an update.
  test('a boolean filter throws before anything is sent', async () => {
    const records = createPostgresRecords(owner)
    const on = { kind: 'restricted', equal: [{ column: 'b', type: col('kinds', 'b').type, value: 'true' }] } as unknown as RowFilters
    await expect(records.read({ target: KINDS, key: idKey('6'), columns: [col('kinds', 't')], filters: on })).rejects.toThrow(/carries its column's type/)
    await expect(
      records.update({ target: KINDS, key: idKey('6'), set: [val('kinds', 't', 'x')], expectedVersion: '1', filters: on, returning: [] }),
    ).rejects.toThrow(/carries its column's type/)
  })

  // A filter term parsed by building a row of the table's type from NULL
  // runs every column the term does not name through its input function as
  // NULL, so a domain can check it: a NOT NULL domain, or a CHECK that
  // refuses NULL, failed every filtered statement on the table — a read
  // answered not-null-violation, a write constraint — though neither domain
  // column is read, written or filtered.
  test('a filter on a table with a domain that refuses NULL reads, updates and answers like any other', async () => {
    const records = createPostgresRecords(owner)
    const read = (id: string) => records.read({ target: CONTACT, key: idKey(id), columns: [col('contact', 'name')], filters: TENANT_1 })
    const update = (id: string, expectedVersion: string) =>
      records.update({ target: CONTACT, key: idKey(id), set: [val('contact', 'name', 'renamed')], expectedVersion, filters: TENANT_1, returning: [col('contact', 'name')] })
    expect(succeeded(await read('1')).values).toEqual({ name: 'ours' })
    expect(failed(await read('2')).code).toBe('not-found')
    expect(succeeded(await update('1', '1'))).toEqual({ ok: true, values: { name: 'renamed' }, version: '2' })
    expect(failed(await update('1', '1')).code).toBe('stale')
    expect(failed(await update('2', '1')).code).toBe('not-found')
  })

  // Identifiers are quoted one part at a time. The driver's own helper quotes
  // `a.b` as "a"."b", which names a different object (0015).
  test('quotes a table name holding a dot and a column name holding quotes, one part at a time', async () => {
    const records = createPostgresRecords(owner)
    const target: RecordTarget = { table: { schema: 'rec', name: 'a.b' }, identity: [ID], concurrency: null }
    const said: RecordColumn = { name: 'say "hi"', type: TEXT }
    succeeded(await records.insert({ target, values: [...idKey('1'), { ...said, value: 'hello' }], returning: [] }))
    expect(succeeded(await records.read({ target, key: idKey('1'), columns: [said], filters: EVERY_ROW })).values).toEqual({ 'say "hi"': 'hello' })
  })

  // PostgreSQL truncates an identifier longer than 63 bytes, with only a
  // NOTICE, and the truncated name is a real table here. No catalog can
  // produce such a name, so a request carrying one is a programming error.
  test('refuses a name PostgreSQL would truncate into another table', async () => {
    const records = createPostgresRecords(owner)
    const request = (name: string) => ({ target: { table: { schema: 'rec', name }, identity: [ID], concurrency: null }, key: idKey('1'), columns: [{ name: 'note', type: TEXT }], filters: EVERY_ROW })
    expect(succeeded(await records.read(request(LONGEST))).values).toEqual({ note: 'the table a longer name would be truncated to' })
    await expect(records.read(request(`${LONGEST}y`))).rejects.toThrow(/63 bytes/)
  })
})

describe('the column facts both engines are held to (0026)', () => {
  const SHIPMENT: RecordTarget = { table: { schema: 'sales', name: 'shipment' }, identity: [ID], concurrency: null }
  const shipmentKey = (id: string): RecordValue[] => [val('shipment', 'id', id)]

  /** The values a shipment cannot be inserted without, a fresh tracking number each time. */
  const shipmentValues = (reference: string): RecordValue[] =>
    Object.entries({ tenant_id: '7', tracking_no: randomUUID(), carrier_code: '1', reference, pickup_time: '08:00' }).map(([name, value]) => val('shipment', name, value))

  /** A shipment of its own, inserted through the adapter, so rows 1 and 2 stay what the model says; its id. */
  async function newShipment(reference: string): Promise<string> {
    const outcome = succeeded(await createPostgresRecords(owner).insert({ target: SHIPMENT, values: shipmentValues(reference), returning: [col('shipment', 'id')] }))
    return String(outcome.values.id)
  }

  function refused(outcome: CodecOutcome): { code: string; message: string } {
    if (outcome.ok) throw new Error(`expected the codec to refuse, it accepted ${JSON.stringify(outcome.value)}`)
    return { code: outcome.code, message: outcome.message }
  }

  // One expected object for both engines, from @formancy/data-fixtures. An
  // adapter that spelled a zoneless timestamp its own way (cut at the second,
  // or padded to its scale) or answered a real as the double it widens to
  // would read these rows differently from SQL Server's, and an unchanged
  // echo of one would look like a change on the other.
  test('the shipments read back exactly as both adapters must return them', covers('postgres', shipmentCase('first'), shipmentCase('second'), edgeCase('largestSmallint'), edgeCase('localTimestamp'), edgeCase('localTimestampWholeSecond')), async () => {
    const shipment = findObject(snapshot, { schema: 'sales', name: 'shipment' })
    if (shipment === undefined) throw new Error('sales.shipment is not in the snapshot')
    const columns = shipment.columns.filter((column) => column.type.kind !== 'binary').map(({ name, type }) => ({ name, type }))
    const read = async (id: string) => succeeded(await createPostgresRecords(owner).read({ target: SHIPMENT, key: shipmentKey(id), columns, filters: EVERY_ROW })).values
    expect(await read('1')).toEqual(FIRST_SHIPMENT)
    expect(await read('2')).toEqual(SECOND_SHIPMENT)
  })

  // varchar(20) is twenty characters in PostgreSQL's UTF8 database:
  // twenty two-byte letters, twenty four-byte emoji. A codec counting UTF-16
  // code units, as it did before 0026, refused the twenty emoji the column
  // holds; one counting bytes would refuse the letters. The 21st is refused
  // by both, the codec first.
  test('varchar(20) holds 20 characters, and the codec counts the same', async () => {
    const reference = meta('shipment', 'reference')
    expect(reference.type).toEqual({ kind: 'text', maxLength: 20, lengthUnit: 'code-points', fixedLength: false })
    const codec = codecFor(reference)
    for (const value of ['é'.repeat(20), '😀'.repeat(20)]) {
      expect(codec.parse(value)).toEqual({ ok: true, value })
      const id = await newShipment(value)
      const read = succeeded(await createPostgresRecords(owner).read({ target: SHIPMENT, key: shipmentKey(id), columns: [col('shipment', 'reference')], filters: EVERY_ROW }))
      expect(read.values.reference).toBe(value)
    }
    expect(refused(codec.parse('é'.repeat(21)))).toEqual({ code: 'too-long', message: 'At most 20 characters.' })
    // The server draws the line at the same place: 22001, value too long.
    await expect(
      owner`insert into sales.shipment (tenant_id, tracking_no, carrier_code, reference, pickup_time) values (7, ${randomUUID()}, 1, ${'é'.repeat(21)}, '08:00')`,
    ).rejects.toMatchObject({ code: '22001' })
  })

  // A real stores the float nearest the value it is given, and its exact
  // value as a double is long. Were the codec's value, the stored value as
  // read and the value echoed back not one number, an unchanged form would
  // save a change; and 0.123456789, which a real cannot hold, must read back
  // as the 0.12345679 the codec already said it would be.
  test('a real written as the codec gives it reads back as that same value, and an echo of it changes nothing', async () => {
    const codec = codecFor(meta('kinds', 'f4'))
    const records = createPostgresRecords(owner)
    const f4 = [col('kinds', 'f4')]
    for (const [id, sent, saved] of [['30', 0.1, 0.1], ['31', 0.123456789, 0.12345679], ['32', 0.10000000149011612, 0.1]] as const) {
      expect(codec.parse(sent)).toEqual({ ok: true, value: saved })
      succeeded(await records.insert({ target: KINDS, values: [...idKey(id), val('kinds', 'f4', saved)], returning: [] }))
      const first = succeeded(await records.read({ target: KINDS, key: idKey(id), columns: f4, filters: EVERY_ROW }))
      expect(first.values).toEqual({ f4: saved })
      const echo = { target: KINDS, key: idKey(id), set: [val('kinds', 'f4', first.values.f4 ?? null)], expectedVersion: String(first.version), filters: EVERY_ROW, returning: f4 }
      expect(succeeded(await records.update(echo)).values).toEqual({ f4: saved })
      expect(succeeded(await records.read({ target: KINDS, key: idKey(id), columns: f4, filters: EVERY_ROW })).values).toEqual({ f4: saved })
    }
  })

  // An unpaired surrogate cannot be UTF-8. The driver writes U+FFFD in its
  // place, PostgreSQL stores that, and the write reports success: the value
  // read back is not the value written, and nothing said so. The codec refuses
  // it first, so a form never reaches this silent change.
  test('a text with an unpaired surrogate is refused by the codec, because PostgreSQL would store U+FFFD in silence', async () => {
    const lone = '\ud800ab'
    expect(refused(codecFor(meta('shipment', 'reference')).parse(lone)).code).toBe('invalid-character')
    const id = await newShipment(lone)
    const read = succeeded(await createPostgresRecords(owner).read({ target: SHIPMENT, key: shipmentKey(id), columns: [col('shipment', 'reference')], filters: EVERY_ROW }))
    expect(read.values.reference).toBe('�ab')
  })

  // PostgreSQL refuses a value a real cannot hold (22003) where SQL Server
  // stores 1e-50 as 0 without a word. The codec refuses both first, so
  // neither engine is asked and the two cannot differ.
  test('a value a real would refuse is refused by the codec first', async () => {
    const codec = codecFor(meta('shipment', 'temperature_c'))
    expect(refused(codec.parse(1e-50)).code).toBe('out-of-range')
    expect(refused(codec.parse(3.5e38)).code).toBe('out-of-range')
    await expect(owner`select '1e-50'::pg_catalog.float4`).rejects.toMatchObject({ code: '22003' })
    await expect(owner`select '3.5e38'::pg_catalog.float4`).rejects.toMatchObject({ code: '22003' })
    // The smallest denormal is a real, and both say so.
    expect(codec.parse(1e-45)).toEqual({ ok: true, value: 1e-45 })
    const [printed] = await owner<{ f4: string }[]>`select '1e-45'::pg_catalog.float4::pg_catalog.text as f4`
    expect(printed?.f4).toBe('1e-45')
  })

  // A wall clock is spelled with its fraction, trailing zeros dropped, and
  // nothing more: a whole second ending in 0 keeps the 0. That is the trap
  // SQL Server's trim had to be guarded against (…:50 read as …:5), checked
  // here too so the two spellings are held to the same edges.
  test('a zoneless timestamp keeps its fraction, trailing zeros dropped, never a digit of the seconds', async () => {
    await owner.unsafe(`insert into rec.kinds (id, tsl) values (40, '2026-10-08 12:34:50.120000'), (41, '2026-10-08 12:34:50'), (42, '2026-10-08 12:34:56.000001')`)
    const read = async (id: string) => succeeded(await createPostgresRecords(owner).read({ target: KINDS, key: idKey(id), columns: [col('kinds', 'tsl')], filters: EVERY_ROW })).values.tsl
    expect(await read('40')).toBe('2026-10-08T12:34:50.12')
    expect(await read('41')).toBe('2026-10-08T12:34:50')
    expect(await read('42')).toBe('2026-10-08T12:34:56.000001')
  })

  // BY DEFAULT takes a number given to it, and the form never gives one: the
  // codec keeps the column read-only. This is why. A number chosen by hand
  // does not move the identity's sequence, so the next create that leaves the
  // column out is handed that same number and collides with it.
  test('a by-default identity numbers a create that leaves it out, and a number chosen by hand collides later', async () => {
    const id = meta('shipment', 'id')
    expect(id.generated).toBe('identity-by-default')
    expect(codecFor(id)).toMatchObject({ status: 'read-only', reason: expect.stringMatching(/identity-by-default/) as unknown })
    const numbered = BigInt(await newShipment('numbered'))
    expect(numbered > 2n).toBe(true)
    // The database accepts the next number, given by hand...
    await owner`insert into sales.shipment (id, tenant_id, tracking_no, carrier_code, reference, pickup_time) values (${String(numbered + 1n)}, 7, ${randomUUID()}, 1, 'by hand', '08:00')`
    // ...and the next create through the adapter is handed it again.
    const collided = failed(await createPostgresRecords(owner).insert({ target: SHIPMENT, values: shipmentValues('collides'), returning: [] }))
    expect(collided).toMatchObject({ code: 'unique-violation', constraint: 'pk_shipment' })
  })
})

describe('inserting', () => {
  // The identity and the default are the database's; the form never names
  // them, and the person sees the saved values without a second request.
  test('an insert into sales.order returns its identity, its default status and its first version', async () => {
    const records = createPostgresRecords(owner)
    const outcome = succeeded(
      await records.insert({
        target: ORDER,
        values: [val('order', 'tenant_id', '1'), val('order', 'customer_no', '1001'), val('order', 'order_date', '2026-10-09'), val('order', 'amount', EDGE_VALUES.largestAmount)],
        returning: [col('order', 'id'), col('order', 'status'), col('order', 'amount'), col('order', 'notes')],
      }),
    )
    expect(outcome.values).toMatchObject({ status: 'draft', amount: EDGE_VALUES.largestAmount, notes: null })
    expect(outcome.values.id).toMatch(/^[1-9][0-9]*$/)
    expect(outcome.version).toBe('1')
    const [row] = await owner<{ status: string }[]>`select status from sales."order" where id = ${String(outcome.values.id)}`
    expect(row?.status).toBe('draft')
  })

  // An identity GENERATED ALWAYS refuses a value. A column that became one
  // since the bindings were made is a schema change, not a server failure.
  test('writing a column the database now generates is schema-changed', async () => {
    const outcome = await createPostgresRecords(owner).insert({
      target: ORDER,
      values: [val('order', 'id', '5'), val('order', 'tenant_id', '1'), val('order', 'customer_no', '1001'), val('order', 'order_date', '2026-10-09'), val('order', 'amount', '1.0000')],
      returning: [],
    })
    expect(failed(outcome)).toMatchObject({ code: 'schema-changed' })
  })
})

describe('inserting nothing but defaults', () => {
  // An insert of no columns is DEFAULT VALUES: every column gets what the
  // table says, and the generated identity comes back.
  test('an insert of no values writes every default and returns them', async () => {
    const target: RecordTarget = { table: { schema: 'rec', name: 'defaults' }, identity: [ID], concurrency: null }
    const outcome = succeeded(await createPostgresRecords(owner).insert({ target, values: [], returning: [col('defaults', 'id'), col('defaults', 'opened'), col('defaults', 'state')] }))
    expect(outcome).toEqual({ ok: true, values: { id: '1', opened: '2026-10-08', state: 'new' }, version: null })
  })
})

describe('updating', () => {
  // One statement: the key, the filters and the version in one WHERE, and the
  // version moved in the same statement, so every writer through this module
  // sees the change.
  test('changes the record and moves its version by one, in one statement', async () => {
    const { id, version } = await newOrder('first')
    const outcome = succeeded(await createPostgresRecords(owner).update(updateOf(id, version, 'second')))
    expect(outcome).toEqual({ ok: true, values: { notes: 'second' }, version: String(BigInt(version) + 1n) })
    expect(await notesOf(id)).toEqual({ notes: 'second', row_version: String(BigInt(version) + 1n) })
    // An actor the policy leaves unrestricted updates with the same guard and no filter.
    const unrestricted = succeeded(await createPostgresRecords(owner).update(updateOf(id, String(BigInt(version) + 1n), 'third', EVERY_ROW)))
    expect(unrestricted.version).toBe(String(BigInt(version) + 2n))
  })

  // The plan's minimum for a writable form: two people save the same version.
  // A third connection holds the row, so both updates are queued on it and
  // the race is real; whichever gets the row first wins, and the other must
  // not overwrite it.
  test('of two concurrent updates with the same version, one wins and the other is stale', async () => {
    const { id, version } = await newOrder('original')
    const first = postgres(fixture.admin, { max: 1, onnotice: () => {} })
    const second = postgres(fixture.admin, { max: 1, onnotice: () => {} })
    try {
      // Started inside the transaction and awaited after it: the updates
      // cannot finish until the lock they queue on is released.
      const racing = await whileLocked(id, async () => {
        const both = Promise.all([
          createPostgresRecords(first).update(updateOf(id, version, 'by the first')),
          createPostgresRecords(second).update(updateOf(id, version, 'by the second')),
        ])
        await waitUntilBlocked(2)
        return { both }
      })
      const outcomes = await racing.both
      const won = outcomes.filter((outcome) => outcome.ok).map(succeeded)
      const lost = outcomes.filter((outcome) => !outcome.ok).map(failed)
      expect(won).toHaveLength(1)
      expect(lost.map((outcome) => outcome.code)).toEqual(['stale'])
      expect(await notesOf(id)).toEqual({ notes: won[0]?.values.notes, row_version: String(BigInt(version) + 1n) })
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  })

  // Under REPEATABLE READ, which a composition root may make the default,
  // PostgreSQL answers the same lost race with SQLSTATE 40001 instead of 0
  // rows (0006). It is the same conflict and must read the same way.
  test('a lost race under REPEATABLE READ is stale too', async () => {
    const { id, version } = await newOrder('original')
    const repeatable = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    try {
      const held = await owner.begin(async (tx) => {
        await tx`update sales."order" set notes = 'by somebody else', row_version = row_version + 1 where id = ${id}`
        const pending = createPostgresRecords(repeatable).update(updateOf(id, version, 'from a stale snapshot'))
        await waitUntilBlocked(1)
        return { pending }
      })
      expect(failed(await held.pending).code).toBe('stale')
      expect((await notesOf(id))?.notes).toBe('by somebody else')
    } finally {
      await repeatable.end()
    }
  })

  // Another tenant's order, with its correct version: outside the filters it
  // does not exist for this actor, and it must not change.
  test('an update outside the tenant filter is not-found and changes nothing', async () => {
    const { id, version } = await newOrder('theirs', '2')
    expect(failed(await createPostgresRecords(owner).update(updateOf(id, version, 'ours now'))).code).toBe('not-found')
    expect(await notesOf(id)).toEqual({ notes: 'theirs', row_version: version })
  })

  // The two answers to "0 rows": somebody changed it, or it is not there. A
  // version that is not a number names no state the record was ever in.
  test('tells a stale version from a missing record, and never binds a version that is not one', async () => {
    const records = createPostgresRecords(owner)
    const { id, version } = await newOrder('kept')
    expect(failed(await records.update(updateOf(id, String(BigInt(version) + 7n), 'lost'))).code).toBe('stale')
    expect(failed(await records.update(updateOf(id, "1 or 1=1", 'lost'))).code).toBe('stale')
    expect(failed(await records.update(updateOf('424242', version, 'lost'))).code).toBe('not-found')
    expect(await notesOf(id)).toEqual({ notes: 'kept', row_version: version })
  })

  // A write that names the version column itself, or a filter column, would
  // set what the guard compares or move the record out of the actor's rows.
  // The host built that request; the adapter refuses to run it.
  test('refuses an update that sets the version column or a filter column', async () => {
    const records = createPostgresRecords(owner)
    const { id, version } = await newOrder()
    await expect(records.update({ ...updateOf(id, version, 'x'), set: [val('order', 'row_version', '1')] })).rejects.toThrow(/version column/)
    await expect(records.update({ ...updateOf(id, version, 'x'), set: [val('order', 'tenant_id', '2')] })).rejects.toThrow(/filter/)
    await expect(records.update({ ...updateOf(id, version, 'x'), set: [] })).rejects.toThrow(/nothing to set/)
  })
})

describe('what a refusal is called', () => {
  const insertOrder = (values: RecordValue[]) => createPostgresRecords(owner).insert({ target: ORDER, values, returning: [] })

  // Each constraint the fixture names, provoked for real and mapped by
  // SQLSTATE, with the constraint or column the server reported. A message
  // never carries the value: 23505's detail does, so it is not passed on.
  test('each constraint the fixture can break maps to its code', async () => {
    const records = createPostgresRecords(owner)
    const duplicate = failed(
      await records.insert({ target: CUSTOMER, values: [val('customer', 'tenant_id', '1'), val('customer', 'customer_no', '1001'), val('customer', 'name', 'Twin')], returning: [] }),
    )
    expect(duplicate).toMatchObject({ code: 'unique-violation', constraint: 'pk_customer' })
    expect(duplicate.message).not.toMatch(/1001/)
    expect(
      failed(await records.insert({ target: { table: { schema: 'sales', name: 'country' }, identity: [], concurrency: null }, values: [val('country', 'iso_code', 'CH'), val('country', 'name', 'Again')], returning: [] })),
    ).toMatchObject({ code: 'unique-violation', constraint: 'uq_country_iso_code' })
    expect(failed(await insertOrder(orderValues({ customer_no: '9999' })))).toMatchObject({ code: 'foreign-key-violation', constraint: 'fk_order_customer' })
    expect(failed(await insertOrder(orderValues({ created_by: '99' })))).toMatchObject({ code: 'foreign-key-violation', constraint: 'fk_order_created_by' })
    expect(failed(await insertOrder(orderValues().filter((value) => value.name !== 'amount')))).toMatchObject({ code: 'not-null-violation', column: 'amount' })
    expect(failed(await insertOrder(orderValues({ status: 'lost' })))).toMatchObject({ code: 'check-violation', constraint: 'ck_order_status' })
    expect(failed(await insertOrder(orderValues({ status: 'x'.repeat(21) })))).toMatchObject({ code: 'too-long' })
    expect(failed(await insertOrder(orderValues({ amount: '100000000000000.0000' })))).toMatchObject({ code: 'out-of-range' })
    expect(failed(await insertOrder(orderValues({ tenant_id: '2147483648' })))).toMatchObject({ code: 'out-of-range' })
  })

  // A trigger is the database refusing by a rule it does not declare as a
  // constraint. `check-violation` claimed a constraint the form could have
  // checked; `refused` (0028) says the same request will be refused again.
  test('a trigger that raises is refused', async () => {
    const guarded: RecordTarget = { table: { schema: 'rec', name: 'guarded' }, identity: [ID], concurrency: null }
    const outcome = failed(await createPostgresRecords(owner).insert({ target: guarded, values: [val('guarded', 'id', '1'), val('guarded', 'amount', '-1')], returning: [] }))
    expect(outcome.code).toBe('refused')
    expect(outcome.message).not.toMatch(/negative/)
  })

  // A BEFORE trigger that returns NULL, or a rule that does nothing instead,
  // makes the server complete the statement — INSERT 0 0, UPDATE 0 — with no
  // error. Taken as success, the insert was a save that never happened, its
  // identity null; taken as "nothing matched", the update was stale on every
  // attempt while the version never moved. Not `check-violation` either,
  // which names a constraint the form could have checked (0028).
  test('a write the database declines without an error is refused, not a success and not stale', async () => {
    const records = createPostgresRecords(owner)
    const insert = (target: RecordTarget, returning: RecordColumn[]) => records.insert({ target, values: [val('declined', 'id', '2'), val('declined', 'note', 'never written')], returning })
    expect(failed(await insert(DECLINED, [col('declined', 'id')]))).toMatchObject({ code: 'refused', message: expect.stringMatching(/declined/) })
    expect(failed(await insert({ ...DECLINED, concurrency: null }, [])).code).toBe('refused')
    expect(failed(await insert({ table: { schema: 'rec', name: 'ruled' }, identity: [ID], concurrency: null }, [])).code).toBe('refused')

    const update = (id: string, expectedVersion: string) =>
      records.update({ target: DECLINED, key: idKey(id), set: [val('declined', 'note', 'never written')], expectedVersion, filters: EVERY_ROW, returning: [] })
    expect(failed(await update('1', '1'))).toMatchObject({ code: 'refused', message: expect.stringMatching(/declined/) })
    // A version that has moved is still stale, and a record that is not there still not-found.
    expect(failed(await update('1', '2')).code).toBe('stale')
    expect(failed(await update('9', '1')).code).toBe('not-found')
    expect([...(await owner`select id, note, version::text as version from rec.declined`)]).toEqual([{ id: 1, note: 'kept', version: '1' }])
    expect([...(await owner`select id from rec.ruled`)]).toEqual([])
  })

  // The connection's own grants. The reader may read sales.order and write
  // nothing; it may not read sales.customer at all.
  test("the account's own grants are permission-denied", async () => {
    const records = createPostgresRecords(reader)
    expect(failed(await records.insert({ target: ORDER, values: orderValues(), returning: [] })).code).toBe('permission-denied')
    expect(
      failed(await records.read({ target: CUSTOMER, key: customerKey('1', '1001'), columns: [col('customer', 'name')], filters: TENANT_1 })).code,
    ).toBe('permission-denied')
    expect(succeeded(await records.read({ target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [col('order', 'status')], filters: TENANT_1 })).values.status).toEqual(expect.any(String))
  })

  // A binding that names what is no longer there, which drift review exists
  // to catch: a dropped column, a dropped table.
  // A binding that names what is no longer there, or what is no longer the
  // type it was: a dropped column, a dropped table, a column the bindings
  // call a date that is text now (no to_char for it), one they call an
  // integer that is a uuid now (no assignment from integer).
  test('a column or table that is gone, or has changed type, is schema-changed', async () => {
    const records = createPostgresRecords(owner)
    const gone: RecordColumn = { name: 'discount', type: TEXT }
    expect(failed(await records.read({ target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [gone], filters: TENANT_1 })).code).toBe('schema-changed')
    expect(failed(await records.read({ target: { ...ORDER, table: { schema: 'sales', name: 'invoice' } }, key: orderKey('1'), columns: [], filters: TENANT_1 })).code).toBe('schema-changed')
    const notesAsDate: RecordColumn = { name: 'notes', type: { kind: 'date' } }
    expect(failed(await records.read({ target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [notesAsDate], filters: TENANT_1 })).code).toBe('schema-changed')
    const uuidAsInteger: RecordValue = { name: 'u', type: INT32, value: '7' }
    expect(failed(await records.insert({ target: KINDS, values: [...idKey('70'), uuidAsInteger], returning: [] })).code).toBe('schema-changed')
    // The check that tells stale from not-found is a statement too, and fails the same way.
    const invoice = { ...ORDER, table: { schema: 'sales', name: 'invoice' } }
    expect(failed(await records.update({ ...updateOf('1', 'not a version', 'x'), target: invoice })).code).toBe('schema-changed')
  })

  // An exclusion constraint is a generalised unique constraint: "conflicting
  // key value". The contract has no code of its own for it.
  test('an exclusion constraint is a unique-violation, with its name', async () => {
    const booking: RecordTarget = { table: { schema: 'rec', name: 'booking' }, identity: [ID], concurrency: null }
    const outcome = failed(await createPostgresRecords(owner).insert({ target: booking, values: [val('booking', 'id', '2'), val('booking', 'room', 'Aula')], returning: [] }))
    expect(outcome).toMatchObject({ code: 'unique-violation', constraint: 'ex_booking_room' })
  })

  // A text column with no declared length accepts any length the codec
  // does, and a unique index on it still refuses a value whose index entry
  // exceeds a btree page's third (SQLSTATE 54000). Random characters, so
  // compression cannot bring it under.
  test('a value too large for its index is too-long', async () => {
    const indexed: RecordTarget = { table: { schema: 'rec', name: 'indexed' }, identity: [ID], concurrency: null }
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const large = Array.from({ length: 12_000 }, () => alphabet.charAt(Math.floor(Math.random() * alphabet.length))).join('')
    expect(failed(await createPostgresRecords(owner).insert({ target: indexed, values: [val('indexed', 'id', '1'), val('indexed', 'code', large)], returning: [] })).code).toBe('too-long')
  })

  // Nothing was sent: the server is not there. Safe to try again later.
  test('a database that cannot be reached is unavailable, for a read and for a write', async () => {
    const nowhere = postgres({ host: '127.0.0.1', port: await closedPort(), username: 'nobody', password: 'nothing', database: 'none', connect_timeout: 5, onnotice: () => {} })
    try {
      const records = createPostgresRecords(nowhere)
      expect(failed(await records.read({ target: ORDER, key: orderKey('1'), columns: [], filters: TENANT_1 })).code).toBe('unavailable')
      expect(failed(await records.insert({ target: ORDER, values: orderValues(), returning: [] })).code).toBe('unavailable')
    } finally {
      await nowhere.end()
    }
  })
})

describe('objects planted on the search path', () => {
  /**
   * What a role may define with CREATE on `public` and no right on any table
   * — every login role on PostgreSQL 14 and earlier. An unqualified function
   * or operator is resolved through the search path, and an exact match in
   * `public` wins over pg_catalog's candidate when that one needs an implicit
   * cast: there is no `=(bigint, numeric)` in pg_catalog, only a polymorphic
   * `jsonb_populate_record` and a `to_char` of a timestamp. Exact matches and
   * type names win only when the search path names pg_catalog after public,
   * which is the composition root's to set.
   */
  const PLANTED = `
    create function public.planted_true(bigint, pg_catalog.numeric) returns boolean language sql immutable as 'select true';
    create operator public.= (leftarg = bigint, rightarg = pg_catalog.numeric, function = public.planted_true);
    create function public.jsonb_populate_record(base sales."order", fields pg_catalog.jsonb) returns sales."order" language sql
      as $$ select pg_catalog.jsonb_populate_record(base, '{"tenant_id": "2"}') $$;
    create function public.to_char(pg_catalog.date, pg_catalog.text) returns pg_catalog.text language sql as $$ select 'PLANTED' $$;
    create function public.planted_zero(pg_catalog.numeric, integer) returns pg_catalog.numeric language sql immutable as 'select 0::pg_catalog.numeric';
    create operator public.% (leftarg = pg_catalog.numeric, rightarg = integer, function = public.planted_zero);
    create function public.planted_equal(bigint, bigint) returns boolean language sql immutable as 'select true';
    create operator public.= (leftarg = bigint, rightarg = bigint, function = public.planted_equal);
    create function public.planted_equal(integer, integer) returns boolean language sql immutable as 'select true';
    create operator public.= (leftarg = integer, rightarg = integer, function = public.planted_equal);
    create domain public.text as pg_catalog.text check (false);
    create domain public.date as pg_catalog.text check (false);`

  // A shadowed `=(bigint, numeric)` accepted a stale write; a shadowed
  // jsonb_populate_record returned another tenant's order through the tenant
  // filter; a shadowed to_char and `%` rewrote a date and dropped the
  // fraction of an instant, which since 0040 is a zoneless timestamp's. With pg_catalog last, every operator, function
  // and type name the SQL spelled was the planted one. Each name is
  // qualified now, so neither path changes an answer.
  test('change no answer, whether pg_catalog is searched first or last', async () => {
    const ours = await newOrder('ours')
    const theirs = await newOrder('theirs', '2')
    const createdAt = { target: CUSTOMER, key: customerKey('1', '1001'), columns: [col('customer', 'created_at')], filters: TENANT_1 }
    const instant = succeeded(await createPostgresRecords(owner).read(createdAt)).values
    expect(instant.created_at).toMatch(/T\d{2}:\d{2}:\d{2}Z$/)
    // An instant is cut to the second (0040), so the fraction a planted `%`
    // dropped is now a zoneless timestamp's: the first shipment's, `.5`.
    const shipment = { table: { schema: 'sales', name: 'shipment' }, identity: [ID], concurrency: null }
    const dispatched = { target: shipment, key: [val('shipment', 'id', '1')], columns: [col('shipment', 'dispatched_at')], filters: EVERY_ROW }
    expect(succeeded(await createPostgresRecords(owner).read(dispatched)).values).toEqual({ dispatched_at: EDGE_VALUES.localTimestamp })

    await owner.begin(async (tx) => {
      await tx.unsafe('create role planter; grant create on schema public to planter; grant usage on schema sales to planter')
      await tx.unsafe(`set local role planter; ${PLANTED}`)
    })
    // Fresh drivers: a statement prepared before the planting keeps the
    // names it resolved then, and would pass for the wrong reason.
    const catalogFirst = postgres(fixture.admin, { onnotice: () => {} })
    const catalogLast = postgres(fixture.admin, { onnotice: () => {}, connection: { search_path: 'public, pg_catalog' } })
    try {
      for (const [path, driver] of [
        ['"$user", public', catalogFirst],
        ['public, pg_catalog', catalogLast],
      ] as const) {
        const records = createPostgresRecords(driver)
        const current = (await notesOf(ours.id))?.row_version ?? ''
        expect(failed(await records.update(updateOf(ours.id, String(BigInt(current) - 1n), 'over a newer save'))).code, path).toBe('stale')
        expect(succeeded(await records.update(updateOf(ours.id, current, path))).version, path).toBe(String(BigInt(current) + 1n))
        expect(failed(await records.read({ target: ORDER, key: orderKey(theirs.id), columns: [col('order', 'notes')], filters: TENANT_1 })).code, path).toBe('not-found')
        const edge = { target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [col('order', 'order_date'), col('order', 'amount')], filters: TENANT_1 }
        expect(succeeded(await records.read(edge)).values, path).toEqual({ order_date: EDGE_VALUES.orderDate, amount: EDGE_VALUES.largestAmount })
        expect(succeeded(await records.read(createdAt)).values, path).toEqual(instant)
        expect(succeeded(await records.read(dispatched)).values, path).toEqual({ dispatched_at: EDGE_VALUES.localTimestamp })
        const inserted = succeeded(await records.insert({ target: ORDER, values: orderValues({ notes: path }), returning: [col('order', 'order_date')] }))
        expect(inserted, path).toEqual({ ok: true, values: { order_date: '2026-10-09' }, version: '1' })
      }
    } finally {
      await Promise.all([catalogFirst.end(), catalogLast.end()])
      await owner.unsafe('drop owned by planter; drop role planter')
    }
  })
})

describe('requests no binding produces', () => {
  // Each of these is a host or binding bug, not something the database said.
  // On a driver that has ended, anything sent would come back as
  // 'unavailable'; every one of them throws instead, so nothing was sent.
  test('are thrown before anything is sent', async () => {
    const ended = postgres(fixture.admin, { onnotice: () => {} })
    await ended.end()
    const records = createPostgresRecords(ended)
    const amount = val('order', 'amount', '1.0000')
    const insert = (values: RecordValue[], target: RecordTarget = ORDER) => records.insert({ target, values, returning: [] })
    await expect(records.read({ target: ORDER, key: customerKey('1', '1001'), columns: [], filters: TENANT_1 })).rejects.toThrow(/identity/)
    await expect(records.read({ target: ORDER, key: orderKey('1'), columns: [col('country', 'flag')], filters: TENANT_1 })).rejects.toThrow(/no canonical text/)
    await expect(insert([amount, amount])).rejects.toThrow(/named twice/)
    // 0008: never a JavaScript number for a decimal, nor for an integer past 2^53, nor text for a boolean.
    await expect(insert([{ ...amount, value: 1 }])).rejects.toThrow(/not a canonical value for a decimal/)
    await expect(insert([{ ...ORDER_ID, value: 2 ** 53 + 2 }])).rejects.toThrow(/not a canonical value for a integer/)
    await expect(insert([{ ...TENANT_ID, value: 1 }])).rejects.toThrow(/not a canonical value for a integer/)
    await expect(insert([{ ...col('country', 'flag'), value: 'ab' }])).rejects.toThrow(/no canonical text to bind/)
    await expect(insert([{ ...val('kinds', 'b', null), value: 'true' }], KINDS)).rejects.toThrow(/not a canonical value for a boolean/)
    await expect(insert([{ ...val('kinds', 'f8', null), value: Number.NaN }], KINDS)).rejects.toThrow(/not a canonical value for a float/)
    // An integer range only SQL Server has: tinyint.
    await expect(insert([{ name: 'tenant_id', type: { kind: 'integer', min: '0', max: '255' }, value: '1' }])).rejects.toThrow(/No PostgreSQL integer type/)
    await expect(records.update({ ...updateOf('1', '1', 'x'), target: { ...ORDER, concurrency: { kind: 'rowversion', column: 'row_version' } } })).rejects.toThrow(/rowversion/)
    await expect(records.read({ target: { ...ORDER, table: { schema: 'sales', name: '' } }, key: orderKey('1'), columns: [], filters: TENANT_1 })).rejects.toThrow(/non-empty/)
    await expect(records.read({ target: { ...ORDER, table: { schema: 'sales', name: 'or\u0000der' } }, key: orderKey('1'), columns: [], filters: TENANT_1 })).rejects.toThrow(/NUL/)
  })

  // An identity is a key by construction (0009). One that is not would make
  // a read pick one of several rows; it is refused instead.
  test('an identity that matches several rows is thrown, not read', async () => {
    await owner.unsafe('insert into rec.guarded values (10, 5), (11, 5)')
    const byAmount: RecordTarget = { table: { schema: 'rec', name: 'guarded' }, identity: [col('guarded', 'amount')], concurrency: null }
    const request = { target: byAmount, key: [val('guarded', 'amount', '5')], columns: [col('guarded', 'id')], filters: EVERY_ROW }
    await expect(createPostgresRecords(owner).read(request)).rejects.toThrow(/not a key/)
  })

  // Class 42 is syntax errors and access rules. Beyond the ones a database
  // change explains, it is SQL this adapter cannot have meant — here a
  // sequence where a table should be — and it is thrown, not answered.
  test('a class-42 refusal that no schema change explains is thrown', async () => {
    const sequence: RecordTarget = { table: { schema: 'sales', name: 'order_id_seq' }, identity: [ORDER_ID], concurrency: null }
    const lastValue: RecordValue = { name: 'last_value', type: INT64, value: '5' }
    await expect(createPostgresRecords(owner).insert({ target: sequence, values: [lastValue], returning: [] })).rejects.toMatchObject({ code: '42809' })
  })

  // A row transform still runs on raw rows. One that rewrites them would
  // hand this adapter something other than the server's text; it is
  // refused rather than read.
  test('a driver whose row transform rewrites rows is refused, not read', async () => {
    const request = { target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [col('order', 'status')], filters: TENANT_1 }
    const asObjects = postgres(fixture.admin, { onnotice: () => {}, transform: { row: { from: (row: unknown) => ({ row }) } } })
    const asText = postgres(fixture.admin, { onnotice: () => {}, transform: { row: { from: (row: unknown) => (Array.isArray(row) ? row.map(String) : row) } } })
    try {
      await expect(createPostgresRecords(asObjects).read(request)).rejects.toThrow(/changed a raw row/)
      await expect(createPostgresRecords(asText).read(request)).rejects.toThrow(/changed a raw value/)
    } finally {
      await Promise.all([asObjects.end(), asText.end()])
    }
  })
})

describe('a connection lost after a write was sent', () => {
  // The case plan section 12 names: the write reached the server, the answer
  // never reached us. The proxy is a real TCP hop that is cut while the
  // update waits on a row lock; when the lock is released the orphaned
  // statement commits. "Unavailable" would invite a retry of a write that
  // happened; this is unknown-outcome, and the version moved exactly once.
  test('an update is unknown-outcome, may still commit, and is never retried', async () => {
    const { id, version } = await newOrder('before the cut')
    const proxy = await startProxy()
    const viaProxy = postgres({ ...connectionOf(fixture.admin), host: '127.0.0.1', port: proxy.port, max: 1, onnotice: () => {} })
    try {
      await viaProxy`select 1`
      const held = await whileLocked(id, async () => {
        const pending = createPostgresRecords(viaProxy).update(updateOf(id, version, 'sent, then cut'))
        await waitUntilBlocked(1)
        proxy.cut()
        return { pending }
      })
      expect(failed(await held.pending).code).toBe('unknown-outcome')
      await eventually(async () => expect(await notesOf(id)).toEqual({ notes: 'sent, then cut', row_version: String(BigInt(version) + 1n) }))
    } finally {
      await viaProxy.end({ timeout: 1 })
      await proxy.close()
    }
  })

  // An insert has no version to make a retry harmless: a second attempt is a
  // second order. Its foreign-key check waits on a customer row another
  // connection holds; cut there, the insert has been executed by the server
  // and commits when the lock goes, and exactly one order exists.
  test('an insert is unknown-outcome, may still commit, and exactly one row is written', async () => {
    const proxy = await startProxy()
    const viaProxy = postgres({ ...connectionOf(fixture.admin), host: '127.0.0.1', port: proxy.port, max: 1, onnotice: () => {} })
    try {
      await viaProxy`select 1`
      const held = await owner.begin(async (tx) => {
        await tx`select name from sales.customer where tenant_id = 1 and customer_no = 1001 for update`
        const pending = createPostgresRecords(viaProxy).insert({ target: ORDER, values: orderValues({ notes: 'inserted, then cut' }), returning: [col('order', 'id')] })
        await waitUntilBlocked(1)
        proxy.cut()
        return { pending }
      })
      expect(failed(await held.pending).code).toBe('unknown-outcome')
      await eventually(async () => {
        const [count] = await owner<{ n: number }[]>`select count(*)::int as n from sales."order" where notes = 'inserted, then cut'`
        expect(count?.n).toBe(1)
      })
    } finally {
      await viaProxy.end({ timeout: 1 })
      await proxy.close()
    }
  })

  // Why the adapter cannot do better than "unknown". postgres.js sends a
  // statement with untyped parameters in two round trips: Parse and
  // Describe, then Bind and Execute once the server has said what the
  // parameters are. A table lock blocks the insert while it is being
  // parsed, so when the connection is cut the server has the text and not
  // the values, and nothing is written. From the client the two cuts look
  // the same; only the server knows which one this was.
  test('a cut while the server is still parsing writes nothing, and is unknown-outcome all the same', async () => {
    const proxy = await startProxy()
    const viaProxy = postgres({ ...connectionOf(fixture.admin), host: '127.0.0.1', port: proxy.port, max: 1, onnotice: () => {} })
    try {
      const [backend] = await viaProxy<{ pid: number }[]>`select pg_backend_pid() as pid`
      const held = await owner.begin(async (tx) => {
        await tx`lock table sales."order" in share mode`
        const pending = createPostgresRecords(viaProxy).insert({ target: ORDER, values: orderValues({ notes: 'cut while parsed' }), returning: [] })
        await waitUntilBlocked(1)
        proxy.cut()
        return { pending }
      })
      expect(failed(await held.pending).code).toBe('unknown-outcome')
      // The orphaned backend finishes parsing, fails to answer, and exits;
      // only once it has gone is "nothing was written" a fact.
      await eventually(async () => {
        const [orphans] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where pid = ${backend?.pid ?? 0}`
        expect(orphans?.n).toBe(0)
      })
      const [count] = await owner<{ n: number }[]>`select count(*)::int as n from sales."order" where notes = 'cut while parsed'`
      expect(count?.n).toBe(0)
    } finally {
      await viaProxy.end({ timeout: 1 })
      await proxy.close()
    }
  })
})

describe('a connection lost during a read', () => {
  // A read changes nothing, so a lost answer is only an answer that did not
  // arrive: unavailable, and safe to ask again.
  test('is unavailable', async () => {
    const proxy = await startProxy()
    const viaProxy = postgres({ ...connectionOf(fixture.admin), host: '127.0.0.1', port: proxy.port, max: 1, onnotice: () => {} })
    try {
      await viaProxy`select 1`
      const held = await owner.begin(async (tx) => {
        await tx`lock table sales."order" in access exclusive mode`
        const pending = createPostgresRecords(viaProxy).read({ target: ORDER, key: orderKey(EDGE_VALUES.beyondSafeInteger), columns: [col('order', 'status')], filters: TENANT_1 })
        await waitUntilBlocked(1)
        proxy.cut()
        return { pending }
      })
      expect(failed(await held.pending).code).toBe('unavailable')
    } finally {
      await viaProxy.end({ timeout: 1 })
      await proxy.close()
    }
  })
})

/**
 * Runs `work` while another connection holds a lock on the order, and
 * releases it when `work` returns. What `work` starts and returns in an
 * object is awaited by the caller, after the lock is gone; a promise returned
 * bare would be awaited by the transaction, which would wait for itself.
 */
async function whileLocked<T extends object>(id: string, work: () => Promise<T>): Promise<T> {
  return owner.begin(async (tx) => {
    await tx`select id from sales."order" where id = ${id} for update`
    return work()
  }) as Promise<T>
}

/** Waits until `count` backends are blocked by another, so a race is a race and not a sequence. */
async function waitUntilBlocked(count: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`
    if ((row?.n ?? 0) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${String(count)} statements never queued behind the lock`)
}

/** Retries an assertion for a few seconds: the orphaned statement commits on the server's schedule, not ours. */
async function eventually(assertion: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      if (attempt === 100) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

function connectionOf(uri: string): { username: string; password: string; database: string } {
  const url = new URL(uri)
  return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) }
}

/** A port nothing listens on: bound, read, released. */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/**
 * The shared TCP hop (`@formancy/data-fixtures`) in front of the container.
 * Not a mock: every byte is the real driver's and the real server's. Its
 * `cut()` destroys both sides of every connection, which is what a dropped
 * network does.
 */
async function startProxy(): Promise<TcpHop> {
  const target = new URL(fixture.admin)
  return startTcpHop({ host: target.hostname, port: Number(target.port) })
}
