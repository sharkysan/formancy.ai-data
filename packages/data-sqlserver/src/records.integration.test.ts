import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ApiValue, MetadataSnapshot, ObjectMeta, ObjectRef, RecordAdapter, RecordColumn, RecordOutcome, RecordTarget, RecordValue, RowFilters, UpdateRequest } from '@formancy/data-core'
import { codecFor, findObject } from '@formancy/data-core'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { EDGE_VALUES, startSqlServerFixture } from '@formancy/data-fixtures'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/**
 * The record half of the port against REAL SQL Server, loaded with the shared
 * fixture: reads, inserts and guarded updates, as the owner and as
 * `formancy_reader`. Refusals — constraints, permissions, a schema that moved,
 * a connection that failed — are in records-failures.integration.test.ts.
 *
 * Targets and columns are taken from the discovered snapshot, as the server
 * will take them from approved bindings: every identifier the adapter quotes
 * came from the catalog.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let reader: mssql.ConnectionPool
let snapshot: MetadataSnapshot

const ORDER: ObjectRef = { schema: 'sales', name: 'order' }
const CUSTOMER: ObjectRef = { schema: 'sales', name: 'customer' }
const ORDER_LINE: ObjectRef = { schema: 'sales', name: 'order_line' }
const COUNTRY: ObjectRef = { schema: 'sales', name: 'country' }
const KINDS: ObjectRef = { schema: 'ops', name: 'kinds' }
const VERSIONED: ObjectRef = { schema: 'ops', name: 'versioned' }
const AUDITED: ObjectRef = { schema: 'ops', name: 'audited' }
const HEAP: ObjectRef = { schema: 'ops', name: 'heap' }
const FIXTURE_ORDER = EDGE_VALUES.beyondSafeInteger

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  reader = await new mssql.ConnectionPool(fixture.reader).connect()
  // Tables for what the fixture does not hold: every other kind a codec reads,
  // an application-maintained version column, a trigger, and a table whose
  // "identity" is not unique. Constants of this file, so they are spliced.
  await owner.request().batch('create schema ops')
  await owner.request().batch(`
    create table ops.kinds (id int not null constraint pk_kinds primary key, f float null, r real null, m money null,
      t time null, ts datetime2 null, dto datetimeoffset(3) null, u uniqueidentifier null, b bit null, tiny tinyint null);
    create table ops.versioned (id int not null constraint pk_versioned primary key, tenant_id int not null,
      note nvarchar(50) null, version int not null constraint df_versioned_version default 0);
    create table ops.audited (id int identity(1, 1) not null constraint pk_audited primary key, note nvarchar(50) not null);
    create table ops.audit_log (audited_id int not null);
    create table ops.heap (tenant_id int not null, note nvarchar(50) null, version int not null constraint df_heap_version default 0);
    create table ops.defaults (id int identity(1, 1) not null constraint pk_defaults primary key,
      label nvarchar(20) not null constraint df_defaults_label default N'unnamed')`)
  await owner.request().batch(`create trigger ops.audited_insert on ops.audited after insert as
    begin set nocount on; insert into ops.audit_log (audited_id) select id from inserted; end`)
  await owner.request().batch(`
    insert into ops.kinds (id, f, r, m, t, ts, dto, u, b, tiny) values
      (1, 0.1, 0.1, 12.3456, '12:34:56.789', '2026-10-08T12:34:56.789', '2026-10-08T23:59:59.999+02:00',
       'A9E732BB-C26E-4BE6-9752-477E208C0CDC', 1, 255);
    insert into ops.versioned (id, tenant_id, note) values (1, 1, N'start'), (2, 1, N'raced');
    insert into ops.heap (tenant_id, note) values (1, N'one'), (1, N'two')`)
  // A table whose columns are widened after discovery, and one a tampered
  // type would write into if it became SQL.
  await owner.request().batch(`
    create table ops.widened (id int not null constraint pk_widened primary key, name nvarchar(10) null, amount decimal(18, 4) null);
    insert into ops.widened (id, name, amount) values (1, N'Muster AG', 1.2346);
    create table ops.victim (note nvarchar(100) not null)`)
  await owner.request().batch(`create table ops.tenanted (id int not null constraint pk_tenanted primary key, tenant nvarchar(20) not null, note nvarchar(50) null);
    insert into ops.tenanted (id, tenant, note) values (1, N'ACME', N'upper'), (2, N'acme', N'lower')`)
  // Rows an AFTER trigger touches again: an audit count beside a rowversion,
  // keyed by an identity and by text under a collation that is not the
  // database's, and a version column the application's own trigger moves too.
  await owner.request().batch(`
    create table ops.stamped (id int identity(1, 1) not null constraint pk_stamped primary key, note nvarchar(50) null,
      touched int not null constraint df_stamped_touched default 0, row_version rowversion not null);
    create table ops.coded (code varchar(10) collate Latin1_General_100_BIN2 not null constraint pk_coded primary key, note nvarchar(50) null,
      touched int not null constraint df_coded_touched default 0, row_version rowversion not null);
    create table ops.counted (id int not null constraint pk_counted primary key, note nvarchar(50) null,
      version int not null constraint df_counted_version default 0);
    insert into ops.counted (id, note) values (1, N'start');
    create table ops.timed (at time(0) not null constraint df_timed_at default '09:30:15' constraint pk_timed primary key,
      note nvarchar(20) null, row_version rowversion not null);
    insert into ops.timed (at, note) values ('09:30:00', N'whole minute')`)
  await owner.request().batch(`create trigger ops.stamped_touch on ops.stamped after insert, update as
    begin set nocount on; update s set touched = s.touched + 1 from ops.stamped as s join inserted as i on i.id = s.id; end`)
  await owner.request().batch(`create trigger ops.coded_touch on ops.coded after insert, update as
    begin set nocount on; update c set touched = c.touched + 1 from ops.coded as c join inserted as i on i.code = c.code; end`)
  await owner.request().batch(`create trigger ops.counted_version on ops.counted after update as
    begin set nocount on; update c set version = c.version + 1 from ops.counted as c join inserted as i on i.id = c.id; end`)
  snapshot = await discoverSqlServer(owner, { schemas: ['sales', 'ops'] })
})

afterAll(async () => {
  await reader?.close()
  await owner?.close()
  await fixture?.stop()
})

function meta(ref: ObjectRef): ObjectMeta {
  const found = findObject(snapshot, ref)
  if (found === undefined) throw new Error(`${ref.schema}.${ref.name} is not in the snapshot`)
  return found
}

function columnOf(ref: ObjectRef, name: string): RecordColumn {
  const found = meta(ref).columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`${ref.name} has no column ${name}`)
  return { name, type: found.type }
}

/** Every column a form could show: everything with a canonical value, which a rowversion is not. */
function readable(ref: ObjectRef): RecordColumn[] {
  return meta(ref)
    .columns.filter((column) => !['rowversion', 'binary', 'unsupported'].includes(column.type.kind))
    .map((column) => ({ name: column.name, type: column.type }))
}

/** As bindings describe a table: its primary key, and its rowversion when it has one. */
function target(ref: ObjectRef, versionColumn?: string): RecordTarget {
  const object = meta(ref)
  const rowversion = object.columns.find((column) => column.type.kind === 'rowversion')
  return {
    table: ref,
    identity: (object.primaryKey?.columns ?? []).map((name) => columnOf(ref, name)),
    concurrency:
      versionColumn !== undefined
        ? { kind: 'version-column', column: versionColumn }
        : rowversion === undefined
          ? null
          : { kind: 'rowversion', column: rowversion.name },
  }
}

const valueOf = (ref: ObjectRef, name: string, value: ApiValue): RecordValue => ({ ...columnOf(ref, name), value })
const tenant = (value: string): RowFilters => ({ kind: 'restricted', equal: [{ column: 'tenant_id', value }] })
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }

function ok(outcome: RecordOutcome): Extract<RecordOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected a record, got ${outcome.code}: ${outcome.message}`)
  return outcome
}

async function readOrder(records: RecordAdapter, id: string = FIXTURE_ORDER, filters: RowFilters = tenant('1')): Promise<RecordOutcome> {
  return records.read({ target: target(ORDER), key: [valueOf(ORDER, 'id', id)], columns: readable(ORDER), filters })
}

function orderUpdate(set: RecordValue[], expectedVersion: string, filters: RowFilters = tenant('1')): UpdateRequest {
  const orderTarget = target(ORDER)
  if (orderTarget.concurrency === null) throw new Error('sales.order has a rowversion')
  return {
    target: { ...orderTarget, concurrency: orderTarget.concurrency },
    key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
    set,
    expectedVersion,
    filters,
    returning: [columnOf(ORDER, 'notes'), columnOf(ORDER, 'status')],
  }
}

/**
 * Two updates sent while a third connection holds the row they name, so both
 * are waiting inside SQL Server, with the same expected version, before
 * either runs; then the row is released and their outcomes returned. Each
 * update gets a pool of one connection, so its session is the one it uses.
 */
async function race(hold: (request: mssql.Request) => Promise<unknown>, update: (records: RecordAdapter, index: number) => Promise<RecordOutcome>): Promise<RecordOutcome[]> {
  const pools = await Promise.all([1, 2, 3].map(() => new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()))
  const [first, second, holder] = pools
  if (first === undefined || second === undefined || holder === undefined) throw new Error('three pools were asked for')
  try {
    const [one, two] = await Promise.all([first, second].map(async (pool) => (await pool.request().query<{ id: number }>('select @@spid as id')).recordset[0]?.id))
    const transaction = new mssql.Transaction(holder)
    await transaction.begin()
    await hold(new mssql.Request(transaction))
    const racing = [first, second].map((pool, index) => update(createSqlServerRecords(pool), index))
    for (let attempt = 0; ; attempt += 1) {
      // Blocked by the holder, or the second queued behind the first: either way, inside the server and waiting.
      const waiting = await owner
        .request()
        .input('one', mssql.Int, one)
        .input('two', mssql.Int, two)
        .query<{ n: number }>('select count(*) as n from sys.dm_exec_requests where session_id in (@one, @two) and blocking_session_id <> 0')
      if (waiting.recordset[0]?.n === 2) break
      if (attempt === 200) throw new Error('the two updates never both waited on the held row')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    await transaction.commit()
    return await Promise.all(racing)
  } finally {
    await Promise.all(pools.map((pool) => pool.close()))
  }
}

/**
 * Whether every value read is the canonical one: what `codecFor(column).parse`
 * returns when handed it. A column the codec will not write — an identity, a
 * computed column, a zoneless timestamp — is left out, because it has no
 * `parse` to agree with.
 */
function canonicalDisagreements(ref: ObjectRef, values: Record<string, ApiValue>): string[] {
  return Object.entries(values).flatMap(([name, value]) => {
    const column = meta(ref).columns.find((candidate) => candidate.name === name)
    if (column === undefined) return [`${name} is not a column`]
    const codec = codecFor(column)
    if (codec.status !== 'editable') return []
    const parsed = codec.parse(value)
    return parsed.ok && parsed.value === value ? [] : [`${name}: ${JSON.stringify(value)} is not what its codec returns`]
  })
}

describe('reading a record', () => {
  // The values the plan says must survive: 2^53 + 1, the largest numeric(18,4),
  // a date without a zone, both credit-limit extremes, and a computed 0.30 that
  // binary floating point would make 0.30000000000000004. Read through the
  // driver's own parsing, the amount becomes 100000000000000 and the date
  // midnight UTC (the spike); converted to text by the server, none moves.
  test('every edge value reads back exactly, as its codec spells it', async () => {
    const records = createSqlServerRecords(owner)
    const order = ok(await readOrder(records))
    expect(order.values).toEqual({
      id: EDGE_VALUES.beyondSafeInteger,
      tenant_id: '1',
      customer_no: '1001',
      order_date: EDGE_VALUES.orderDate,
      status: 'placed',
      amount: EDGE_VALUES.largestAmount,
      notes: null,
      group: 'A',
      created_by: '1',
      approved_by: null,
    })
    expect(order.version).toMatch(/^[0-9a-f]{16}$/)
    expect(canonicalDisagreements(ORDER, order.values)).toEqual([])

    const customer = async (tenantId: string) =>
      ok(
        await records.read({
          target: target(CUSTOMER),
          key: [valueOf(CUSTOMER, 'tenant_id', tenantId), valueOf(CUSTOMER, 'customer_no', '1001')],
          columns: readable(CUSTOMER),
          filters: tenant(tenantId),
        }),
      )
    const [muster, other] = await Promise.all([customer('1'), customer('2')])
    expect(muster.values).toMatchObject({ credit_limit: EDGE_VALUES.largestCreditLimit, active: true, country_code: 'CH', name: 'Muster AG' })
    expect(other.values).toMatchObject({ credit_limit: EDGE_VALUES.smallestCreditLimit, active: false, country_code: 'DE' })
    // created_at defaults to sysdatetimeoffset(): an instant in UTC, to the second.
    expect(muster.values.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(muster.version).toBeNull()
    expect([...canonicalDisagreements(CUSTOMER, muster.values), ...canonicalDisagreements(CUSTOMER, other.values)]).toEqual([])

    const line = ok(
      await records.read({
        target: target(ORDER_LINE),
        key: [valueOf(ORDER_LINE, 'order_id', FIXTURE_ORDER), valueOf(ORDER_LINE, 'line_no', '1')],
        columns: readable(ORDER_LINE),
        filters: EVERY_ROW,
      }),
    )
    expect(line.values).toEqual({ order_id: FIXTURE_ORDER, line_no: '1', quantity: '3', unit_price: '0.10', line_total: EDGE_VALUES.computedLineTotal })
  })

  // The kinds the fixture does not hold, each as its codec spells it: a float
  // as the double it is, a real as the double its 32 bits are, money to four
  // places (its own default conversion rounds to two), a uuid in lower case,
  // an instant in UTC. A time keeps its minutes and an instant its seconds:
  // formancy's shapes cannot hold more, and what is cut off is said in 0017.
  test('every other kind reads as its codec spells it, and what the shapes cannot hold is cut off', async () => {
    const records = createSqlServerRecords(owner)
    const kinds = ok(await records.read({ target: target(KINDS), key: [valueOf(KINDS, 'id', '1')], columns: readable(KINDS), filters: EVERY_ROW }))
    expect(kinds.values).toEqual({
      id: '1',
      f: 0.1,
      r: 0.10000000149011612,
      m: '12.3456',
      t: '12:34',
      ts: '2026-10-08T12:34:56',
      dto: '2026-10-08T21:59:59Z',
      u: 'a9e732bb-c26e-4be6-9752-477e208c0cdc',
      b: true,
      tiny: '255',
    })
    expect(canonicalDisagreements(KINDS, kinds.values)).toEqual([])
  })

  // A column widened since the snapshot was taken reads back exactly: text as
  // nvarchar(max), a decimal by its own type, never through the length or the
  // scale the snapshot remembers, which CONVERT truncates and rounds to
  // without a word. Measured: nvarchar(10) widened to 40 read 'Muster AG,'
  // for 'Muster AG, Zurich branch', and decimal(18,4) widened to (18,6) read
  // 1.2346 for 1.234567. PostgreSQL reads ::text, which loses nothing, and the
  // engines must not disagree about what a row holds.
  test('a column widened since the snapshot reads back exactly, not at the snapshot’s width', async () => {
    const records = createSqlServerRecords(owner)
    const widened: ObjectRef = { schema: 'ops', name: 'widened' }
    const columns = [columnOf(widened, 'name'), columnOf(widened, 'amount')]
    expect(columns.map((column) => column.type)).toMatchObject([
      { kind: 'text', maxLength: 10 },
      { kind: 'decimal', precision: 18, scale: 4 },
    ])
    await owner.request().batch('alter table ops.widened alter column name nvarchar(40) null; alter table ops.widened alter column amount decimal(18, 6) null')
    await owner.request().batch("update ops.widened set name = N'Muster AG, Zurich branch', amount = 1.234567")
    expect(await records.read({ target: target(widened), key: [valueOf(widened, 'id', '1')], columns, filters: EVERY_ROW })).toEqual({
      ok: true,
      values: { name: 'Muster AG, Zurich branch', amount: '1.234567' },
      version: null,
    })
  })

  // A filter is an equality with a trusted value (0011), compared code point by
  // code point and not by the column's collation: under this database's
  // case-insensitive collation the tenant 'acme' would otherwise read the rows
  // of 'ACME', which an application may hold to be another tenant.
  test("a text filter matches its value exactly, not by the column's collation", async () => {
    const records = createSqlServerRecords(owner)
    const tenanted: ObjectRef = { schema: 'ops', name: 'tenanted' }
    const acme: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant', value: 'acme' }] }
    const read = (id: string) => records.read({ target: target(tenanted), key: [valueOf(tenanted, 'id', id)], columns: [columnOf(tenanted, 'note')], filters: acme })
    expect(await read('1')).toMatchObject({ ok: false, code: 'not-found' })
    expect(await read('2')).toEqual({ ok: true, values: { note: 'lower' }, version: null })
  })

  // Not-found is not forbidden (0015): another tenant's order and an order
  // that does not exist get the same answer, word for word, so the answer
  // discloses nothing about rows outside the filters.
  test('a record outside the filters is not-found, exactly as one that does not exist', async () => {
    const records = createSqlServerRecords(owner)
    const otherTenant = await readOrder(records, FIXTURE_ORDER, tenant('2'))
    const missing = await readOrder(records, '1', tenant('1'))
    expect(otherTenant).toMatchObject({ ok: false, code: 'not-found' })
    expect(otherTenant).toEqual(missing)
  })

  // The restricted reader is the configuration the plan recommends. It reads
  // sales.order exactly as the owner does, and sales.customer — which it may
  // not read — is a refusal with a code, never an exception or an empty record.
  test('the restricted reader reads sales.order, and is refused sales.customer as permission-denied', async () => {
    const asReader = createSqlServerRecords(reader)
    const asOwner = createSqlServerRecords(owner)
    expect(await readOrder(asReader)).toEqual(await readOrder(asOwner))
    const customer = await asReader.read({
      target: target(CUSTOMER),
      key: [valueOf(CUSTOMER, 'tenant_id', '1'), valueOf(CUSTOMER, 'customer_no', '1001')],
      columns: readable(CUSTOMER),
      filters: tenant('1'),
    })
    expect(customer).toMatchObject({ ok: false, code: 'permission-denied' })
  })
})

describe('inserting a record', () => {
  // The insert writes only what it is given, so the identity and the default
  // come from the database, and reading them back is the only way to learn
  // them. The fixture's order is 2^53 + 1, so the next identity is 2^53 + 2:
  // a JavaScript number cannot even tell the two apart.
  test('an insert into sales.order returns its identity and its default status', async () => {
    const records = createSqlServerRecords(owner)
    const inserted = ok(
      await records.insert({
        target: target(ORDER),
        values: [valueOf(ORDER, 'tenant_id', '1'), valueOf(ORDER, 'customer_no', '1001'), valueOf(ORDER, 'order_date', '2026-10-09'), valueOf(ORDER, 'amount', '12.5000')],
        returning: [columnOf(ORDER, 'id'), columnOf(ORDER, 'status'), columnOf(ORDER, 'amount')],
      }),
    )
    expect(inserted.values).toEqual({ id: '9007199254740994', status: 'draft', amount: '12.5000' })
    expect(inserted.version).toMatch(/^[0-9a-f]{16}$/)
    const read = ok(await readOrder(records, '9007199254740994'))
    expect(read.version).toBe(inserted.version)
  })

  // Why every value is bound as text: the driver's typed decimal parameter
  // goes through a JavaScript number, rounding the last digit of one value and
  // refusing the largest outright. Bound as text and converted by the server,
  // both are written digit for digit.
  test("exact decimals are written exactly, where the driver's decimal parameter rounds them", async () => {
    const value = '1234567890123.4567'
    const byDriver = await owner
      .request()
      .input('amount', mssql.Decimal(18, 4), value)
      .query<{ amount: string }>('select convert(nvarchar(40), @amount) as amount')
    expect(byDriver.recordset[0]?.amount).toBe('1234567890123.4568')

    const records = createSqlServerRecords(owner)
    for (const amount of [value, EDGE_VALUES.largestAmount]) {
      const inserted = ok(
        await records.insert({
          target: target(ORDER),
          values: [valueOf(ORDER, 'tenant_id', '1'), valueOf(ORDER, 'customer_no', '1001'), valueOf(ORDER, 'order_date', '2026-10-09'), valueOf(ORDER, 'amount', amount)],
          returning: [columnOf(ORDER, 'amount')],
        }),
      )
      expect(inserted.values.amount).toBe(amount)
    }
  })

  // SQL Server refuses `OUTPUT` without `INTO` on a table with an enabled
  // trigger (error 334), and audit triggers are common in the databases this
  // module is pointed at. The insert must still return what it wrote.
  test('a table with a trigger still returns what was inserted', async () => {
    const records = createSqlServerRecords(owner)
    const inserted = ok(
      await records.insert({
        target: { table: AUDITED, identity: [columnOf(AUDITED, 'id')], concurrency: null },
        values: [valueOf(AUDITED, 'note', 'audited')],
        returning: [columnOf(AUDITED, 'id'), columnOf(AUDITED, 'note')],
      }),
    )
    expect(inserted).toEqual({ ok: true, values: { id: '1', note: 'audited' }, version: null })
    const log = await owner.request().query<{ n: number }>('select count(*) as n from ops.audit_log')
    expect(log.recordset[0]?.n).toBe(1)
  })
})

describe('writing every kind', () => {
  // Each kind is bound its own way — text the server converts, a boolean and a
  // float as themselves — and each has to come back as the value that was
  // sent, or a save followed by a read reports a change nobody made. The
  // largest money fits only because it travels as decimal(19,4) text; NULL is
  // a typed NULL for every kind.
  test('every kind a codec writes reads back as it was written, NULL included', async () => {
    const records = createSqlServerRecords(owner)
    const writable = readable(KINDS).filter((column) => column.name !== 'ts')
    const sent: Record<string, ApiValue> = {
      id: '2',
      f: 0.1,
      r: 0.5,
      m: '922337203685477.5807',
      t: '23:59',
      dto: '2026-10-08T12:34:56Z',
      u: 'a9e732bb-c26e-4be6-9752-477e208c0cdc',
      b: false,
      tiny: '0',
    }
    const written = await records.insert({ target: target(KINDS), values: writable.map((column) => ({ ...column, value: sent[column.name] ?? null })), returning: writable })
    expect(ok(written).values).toEqual(sent)
    const empty = await records.insert({
      target: target(KINDS),
      values: writable.map((column) => ({ ...column, value: column.name === 'id' ? '3' : null })),
      returning: writable,
    })
    expect(ok(empty).values).toEqual(Object.fromEntries(writable.map((column) => [column.name, column.name === 'id' ? '3' : null])))
  })

  // An insert of no values is DEFAULT VALUES: every column takes its default
  // or its identity, which is what a form with nothing to say asks for. Its
  // batch sets `xact_abort` and `nocount`, and the next request on the same
  // connection must see neither, or every later request on it would fail
  // differently. Even with no parameter it is sent as `sp_executesql`, whose
  // settings end with it; a plain batch's stay on the session, which the
  // control shows the probe can see.
  test('an insert of no values takes every default, and leaves no setting on the connection', async () => {
    const single = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
    const settings = async (request: mssql.Request) =>
      (await request.query<{ settings: number }>('select @@options & (16384 | 512) as settings')).recordset[0]?.settings
    try {
      const defaults: ObjectRef = { schema: 'ops', name: 'defaults' }
      expect(await createSqlServerRecords(single).insert({ target: target(defaults), values: [], returning: readable(defaults) })).toEqual({
        ok: true,
        values: { id: '1', label: 'unnamed' },
        version: null,
      })
      expect(await settings(single.request())).toBe(0)
      const pinned = new mssql.Transaction(single)
      await pinned.begin()
      await new mssql.Request(pinned).batch('set xact_abort on; set nocount on')
      expect(await settings(new mssql.Request(pinned))).toBe(16384 | 512)
      await pinned.rollback()
    } finally {
      await single.close()
    }
  })

  // A decimal's precision and scale are spliced into the statement —
  // `convert(decimal(18, 4), @p0)` — because SQL Server takes no parameter
  // there. They come from approved bindings, and a bundle altered where it is
  // stored must not become SQL: a precision of `19, 4), @p1)); insert …; --`
  // ran its insert, and committed it with the write.
  test('a tampered decimal type is refused before it is spliced, and runs nothing', async () => {
    const records = createSqlServerRecords(owner)
    const precision = "19, 4), @p1)); insert into ops.victim (note) values (N'precision'); --" as unknown as number
    const tampered = records.insert({
      target: target(KINDS),
      values: [valueOf(KINDS, 'id', '9'), { name: 'm', type: { kind: 'decimal', precision, scale: 4 }, value: '1.0000' }],
      returning: [],
    })
    await expect(tampered).rejects.toThrow(/precision is 1 to 38/)
    const victims = await owner.request().query<{ n: number }>('select count(*) as n from ops.victim')
    expect(victims.recordset[0]?.n).toBe(0)
  })

  // A request no codec or binding could have produced — a key that is not the
  // identity, a column with no canonical value, a value of the wrong type, a
  // zoneless timestamp written as an instant, a column named twice, the
  // concurrency column set by hand, a name no catalog holds, a PostgreSQL-only
  // type — is a programming error. It is thrown before anything is sent: the
  // pool here is closed, and a request that reached it would come back as
  // `unavailable` instead.
  test('a request no codec could have produced is thrown before anything is sent', async () => {
    const closed = await new mssql.ConnectionPool(fixture.admin).connect()
    await closed.close()
    const records = createSqlServerRecords(closed)
    const orderKey = [valueOf(ORDER, 'id', FIXTURE_ORDER)]
    const read = (overrides: Partial<Parameters<RecordAdapter['read']>[0]>) =>
      records.read({ target: target(ORDER), key: orderKey, columns: [columnOf(ORDER, 'status')], filters: EVERY_ROW, ...overrides })
    const insert = (values: RecordValue[]) => records.insert({ target: target(ORDER), values, returning: [] })

    await expect(read({ key: [valueOf(ORDER, 'tenant_id', '1')] })).rejects.toThrow(/names exactly its identity/)
    await expect(read({ key: [...orderKey, ...orderKey] })).rejects.toThrow(/names exactly its identity/)
    await expect(read({ target: { ...target(ORDER), identity: [] }, key: [] })).rejects.toThrow(/names exactly its identity/)
    await expect(read({ columns: [{ name: 'flag', type: { kind: 'binary', maxLength: null } }] })).rejects.toThrow(/no canonical API value/)
    await expect(read({ filters: { kind: 'restricted', equal: [] } as unknown as RowFilters })).rejects.toThrow(/Row filters are/)
    await expect(read({ columns: [{ name: '', type: { kind: 'boolean' } }] })).rejects.toThrow(/An identifier is/)
    await expect(insert([valueOf(ORDER, 'amount', 12.5)])).rejects.toThrow(/not the canonical value/)
    await expect(insert([valueOf(ORDER, 'tenant_id', 2 ** 53)])).rejects.toThrow(/not the canonical value/)
    await expect(records.insert({ target: target(COUNTRY), values: [valueOf(COUNTRY, 'flag', 'ff')], returning: [] })).rejects.toThrow(/no canonical API value/)
    await expect(insert([valueOf(ORDER, 'amount', '1.0000'), valueOf(ORDER, 'amount', '2.0000')])).rejects.toThrow(/each column once/)
    await expect(insert([{ ...columnOf(KINDS, 'ts'), value: '2026-10-08T12:34:56Z' }])).rejects.toThrow(/no canonical API value/)
    await expect(insert([{ name: 'amount', type: { kind: 'decimal', precision: null, scale: null }, value: '1' }])).rejects.toThrow(/precision and a scale/)
    // A decimal's precision and scale are spliced where SQL Server takes no
    // parameter, so one its syntax would not accept, or one that is not a
    // number at all, is refused rather than sent.
    for (const [precision, scale] of [
      [39, 4],
      [0, 0],
      [18, -1],
      [4, 5],
      [18.5, 4],
      ['18', 4],
    ] as const) {
      await expect(insert([{ name: 'amount', type: { kind: 'decimal', precision: precision as number, scale }, value: '1' }])).rejects.toThrow(/precision is 1 to 38/)
    }
    await expect(insert([{ name: 'id', type: { kind: 'integer', min: '0', max: '99999999999999999999' }, value: '1' }])).rejects.toThrow(/No SQL Server integer type/)
    await expect(records.update(orderUpdate([], '0000000000000001'))).rejects.toThrow(/at least one column/)
    await expect(records.update(orderUpdate([{ name: 'row_version', type: { kind: 'text', maxLength: 16, fixedLength: true }, value: 'x' }], '0000000000000001'))).rejects.toThrow(
      /concurrency column/,
    )
    // And the same closed pool, asked something well-formed — a safe integer may
    // arrive as a number — answers with a failure rather than a throw.
    expect(await read({})).toMatchObject({ ok: false, code: 'unavailable' })
    expect(await insert([valueOf(ORDER, 'tenant_id', 1)])).toMatchObject({ ok: false, code: 'unavailable' })
  })
})

describe('updating a record', () => {
  // The update names the key, the filters and the version it read in one
  // statement, and returns what it wrote with the version a next update needs.
  test('changes exactly what it sets, and returns the new version', async () => {
    const records = createSqlServerRecords(owner)
    const before = ok(await readOrder(records))
    const updated = ok(await records.update(orderUpdate([valueOf(ORDER, 'notes', 'first edit')], before.version ?? '')))
    expect(updated.values).toEqual({ notes: 'first edit', status: before.values.status })
    expect(updated.version).toMatch(/^[0-9a-f]{16}$/)
    expect(updated.version).not.toBe(before.version)
    const after = ok(await readOrder(records))
    expect(after).toEqual({ ...before, values: { ...before.values, notes: 'first edit' }, version: updated.version })
  })

  // The lost update the plan forbids, as a race and not a sequence: both
  // writers are sent while a third connection holds the row, so both are
  // waiting inside SQL Server with the same expected version. When the row is
  // released, one commits; the other re-reads the row, finds the version
  // changed, and changes nothing. Without the version in the WHERE, the second
  // would overwrite the first.
  test('of two concurrent updates with the same version, one wins, one is stale, and the winner’s change remains', async () => {
    const before = ok(await readOrder(createSqlServerRecords(owner)))
    const outcomes = await race(
      (request) => request.input('id', mssql.BigInt, FIXTURE_ORDER).query('select id from sales.[order] with (updlock, holdlock) where id = @id'),
      (records, index) => records.update(orderUpdate([valueOf(ORDER, 'notes', `from writer ${String(index)}`)], before.version ?? '')),
    )
    const winners = outcomes.filter((outcome) => outcome.ok)
    expect(winners).toHaveLength(1)
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([expect.objectContaining({ ok: false, code: 'stale' })])
    const after = ok(await readOrder(createSqlServerRecords(owner)))
    expect(after.values.notes).toBe(winners[0]?.ok === true ? winners[0].values.notes : undefined)
    expect(after.version).toBe(winners[0]?.version)
  })

  // A version that is no longer the record's — or never was one — is stale
  // when the record is still there for this actor: a malformed token cannot
  // be bound, and needs the same answer as a token that does not match.
  test('a stale version, or one that is not a version at all, is stale and changes nothing', async () => {
    const records = createSqlServerRecords(owner)
    const before = ok(await readOrder(records))
    for (const version of ['0000000000000001', 'not a version', before.version?.toUpperCase() ?? '']) {
      expect(await records.update(orderUpdate([valueOf(ORDER, 'notes', 'stale')], version))).toMatchObject({ ok: false, code: 'stale' })
    }
    expect(await readOrder(records)).toEqual(before)
  })

  // Another tenant's record does not exist for this call (0015), even with
  // its current version in hand: the answer is not-found, the same as for a
  // record that was never there, and nothing changes.
  test('an update outside the tenant filter is not-found and changes nothing', async () => {
    const records = createSqlServerRecords(owner)
    const before = ok(await readOrder(records))
    const outcome = await records.update(orderUpdate([valueOf(ORDER, 'notes', 'cross-tenant')], before.version ?? '', tenant('2')))
    expect(outcome).toMatchObject({ ok: false, code: 'not-found' })
    expect(await readOrder(records)).toEqual(before)
  })

  // PostgreSQL's fixture has no rowversion, and many SQL Server tables have
  // none either: an integer every writer through this module increments, so
  // the token a read returned is stale the moment anyone saves. One save
  // after another, here; the race is the next test.
  test('a version column is compared, incremented, and stale once anyone saved', async () => {
    const records = createSqlServerRecords(owner)
    const versioned = target(VERSIONED, 'version')
    const concurrency = versioned.concurrency
    if (concurrency === null) throw new Error('the version column was given')
    const update = (note: string, expectedVersion: string, filters: RowFilters = tenant('1')) =>
      records.update({
        target: { ...versioned, concurrency },
        key: [valueOf(VERSIONED, 'id', '1')],
        set: [valueOf(VERSIONED, 'note', note)],
        expectedVersion,
        filters,
        returning: [columnOf(VERSIONED, 'note')],
      })
    const read = await records.read({ target: versioned, key: [valueOf(VERSIONED, 'id', '1')], columns: [columnOf(VERSIONED, 'note')], filters: tenant('1') })
    expect(read).toEqual({ ok: true, values: { note: 'start' }, version: '0' })
    expect(await update('one', '0')).toEqual({ ok: true, values: { note: 'one' }, version: '1' })
    expect(await update('again', '0')).toMatchObject({ ok: false, code: 'stale' })
    // '01' is version 1 to the server's conversion, and is not the token a read
    // returned; nor is a number, nor a value past bigint. Each is stale.
    for (const token of ['01', 1 as unknown as string, '99999999999999999999']) {
      expect(await update('again', token)).toMatchObject({ ok: false, code: 'stale' })
    }
    expect(await update('elsewhere', '1', tenant('2'))).toMatchObject({ ok: false, code: 'not-found' })
    expect(await update('two', '1')).toEqual({ ok: true, values: { note: 'two' }, version: '2' })
  })

  // The lost update again, for a version column, as a race: both writers wait
  // inside SQL Server behind a third connection's lock, each having named
  // version 0. The comparison is in the WHERE and the increment in the SET of
  // one statement, so the second re-reads the row once the first commits,
  // finds 1, and changes nothing. Compared in one statement and incremented
  // in another, both would have matched 0, and both would "win".
  test('of two concurrent updates of a version column with the same version, one wins and one is stale', async () => {
    const records = createSqlServerRecords(owner)
    const versioned = target(VERSIONED, 'version')
    const concurrency = { kind: 'version-column', column: 'version' } as const
    const key = [valueOf(VERSIONED, 'id', '2')]
    const read = async () => ok(await records.read({ target: versioned, key, columns: [columnOf(VERSIONED, 'note')], filters: tenant('1') }))
    expect((await read()).version).toBe('0')
    const outcomes = await race(
      (request) => request.query('select id from ops.versioned with (updlock, holdlock) where id = 2'),
      (writer, index) =>
        writer.update({
          target: { ...versioned, concurrency },
          key,
          set: [valueOf(VERSIONED, 'note', `from writer ${String(index)}`)],
          expectedVersion: '0',
          filters: tenant('1'),
          returning: [columnOf(VERSIONED, 'note')],
        }),
    )
    const winners = outcomes.filter((outcome) => outcome.ok)
    expect(winners).toHaveLength(1)
    expect(winners[0]?.version).toBe('1')
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([expect.objectContaining({ ok: false, code: 'stale' })])
    expect(await read()).toEqual(winners[0])
  })

  // An AFTER trigger that touches the row it fired for — an audit column, as
  // legacy schemas often have — moves its rowversion again after the
  // statement's OUTPUT saw it. A token taken from OUTPUT is stale before anyone
  // holds it, and every save after the first is refused. Read back from the
  // row before the commit, found by its key as a later save will find it —
  // an identity the insert generated, text under a binary collation — it is
  // the version that save must name.
  test('the version returned is the row’s after its AFTER triggers, so the next save is not stale', async () => {
    const records = createSqlServerRecords(owner)
    const stamped: ObjectRef = { schema: 'ops', name: 'stamped' }
    const coded: ObjectRef = { schema: 'ops', name: 'coded' }
    const cases = [
      { ref: stamped, values: [valueOf(stamped, 'note', 'new')], key: [valueOf(stamped, 'id', '1')] },
      { ref: coded, values: [valueOf(coded, 'code', 'Ab'), valueOf(coded, 'note', 'new')], key: [valueOf(coded, 'code', 'Ab')] },
    ]
    for (const { ref, values, key } of cases) {
      const rowTarget = target(ref)
      const { concurrency } = rowTarget
      if (concurrency === null) throw new Error(`${ref.name} has a rowversion`)
      const read = async () => ok(await records.read({ target: rowTarget, key, columns: [columnOf(ref, 'note'), columnOf(ref, 'touched')], filters: EVERY_ROW }))
      const save = (note: string, expectedVersion: string | null) =>
        records.update({ target: { ...rowTarget, concurrency }, key, set: [valueOf(ref, 'note', note)], expectedVersion: expectedVersion ?? '', filters: EVERY_ROW, returning: [] })

      const inserted = ok(await records.insert({ target: rowTarget, values, returning: [] }))
      const afterInsert = await read()
      expect(afterInsert.values).toEqual({ note: 'new', touched: '1' })
      expect(inserted.version).toBe(afterInsert.version)
      const first = ok(await save('first', inserted.version))
      expect(first.version).toBe((await read()).version)
      const second = ok(await save('second', first.version))
      expect(await read()).toEqual({ ok: true, values: { note: 'second', touched: '3' }, version: second.version })
    }

    // The same for a version column the application's own trigger also moves:
    // the adapter's increment and the trigger's make two, and the token says so.
    const counted: ObjectRef = { schema: 'ops', name: 'counted' }
    const countedTarget = target(counted, 'version')
    const update = (note: string, expectedVersion: string) =>
      records.update({
        target: { ...countedTarget, concurrency: { kind: 'version-column', column: 'version' } },
        key: [valueOf(counted, 'id', '1')],
        set: [valueOf(counted, 'note', note)],
        expectedVersion,
        filters: EVERY_ROW,
        returning: [columnOf(counted, 'note')],
      })
    expect(await update('one', '0')).toEqual({ ok: true, values: { note: 'one' }, version: '2' })
    expect(await update('two', '2')).toEqual({ ok: true, values: { note: 'two' }, version: '4' })
  })

  // Only a key whose text is its value exactly finds its row again. A time
  // reads to the minute, so the row keyed 09:30:15 reads as '09:30' — which
  // is another row's key — and a version read back by it would be that row's.
  // Such a target, and one with no identity to look by, keeps the version
  // its statement saw, and is still written.
  test('a row whose key text is not exact, or which has no identity, keeps the version its statement saw', async () => {
    const records = createSqlServerRecords(owner)
    const timed: ObjectRef = { schema: 'ops', name: 'timed' }
    const versionAt = async (at: string) =>
      (
        await owner
          .request()
          .input('at', mssql.NVarChar(mssql.MAX), at)
          .query<{ v: string }>('select lower(convert(char(16), convert(binary(8), row_version), 2)) as v from ops.timed where at = convert(time, @at)')
      ).recordset[0]?.v
    const defaulted = ok(await records.insert({ target: target(timed), values: [valueOf(timed, 'note', 'with seconds')], returning: [columnOf(timed, 'at')] }))
    expect(defaulted.values).toEqual({ at: '09:30' })
    expect(defaulted.version).toBe(await versionAt('09:30:15'))
    expect(defaulted.version).not.toBe(await versionAt('09:30:00'))
    const keyless = ok(await records.insert({ target: { ...target(timed), identity: [] }, values: [valueOf(timed, 'at', '10:00'), valueOf(timed, 'note', 'no key')], returning: [] }))
    expect(keyless.version).toBe(await versionAt('10:00:00'))
  })

  // An identity that is not unique — bindings that named the wrong columns —
  // would make one update change several records. The statement counts what
  // it changed and rolls back past one; the adapter throws, because that is a
  // programming error and not a refusal. A read says the same.
  test('an identity that is not a key changes nothing, and is a programming error', async () => {
    const records = createSqlServerRecords(owner)
    const concurrency = { kind: 'version-column', column: 'version' } as const
    const heap = { table: HEAP, identity: [columnOf(HEAP, 'tenant_id')], concurrency }
    await expect(records.read({ target: heap, key: [valueOf(HEAP, 'tenant_id', '1')], columns: [columnOf(HEAP, 'note')], filters: EVERY_ROW })).rejects.toThrow(
      /more than one/,
    )
    await expect(
      records.update({ target: heap, key: [valueOf(HEAP, 'tenant_id', '1')], set: [valueOf(HEAP, 'note', 'both')], expectedVersion: '0', filters: EVERY_ROW, returning: [] }),
    ).rejects.toThrow(/more than one/)
    const rows = await owner.request().query<{ note: string; version: number }>('select note, version from ops.heap order by note')
    expect(rows.recordset).toEqual([
      { note: 'one', version: 0 },
      { note: 'two', version: 0 },
    ])
  })
})
