import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ApiValue, MetadataSnapshot, ObjectRef, RecordColumn, RecordOutcome, RecordTarget, RecordValue, RowFilters, RowFilterType, UpdateRequest } from '@formancy/data-core'
import { findObject } from '@formancy/data-core'
import type { DefinedRecords, SqlServerFixture, Undefined } from '@formancy/data-fixtures'
import { defined, EDGE_VALUES, startSqlServerFixture } from '@formancy/data-fixtures'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/**
 * Every way a record operation can fail, against REAL SQL Server: each
 * constraint the fixture can be made to break, the account's own grants, a
 * schema that moved under a binding, and a connection that failed before or
 * after a write was sent. Each is a `RecordFailure` with a stable code and a
 * sentence of the adapter's own — never the server's message, which repeats
 * the values a person typed — and none of them is thrown.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let reader: mssql.ConnectionPool
let snapshot: MetadataSnapshot

const ORDER: ObjectRef = { schema: 'sales', name: 'order' }
const COUNTRY: ObjectRef = { schema: 'sales', name: 'country' }
const EMPLOYEE: ObjectRef = { schema: 'sales', name: 'employee' }
const UNIQ: ObjectRef = { schema: 'ops', name: 'uniq' }
const WALLET: ObjectRef = { schema: 'ops', name: 'wallet' }
const PARENT: ObjectRef = { schema: 'ops', name: 'parent' }
const MOVING: ObjectRef = { schema: 'ops', name: 'moving' }
const FIXTURE_ORDER = EDGE_VALUES.beyondSafeInteger

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  reader = await new mssql.ConnectionPool(fixture.reader).connect()
  // Constants of this file, so they are spliced.
  await owner.request().batch('create schema ops')
  await owner.request().batch(`
    create table ops.uniq (id int not null constraint pk_uniq primary key, code nvarchar(10) not null);
    create unique index ux_uniq_code on ops.uniq (code);
    create table ops.wallet (id int not null constraint pk_wallet primary key, m money null,
      version int not null constraint df_wallet_version default 0);
    create table ops.parent (id int not null constraint pk_parent primary key, version int not null constraint df_parent_version default 0);
    create table ops.child (id int not null constraint pk_child primary key,
      parent_id int not null constraint fk_child_parent references ops.parent (id));
    create table ops.moving (id int not null constraint pk_moving primary key, note nvarchar(50) null,
      version int not null constraint df_moving_version default 0)`)
  await owner.request().batch(`
    insert into ops.uniq (id, code) values (1, N'taken');
    insert into ops.wallet (id, m, version) values (1, 1.00, 0), (2, 1.00, 2147483647);
    insert into ops.parent (id) values (1);
    insert into ops.child (id, parent_id) values (1, 1);
    insert into ops.moving (id, note) values (1, N'here');
    create table ops.thrower (id int not null constraint pk_thrower primary key);
    create table ops.warned (id int not null constraint pk_warned primary key, note nvarchar(20) null,
      version int not null constraint df_warned_version default 0);
    insert into ops.warned (id, note) values (1, N'before');
    create table ops.drifting (id int not null constraint pk_drifting primary key, note nvarchar(50) null,
      version int not null constraint df_drifting_version default 0);
    insert into ops.drifting (id, note) values (1, N'here')`)
  await owner.request().batch("create trigger ops.thrower_insert on ops.thrower after insert as throw 51701, N'a rule of the customer''s own', 1;")
  await owner.request().batch("create trigger ops.warned_write on ops.warned after insert, update as raiserror('a warning of the customer''s own', 16, 1);")
  // A foreign key to its own table, and tables whose triggers decide what a
  // write stores or end the transaction it runs in.
  await owner.request().batch(`
    create table ops.node (id int not null constraint pk_node primary key, parent_id int null constraint fk_node_parent references ops.node (id),
      version int not null constraint df_node_version default 0);
    insert into ops.node (id, parent_id) values (1, null), (2, 1);
    create table ops.ignored (id int identity(1, 1) not null constraint pk_ignored primary key, note nvarchar(20) null,
      version int not null constraint df_ignored_version default 0);
    insert into ops.ignored (note) values (N'start');
    create table ops.rewritten (id int identity(1, 1) not null constraint pk_rewritten primary key, note nvarchar(20) null);
    create table ops.update_only (id int not null constraint pk_update_only primary key, note nvarchar(20) null);
    create table ops.dormant (id int not null constraint pk_dormant primary key, note nvarchar(20) null);
    create table ops.restarted (id int not null constraint pk_restarted primary key, note nvarchar(20) null,
      version int not null constraint df_restarted_version default 0);
    insert into ops.restarted (id, note) values (1, N'start');
    create table ops.reopened (id int not null constraint pk_reopened primary key, note nvarchar(20) null);
    create table ops.ended (id int not null constraint pk_ended primary key, note nvarchar(20) null);
    create table ops.raised (id int identity(1, 1) not null constraint pk_raised primary key, note nvarchar(20) null)`)
  for (const trigger of [
    'create trigger ops.ignored_insert on ops.ignored instead of insert as begin set nocount on; end',
    'create trigger ops.ignored_update on ops.ignored instead of update as begin set nocount on; end',
    "create trigger ops.rewritten_insert on ops.rewritten instead of insert as begin set nocount on; insert into ops.rewritten (note) select upper(note) + N'!' from inserted; end",
    'create trigger ops.update_only_update on ops.update_only instead of update as begin set nocount on; end',
    'create trigger ops.dormant_insert on ops.dormant instead of insert as begin set nocount on; end',
    'disable trigger ops.dormant_insert on ops.dormant',
    'create trigger ops.restarted_write on ops.restarted after insert, update as begin set nocount on; rollback transaction; begin transaction; end',
    'create trigger ops.reopened_insert on ops.reopened after insert as begin set nocount on; commit transaction; begin transaction; end',
    "create trigger ops.ended_insert on ops.ended after insert as begin set nocount on; if exists (select 1 from inserted where note = N'commit') commit transaction; else rollback transaction; end",
    // Ends the write's transaction and then refuses it, by what the row's note asks for.
    "create trigger ops.raised_insert on ops.raised after insert as begin set nocount on; declare @note nvarchar(20) = (select top (1) note from inserted); " +
      "if @note = N'commit' commit transaction; else if @note = N'reopen' begin commit transaction; begin transaction; end; else if @note = N'rollback' rollback transaction; " +
      "raiserror(N'a refusal of the customer''s own', 16, 1); end",
  ]) {
    await owner.request().batch(trigger)
  }
  snapshot = await discoverSqlServer(owner, { schemas: ['sales', 'ops'] })
})

afterAll(async () => {
  await reader?.close()
  await owner?.close()
  await fixture?.stop()
})

function columnOf(ref: ObjectRef, name: string): RecordColumn {
  const found = findObject(snapshot, ref)?.columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`${ref.name} has no column ${name}`)
  return { name, type: found.type }
}

const valueOf = (ref: ObjectRef, name: string, value: ApiValue): RecordValue => ({ ...columnOf(ref, name), value })
const tenant = (value: string): RowFilters => ({ kind: 'restricted', equal: [{ column: 'tenant_id', type: columnOf(ORDER, 'tenant_id').type as RowFilterType, value }] })
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }

function target(ref: ObjectRef, versionColumn: string | null = null): RecordTarget {
  const key = findObject(snapshot, ref)?.primaryKey?.columns ?? []
  return { table: ref, identity: key.map((name) => columnOf(ref, name)), concurrency: versionColumn === null ? null : { kind: 'version-column', column: versionColumn } }
}

function orderTarget(): RecordTarget {
  return { table: ORDER, identity: [columnOf(ORDER, 'id')], concurrency: { kind: 'rowversion', column: 'row_version' } }
}

function newOrder(overrides: Record<string, ApiValue> = {}, without: string[] = []): RecordValue[] {
  const values: Record<string, ApiValue> = { tenant_id: '1', customer_no: '1001', order_date: '2026-10-09', amount: '1.0000', ...overrides }
  return Object.entries(values)
    .filter(([name]) => !without.includes(name))
    .map(([name, value]) => valueOf(ORDER, name, value))
}

const insertOrder = (records: DefinedRecords, values: RecordValue[]): Promise<RecordOutcome> =>
  records.insert({ target: orderTarget(), values, returning: [columnOf(ORDER, 'id')] })

function versioned(ref: ObjectRef, set: RecordValue[], expectedVersion: string, key: RecordValue[] = [valueOf(ref, 'id', '1')]): Undefined<UpdateRequest> {
  return { target: { ...target(ref), concurrency: { kind: 'version-column', column: 'version' } }, key, set, expectedVersion, filters: EVERY_ROW, returning: [] }
}

/**
 * The definition the owner describes `table` with: for a write whose own pool
 * cannot describe anything, so that the write itself is what is sent and
 * answered, as one decided before the pool failed is (0041).
 */
async function ownersDefinition(table: ObjectRef): Promise<string> {
  const described = await createSqlServerRecords(owner).describe(table)
  if (!described.ok) throw new Error(`the owner describes ${table.schema}.${table.name}`)
  return described.described.definition
}

/** A login and a user of its own, granted exactly `grants` (constants of this file, so spliced), and a pool connected as it. */
async function account(name: string, grants: string): Promise<mssql.ConnectionPool> {
  const password = 'Probe-Account-Password-1'
  const master = await new mssql.ConnectionPool({ ...fixture.admin, database: 'master' }).connect()
  try {
    await master.request().batch(`create login ${name} with password = '${password}', check_policy = off`)
  } finally {
    await master.close()
  }
  await owner.request().batch(`create user ${name} for login ${name}`)
  await owner.request().batch(grants)
  return new mssql.ConnectionPool({ ...fixture.reader, user: name, password }).connect()
}

describe('each constraint the fixture can be made to break', () => {
  // 2627 is both a primary and a unique key; 2601 is a unique index, which
  // most migration tools emit instead. All three are the same refusal to a
  // person: that value is taken.
  test('a duplicate key is unique-violation, naming the key', async () => {
    const records = defined(createSqlServerRecords(owner))
    expect(
      await records.insert({ target: target(COUNTRY), values: [valueOf(COUNTRY, 'iso_code', 'CH'), valueOf(COUNTRY, 'name', 'Again')], returning: [] }),
    ).toMatchObject({ ok: false, code: 'unique-violation', constraint: 'uq_country_iso_code' })
    expect(
      await records.insert({ target: target(EMPLOYEE), values: [valueOf(EMPLOYEE, 'id', '1'), valueOf(EMPLOYEE, 'name', 'Again')], returning: [] }),
    ).toMatchObject({ ok: false, code: 'unique-violation', constraint: 'pk_employee' })
    expect(
      await records.insert({ target: target(UNIQ), values: [valueOf(UNIQ, 'id', '2'), valueOf(UNIQ, 'code', 'taken')], returning: [] }),
    ).toMatchObject({ ok: false, code: 'unique-violation', constraint: 'ux_uniq_code' })
  })

  // Error 547 is a foreign key and a check alike. Told apart by the kind of
  // constraint the message names, a missing customer and a status the check
  // refuses get different codes — and so does a parent row whose key is still
  // referenced, which SQL Server calls a REFERENCE constraint.
  test('error 547 is foreign-key-violation or check-violation, by the constraint it names', async () => {
    const records = defined(createSqlServerRecords(owner))
    expect(await insertOrder(records, newOrder({ customer_no: '9999' }))).toMatchObject({
      ok: false,
      code: 'foreign-key-violation',
      constraint: 'fk_order_customer',
    })
    expect(await insertOrder(records, newOrder({ status: 'lost' }))).toMatchObject({ ok: false, code: 'check-violation', constraint: 'ck_order_status' })
    expect(await records.update(versioned(PARENT, [valueOf(PARENT, 'id', '2')], '0'))).toMatchObject({
      ok: false,
      code: 'foreign-key-violation',
      constraint: 'fk_child_parent',
    })
  })

  // A foreign key to its own table is spelled differently in 547's message:
  // FOREIGN KEY SAME TABLE for a reference to no row, SAME TABLE REFERENCE for
  // a row still referenced. Matched only as the plain spellings, the code
  // survived on the keyword alone and the constraint a form should mark was
  // lost.
  test('a foreign key to its own table names the constraint, whichever way it is broken', async () => {
    const records = defined(createSqlServerRecords(owner))
    const node: ObjectRef = { schema: 'ops', name: 'node' }
    const broken = { ok: false, code: 'foreign-key-violation', constraint: 'fk_node_parent' }
    expect(await records.insert({ target: target(node), values: [valueOf(node, 'id', '3'), valueOf(node, 'parent_id', '99')], returning: [] })).toMatchObject(broken)
    expect(await records.update(versioned(node, [valueOf(node, 'id', '4')], '0'))).toMatchObject(broken)
  })

  // An insert writes only the columns it is given, so a required column left
  // out is the database's refusal, and so is an explicit null: both name the
  // column a form should mark.
  test('a missing required value is not-null-violation, naming the column', async () => {
    const records = defined(createSqlServerRecords(owner))
    expect(await insertOrder(records, newOrder({}, ['amount']))).toMatchObject({ ok: false, code: 'not-null-violation', column: 'amount' })
    expect(await insertOrder(records, newOrder({ amount: null }))).toMatchObject({ ok: false, code: 'not-null-violation', column: 'amount' })
  })

  // char(2) holds two characters. SQL Server 2019 and later name the column
  // (2628); a database at an older compatibility level says only that
  // something would be truncated (8152). Both are too-long.
  test('a value longer than its column is too-long, under either message', async () => {
    const records = defined(createSqlServerRecords(owner))
    expect(
      await records.insert({ target: target(COUNTRY), values: [valueOf(COUNTRY, 'iso_code', 'ABC'), valueOf(COUNTRY, 'name', 'Long')], returning: [] }),
    ).toMatchObject({ ok: false, code: 'too-long', column: 'iso_code' })

    await owner.request().batch('create database compat_140')
    await owner.request().batch('alter database compat_140 set compatibility_level = 140')
    const old = await new mssql.ConnectionPool({ ...fixture.admin, database: 'compat_140' }).connect()
    try {
      await old.request().batch('create table dbo.code (id int not null constraint pk_code primary key, code char(2) not null)')
      const oldSnapshot = await discoverSqlServer(old, { schemas: ['dbo'] })
      const code = findObject(oldSnapshot, { schema: 'dbo', name: 'code' })?.columns ?? []
      const values = code.map((column) => ({ name: column.name, type: column.type, value: column.name === 'id' ? '1' : 'ABC' }))
      const outcome = await defined(createSqlServerRecords(old)).insert({ target: { table: { schema: 'dbo', name: 'code' }, identity: [], concurrency: null }, values, returning: [] })
      expect(outcome).toMatchObject({ ok: false, code: 'too-long' })
      expect(outcome).not.toHaveProperty('column')
    } finally {
      await old.close()
    }
  })

  // What the codec accepts and the column cannot hold: money is described as
  // decimal(19,4), whose upper part it does not reach (0007), and a version
  // column at its type's largest value cannot be incremented. A trusted
  // filter value its column cannot hold in that spelling never reaches the
  // server any more (0028): scopeRowFilters refuses it as invalid-context,
  // and a term that skipped it is thrown before anything is sent.
  test('a value its column cannot hold is out-of-range, and nothing is written', async () => {
    const records = defined(createSqlServerRecords(owner))
    expect(await records.update(versioned(WALLET, [valueOf(WALLET, 'm', '999999999999999.9999')], '0'))).toMatchObject({ ok: false, code: 'out-of-range' })
    const full = [valueOf(WALLET, 'id', '2')]
    expect(await records.update(versioned(WALLET, [valueOf(WALLET, 'm', '2.0000')], '2147483647', full))).toMatchObject({ ok: false, code: 'out-of-range' })
    const wallet = await owner.request().query<{ m: string; version: number }>('select convert(nvarchar(30), m, 2) as m, version from ops.wallet order by id')
    expect(wallet.recordset).toEqual([
      { m: '1.0000', version: 0 },
      { m: '1.0000', version: 2147483647 },
    ])

    for (const tenantId of ['acme', '99999999999']) {
      const read = records.read({ target: orderTarget(), key: [valueOf(ORDER, 'id', FIXTURE_ORDER)], columns: [columnOf(ORDER, 'status')], filters: tenant(tenantId) })
      await expect(read).rejects.toThrow(/not spelled as its column holds it/)
    }
  })

  // An identity written by hand — 544, which bindings write only when the
  // column became an identity after discovery — is schema-changed, as
  // PostgreSQL's 428C9 is (0028). A customer's trigger that throws the number
  // the adapter's own check uses is the customer's error, not a character the
  // column could not store: `refused`, with the number to find it by, because
  // the same write would be refused again. Never thrown, never unknown-outcome.
  test("a generated column written is schema-changed, and a trigger's own number is refused", async () => {
    const records = defined(createSqlServerRecords(owner))
    const outcome = await insertOrder(records, [valueOf(ORDER, 'id', '5'), ...newOrder()])
    expect(outcome).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringContaining('544') })
    const thrower: ObjectRef = { schema: 'ops', name: 'thrower' }
    const thrown = await records.insert({ target: target(thrower), values: [valueOf(thrower, 'id', '1')], returning: [] })
    expect(thrown).toMatchObject({ ok: false, code: 'refused', message: expect.stringContaining('51701') })
  })

  // RAISERROR, unlike THROW, does not end the batch even under xact_abort: a
  // trigger that raises one as a "warning" and does not roll back lets the
  // statement and the commit run, and the driver still reports the error. Were
  // that `refused` — which promises nothing was written — over a write that
  // did commit, a person would be told a record was not saved that was. Any
  // error the batch is told of rolls it back, so the refusal is true.
  test("a trigger's RAISERROR without a rollback is refused, and nothing is written", async () => {
    const records = defined(createSqlServerRecords(owner))
    const warned: ObjectRef = { schema: 'ops', name: 'warned' }
    const inserted = await records.insert({ target: target(warned), values: [valueOf(warned, 'id', '2'), valueOf(warned, 'note', 'new')], returning: [] })
    expect(inserted).toMatchObject({ ok: false, code: 'refused', message: expect.stringContaining('50000') })
    const updated = await records.update(versioned(warned, [valueOf(warned, 'note', 'after')], '0'))
    expect(updated).toMatchObject({ ok: false, code: 'refused', message: expect.stringContaining('50000') })
    const rows = await owner.request().query<{ id: number; note: string; version: number }>('select id, note, version from ops.warned order by id')
    expect(rows.recordset).toEqual([{ id: 1, note: 'before', version: 0 }])
  })

  // The server's message for a duplicate repeats the duplicate value, and for
  // a truncation the truncated one. A failure is logged; the person's values
  // must not be, so the sentence is the adapter's own.
  test("a failure's message never repeats a value the person entered", async () => {
    const records = defined(createSqlServerRecords(owner))
    const duplicate = await records.insert({ target: target(UNIQ), values: [valueOf(UNIQ, 'id', '3'), valueOf(UNIQ, 'code', 'taken')], returning: [] })
    const truncated = await records.insert({ target: target(UNIQ), values: [valueOf(UNIQ, 'id', '4'), valueOf(UNIQ, 'code', 'much-too-long-code')], returning: [] })
    expect(duplicate).toMatchObject({ ok: false, code: 'unique-violation' })
    expect(truncated).toMatchObject({ ok: false, code: 'too-long' })
    for (const outcome of [duplicate, truncated]) {
      if (outcome.ok) throw new Error('both inserts are refused')
      expect(outcome.message).not.toMatch(/taken|much-too/)
    }
  })
})

describe('a character the column cannot store', () => {
  // SQL Server converts nvarchar to a single-byte varchar WITHOUT an error:
  // a character the code page lacks becomes its "best fit" or a question
  // mark. Measured: N'ŁA' is stored as 'LA' and N'中Z' as '?Z'. The codec
  // assumed the server would refuse (0008); it does not, so the adapter does.
  test('the server itself replaces it silently', async () => {
    const stored = await owner
      .request()
      .input('best', mssql.NVarChar(mssql.MAX), 'ŁA')
      .input('none', mssql.NVarChar(mssql.MAX), '中Z')
      .query<{ best: string; none: string }>('declare @b char(2) = @best, @n char(2) = @none; select @b as best, @n as none')
    expect(stored.recordset[0]).toEqual({ best: 'LA', none: '?Z' })
  })

  // So an insert compares what it stored with what it was sent, in the same
  // transaction, and refuses the difference: the country 'ŁA' is not quietly
  // saved as 'LA', a code nobody entered.
  test('an insert is refused as out-of-range and writes nothing', async () => {
    const records = defined(createSqlServerRecords(owner))
    for (const code of ['ŁA', '中Z']) {
      const outcome = await records.insert({
        target: target(COUNTRY),
        values: [valueOf(COUNTRY, 'iso_code', code), valueOf(COUNTRY, 'name', 'Nowhere')],
        returning: [columnOf(COUNTRY, 'id')],
      })
      expect(outcome).toMatchObject({ ok: false, code: 'out-of-range', column: 'iso_code' })
    }
    const nowhere = await owner.request().query<{ n: number }>("select count(*) as n from sales.country where name = N'Nowhere'")
    expect(nowhere.recordset[0]?.n).toBe(0)
  })

  // The worst case of the substitution: 'drąft' becomes 'draft', which the
  // check constraint accepts. Without the comparison the update succeeds and
  // stores a status the person never chose.
  test('an update is refused as out-of-range and changes nothing', async () => {
    const records = defined(createSqlServerRecords(owner))
    const key = [valueOf(ORDER, 'id', FIXTURE_ORDER)]
    const read = () => records.read({ target: orderTarget(), key, columns: [columnOf(ORDER, 'status')], filters: tenant('1') })
    const before = await read()
    if (!before.ok || before.version === null) throw new Error('the order and its version are readable')
    const outcome = await records.update({
      target: { ...orderTarget(), concurrency: { kind: 'rowversion', column: 'row_version' } },
      key,
      set: [valueOf(ORDER, 'status', 'drąft')],
      expectedVersion: before.version,
      filters: tenant('1'),
      returning: [],
    })
    expect(outcome).toMatchObject({ ok: false, code: 'out-of-range', column: 'status' })
    expect(await read()).toEqual(before)
  })
})

describe("the account's own grants", () => {
  // The restricted reader may select sales.order and nothing else. A write it
  // is not granted is a refusal with a code, whatever the form offered.
  test('a write the account may not make is permission-denied', async () => {
    const records = defined(createSqlServerRecords(reader))
    expect(await insertOrder(records, newOrder())).toMatchObject({ ok: false, code: 'permission-denied' })
    const read = await records.read({ target: orderTarget(), key: [valueOf(ORDER, 'id', FIXTURE_ORDER)], columns: [columnOf(ORDER, 'notes')], filters: tenant('1') })
    if (!read.ok || read.version === null) throw new Error('the reader can read the order and its version')
    const update = await records.update({
      target: { ...orderTarget(), concurrency: { kind: 'rowversion', column: 'row_version' } },
      key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
      set: [valueOf(ORDER, 'notes', 'not mine to write')],
      expectedVersion: read.version,
      filters: tenant('1'),
      returning: [],
    })
    expect(update).toMatchObject({ ok: false, code: 'permission-denied' })
  })

  // A grant can stop at a column (error 230 rather than 229): reading it is
  // refused and names it, and a read that leaves it out is not refused.
  test('a column the account may not read is permission-denied, naming the column', async () => {
    const narrow = await account('probe_columns', 'grant select on sales.[order] to probe_columns; deny select (amount) on sales.[order] to probe_columns')
    try {
      const records = defined(createSqlServerRecords(narrow))
      const read = (column: string) =>
        records.read({ target: orderTarget(), key: [valueOf(ORDER, 'id', FIXTURE_ORDER)], columns: [columnOf(ORDER, column)], filters: tenant('1') })
      expect(await read('amount')).toMatchObject({ ok: false, code: 'permission-denied', column: 'amount' })
      expect(await read('status')).toMatchObject({ ok: true, values: { status: 'placed' } })
    } finally {
      await narrow.close()
    }
  })

  // A write reads back what it stored — OUTPUT, for what it returns, the text
  // it checks and the key it finds the row by again — and SQL Server asks
  // SELECT for every column OUTPUT names (229 on an INSERT-only grant). An
  // account given only INSERT and UPDATE, as a README that asked for nothing
  // more would have it, is refused every write; with SELECT the same write
  // is made.
  test('an account that may write a table but not read it is refused the write', async () => {
    const writer = await account('probe_writer', 'grant insert, update on ops.uniq to probe_writer')
    try {
      const records = defined(createSqlServerRecords(writer))
      const insert = (id: string) => records.insert({ target: target(UNIQ), values: [valueOf(UNIQ, 'id', id), valueOf(UNIQ, 'code', `w${id}`)], returning: [] })
      expect(await insert('10')).toMatchObject({ ok: false, code: 'permission-denied' })
      await owner.request().batch('grant select on ops.uniq to probe_writer')
      expect(await insert('11')).toEqual({ ok: true, values: {}, version: null })
    } finally {
      await writer.close()
    }
  })
})

describe('a security policy that blocks a write', () => {
  // A block predicate refuses a write whose row it does not allow, with
  // 33504, for every principal -- SQL Server exempts nobody, dbo included.
  // It is the counterpart of PostgreSQL's row-level security WITH CHECK,
  // which refuses with 42501 and is permission-denied there (0027, B17), and
  // discovery reports both as row security that `applies`. Left unmapped, it
  // was `unavailable` -- "the database could not be reached" -- for a
  // refusal the policy made, and the two engines disagreed.
  test('a write a block predicate refuses is permission-denied, on insert and on update', async () => {
    await owner.request().batch('create schema blk')
    await owner.request().batch(`
      create table blk.kept (id int not null constraint pk_kept primary key, tenant_id int not null,
        version int not null constraint df_kept_version default 0);
      insert into blk.kept (id, tenant_id) values (1, 1)`)
    await owner.request().batch('create function blk.fn_tenant_one(@tenant_id int) returns table with schemabinding as return select 1 as allowed where @tenant_id = 1')
    await owner.request().batch(`
      create security policy blk.tenant_one
        add block predicate blk.fn_tenant_one(tenant_id) on blk.kept after insert,
        add block predicate blk.fn_tenant_one(tenant_id) on blk.kept after update
        with (state = on)`)
    const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
    const column = (name: string, value: string): RecordValue => ({ name, type: INT32, value })
    const kept: RecordTarget = { table: { schema: 'blk', name: 'kept' }, identity: [{ name: 'id', type: INT32 }], concurrency: null }
    const records = defined(createSqlServerRecords(owner))

    expect(await records.insert({ target: kept, values: [column('id', '2'), column('tenant_id', '1')], returning: [] })).toMatchObject({ ok: true })
    expect(await records.insert({ target: kept, values: [column('id', '3'), column('tenant_id', '2')], returning: [] })).toMatchObject({
      ok: false,
      code: 'permission-denied',
    })
    const update = await records.update({
      target: { ...kept, concurrency: { kind: 'version-column', column: 'version' } },
      key: [column('id', '1')],
      set: [column('tenant_id', '2')],
      expectedVersion: '0',
      filters: EVERY_ROW,
      returning: [],
    })
    expect(update).toMatchObject({ ok: false, code: 'permission-denied' })
    const stored = await owner.request().query<{ id: number; tenant_id: number }>('select id, tenant_id from blk.kept order by id')
    expect(stored.recordset).toEqual([
      { id: 1, tenant_id: 1 },
      { id: 2, tenant_id: 1 },
    ])
  })
})

describe('a trigger that decides what a write stores', () => {
  // An INSTEAD OF trigger runs in place of the statement, and OUTPUT returns
  // the row as if the statement had run. Measured: a trigger that does nothing
  // gave an insert and an update `ok: true` over an unchanged table, and one
  // that inserts the row itself, changed, gave the identity 0 and the values
  // before it changed them. Nothing the batch reads tells what such a trigger
  // stored, so the write is refused and rolled back rather than reported done:
  // `refused`, not `unavailable`, because it would be refused again (0028).
  test('an enabled INSTEAD OF trigger for the operation refuses the write, and nothing is stored', async () => {
    const records = defined(createSqlServerRecords(owner))
    const ignored: ObjectRef = { schema: 'ops', name: 'ignored' }
    const rewritten: ObjectRef = { schema: 'ops', name: 'rewritten' }
    const refused = { ok: false, code: 'refused', message: expect.stringContaining('INSTEAD OF') }
    expect(await records.insert({ target: target(ignored), values: [valueOf(ignored, 'note', 'new')], returning: [columnOf(ignored, 'id')] })).toMatchObject(refused)
    expect(await records.update(versioned(ignored, [valueOf(ignored, 'note', 'changed')], '0'))).toMatchObject(refused)
    expect(
      await records.insert({ target: target(rewritten), values: [valueOf(rewritten, 'note', 'new')], returning: [columnOf(rewritten, 'id'), columnOf(rewritten, 'note')] }),
    ).toMatchObject(refused)
    const stored = await owner.request().query('select (select count(*) from ops.ignored) as ignored, (select note from ops.ignored) as note, (select count(*) from ops.rewritten) as rewritten')
    expect(stored.recordset).toEqual([{ ignored: 1, note: 'start', rewritten: 0 }])
  })

  // The trigger the guard looks for is the one that would run: an INSTEAD OF
  // trigger for another operation, or a disabled one, does not decide this
  // write, which stores exactly what it reports. Refusing every table that
  // has one would refuse writes that are true.
  test('an INSTEAD OF trigger for another operation, or a disabled one, leaves the write alone', async () => {
    const records = defined(createSqlServerRecords(owner))
    for (const ref of [
      { schema: 'ops', name: 'update_only' },
      { schema: 'ops', name: 'dormant' },
    ]) {
      expect(await records.insert({ target: target(ref), values: [valueOf(ref, 'id', '1'), valueOf(ref, 'note', 'stored')], returning: [columnOf(ref, 'note')] })).toEqual({
        ok: true,
        values: { note: 'stored' },
        version: null,
      })
    }
    const stored = await owner.request().query('select (select note from ops.update_only) as update_only, (select note from ops.dormant) as dormant')
    expect(stored.recordset).toEqual([{ update_only: 'stored', dormant: 'stored' }])
  })

  // An account denied VIEW DEFINITION on a table may still write it, and sees
  // neither the table nor its triggers in the catalog (measured: object_id is
  // NULL to it). Whether a trigger decides its write cannot be told, so the
  // write is refused: fail closed. Without that, this account's insert into a
  // table whose trigger ignores it was `ok: true` with nothing stored.
  //
  // Since 0041 the table is not described for it either, so a request is
  // refused before any write is sent; a write decided over the owner's
  // description is refused by the batch as a moved definition, because the
  // facts the account can read of the table are NULL. That check is what
  // refuses it now, before the INSTEAD OF check, which no longer asks
  // whether the account sees the table: without its NULL branch, this
  // write was `ok: true` with nothing stored again.
  test("an account that cannot see the table's triggers is refused the write, and nothing is stored", async () => {
    const blind = await account('probe_blind', 'grant insert, select on ops.ignored to probe_blind; deny view definition on ops.ignored to probe_blind')
    try {
      const ignored: ObjectRef = { schema: 'ops', name: 'ignored' }
      const records = createSqlServerRecords(blind)
      expect(await records.describe(ignored)).toMatchObject({ ok: false, code: 'schema-changed' })
      // A read too, though the account holds SELECT: its description is the same NULL facts, so no form over the table is served to it.
      expect(await records.read({ target: target(ignored), key: [valueOf(ignored, 'id', '1')], columns: [columnOf(ignored, 'note')], filters: EVERY_ROW })).toMatchObject({
        ok: false,
        code: 'schema-changed',
      })
      const seen = await createSqlServerRecords(owner).describe(ignored)
      if (!seen.ok) throw new Error('the owner sees ops.ignored')
      const outcome = await records.insert({ target: target(ignored), values: [valueOf(ignored, 'note', 'unseen')], returning: [], definition: seen.described.definition })
      expect(outcome).toMatchObject({ ok: false, code: 'schema-changed' })
    } finally {
      await blind.close()
    }
    const stored = await owner.request().query<{ n: number }>('select count(*) as n from ops.ignored')
    expect(stored.recordset[0]?.n).toBe(1)
  })

  // A trigger that rolls the write's transaction back and begins another
  // leaves @@trancount where it found it, so SQL Server raises nothing and the
  // batch commits the empty new transaction: measured, `ok: true` with no row
  // stored. One that commits and begins another has stored the row. The batch
  // sees only that its transaction is not the one it began, and cannot tell
  // which of the two the trigger did, so both are unknown-outcome — neither a
  // success nor a refusal that invites a retry.
  test("a trigger that ends the write's transaction and begins another is unknown-outcome", async () => {
    const records = defined(createSqlServerRecords(owner))
    const restarted: ObjectRef = { schema: 'ops', name: 'restarted' }
    const reopened: ObjectRef = { schema: 'ops', name: 'reopened' }
    const unknown = { ok: false, code: 'unknown-outcome' }
    expect(await records.insert({ target: target(restarted), values: [valueOf(restarted, 'id', '2'), valueOf(restarted, 'note', 'new')], returning: [] })).toMatchObject(unknown)
    expect(await records.update(versioned(restarted, [valueOf(restarted, 'note', 'changed')], '0'))).toMatchObject(unknown)
    expect(await records.insert({ target: target(reopened), values: [valueOf(reopened, 'id', '1'), valueOf(reopened, 'note', 'kept')], returning: [] })).toMatchObject(unknown)
    const stored = await owner.request().query("select (select string_agg(concat(id, ':', note, ':', version), ',') from ops.restarted) as restarted, (select string_agg(concat(id, ':', note), ',') from ops.reopened) as reopened")
    expect(stored.recordset).toEqual([{ restarted: '1:start:0', reopened: '1:kept' }])
  })

  // Ending it without beginning another is error 3609, raised alike after
  // the trigger's COMMIT and after its ROLLBACK. Measured: the COMMIT stored
  // the row and was reported `unavailable`, a refusal over a committed write
  // that invites the retry storing it twice. So 3609 is unknown-outcome.
  test("a trigger that ends the write's transaction without beginning another is unknown-outcome", async () => {
    const records = defined(createSqlServerRecords(owner))
    const ended: ObjectRef = { schema: 'ops', name: 'ended' }
    for (const [id, note] of [
      ['1', 'commit'],
      ['2', 'rollback'],
    ] as const) {
      const outcome = await records.insert({ target: target(ended), values: [valueOf(ended, 'id', id), valueOf(ended, 'note', note)], returning: [] })
      expect(outcome).toMatchObject({ ok: false, code: 'unknown-outcome', message: expect.stringContaining('3609') })
    }
    const stored = await owner.request().query<{ id: number; note: string }>('select id, note from ops.ended')
    expect(stored.recordset).toEqual([{ id: 1, note: 'commit' }])
  })
})

// A trigger that commits the write's transaction -- or commits it and
// begins another -- and then raises an error of its own has stored the row,
// and the error reaches the batch's CATCH like any refusal. Measured before
// 0031: reported `refused`, "nothing was written", over a stored row; on a
// table whose key the database numbers, the next press stores a second. The
// CATCH can tell: the transaction is no longer the one the batch began. It
// cannot tell a COMMIT from a ROLLBACK, so a trigger that rolls back and then
// raises is unknown-outcome too, which over-reports and is safe.
describe('a trigger that ends the transaction and then raises an error', () => {
  test('is unknown-outcome whether it committed, committed and began another, or rolled back, and only the commits are stored', async () => {
    const records = defined(createSqlServerRecords(owner))
    const raised: ObjectRef = { schema: 'ops', name: 'raised' }
    for (const note of ['commit', 'reopen', 'rollback']) {
      const outcome = await records.insert({ target: target(raised), values: [valueOf(raised, 'note', note)], returning: [] })
      expect({ note, outcome }).toMatchObject({ note, outcome: { ok: false, code: 'unknown-outcome' } })
    }
    const stored = await owner.request().query<{ note: string }>('select note from ops.raised order by id')
    expect(stored.recordset.map((row) => row.note)).toEqual(['commit', 'reopen'])
  })

  // The control: a trigger that raises and ends nothing is still the
  // customer's refusal, rolled back -- the check is the transaction, not the
  // error.
  test('a trigger that only raises is still refused, and nothing is stored', async () => {
    const records = defined(createSqlServerRecords(owner))
    const raised: ObjectRef = { schema: 'ops', name: 'raised' }
    const outcome = await records.insert({ target: target(raised), values: [valueOf(raised, 'note', 'only raise')], returning: [] })
    expect(outcome).toMatchObject({ ok: false, code: 'refused' })
    const stored = await owner.request().query<{ n: number }>("select count(*) as n from ops.raised where note = N'only raise'")
    expect(stored.recordset[0]?.n).toBe(0)
  })
})

describe('a schema that moved under the binding', () => {
  // The plan's "schema alteration between read and save": bindings name a
  // column or a table that is no longer there. That is schema-changed, so drift
  // review can be suggested, and never a generic failure.
  test('a dropped column or a renamed table is schema-changed', async () => {
    const records = defined(createSqlServerRecords(owner))
    const read = (columns: RecordColumn[]) => records.read({ target: target(MOVING), key: [valueOf(MOVING, 'id', '1')], columns, filters: EVERY_ROW })
    const note = columnOf(MOVING, 'note')
    expect(await read([note])).toMatchObject({ ok: true, values: { note: 'here' } })
    await owner.request().batch('alter table ops.moving drop column note')
    expect(await read([note])).toMatchObject({ ok: false, code: 'schema-changed', column: 'note' })
    expect(await records.update(versioned(MOVING, [{ ...note, value: 'there' }], '0'))).toMatchObject({ ok: false, code: 'schema-changed', column: 'note' })
    await owner.request().batch("exec sp_rename 'ops.moving', 'moved'")
    expect(await read([])).toMatchObject({ ok: false, code: 'schema-changed' })
  })

  // A table that is gone when the batch compiles is resolved only when its
  // statement runs, after `begin transaction`. Without xact_abort that 208
  // leaves the transaction open — SQL Server then reports 266, a mismatched
  // count, last — on a connection the pool hands to the next write, whose
  // commit would only close the inner level and be rolled back later. The
  // write is schema-changed, the connection holds no transaction, and the
  // next write on it commits. Decided before the rename, as a write in
  // flight is: described after it, the table is not there and no batch is
  // sent (0041), so the statement would never meet the missing table.
  test('a write to a renamed table is schema-changed, and leaves no transaction on its connection', async () => {
    const single = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
    const drifting: ObjectRef = { schema: 'ops', name: 'drifting' }
    const note = (value: string): RecordValue => valueOf(drifting, 'note', value)
    try {
      const records = defined(createSqlServerRecords(single))
      const before = await records.describe(drifting)
      if (!before.ok) throw new Error('ops.drifting is described before the rename')
      const { definition } = before.described
      await owner.request().batch("exec sp_rename 'ops.drifting', 'drifted'")
      expect(await records.update({ ...versioned(drifting, [note('lost')], '0'), definition })).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await records.insert({ target: target(drifting), values: [valueOf(drifting, 'id', '2'), note('lost')], returning: [], definition })).toMatchObject({
        ok: false,
        code: 'schema-changed',
      })
      const open = await single.request().query<{ n: number }>('select @@trancount as n')
      expect(open.recordset[0]?.n).toBe(0)
      await owner.request().batch("exec sp_rename 'ops.drifted', 'drifting'")
      expect(await records.update(versioned(drifting, [note('kept')], '0'))).toMatchObject({ ok: true, version: '1' })
    } finally {
      await single.close()
    }
    const stored = await owner.request().query<{ note: string; version: number }>('select note, version from ops.drifting')
    expect(stored.recordset).toEqual([{ note: 'kept', version: 1 }])
  })
})

describe('messages in another language', () => {
  // tedious asks for us_english at login unless the composition root sets
  // `options.language`, and then SQL Server translates its messages. The codes
  // come from the error number, and 547's kind from the SQL keyword every
  // translation keeps (measured across all 34 installed languages), so a
  // German session gets the same codes; only the names drawn from an English
  // message are missing.
  test('codes do not depend on the language of the session', async () => {
    const german = await new mssql.ConnectionPool({ ...fixture.admin, options: { ...fixture.admin.options, language: 'Deutsch' } }).connect()
    try {
      const language = await german.request().query<{ language: string }>('select @@language as language')
      expect(language.recordset[0]?.language).toBe('Deutsch')
      const records = defined(createSqlServerRecords(german))
      const foreignKey = await insertOrder(records, newOrder({ customer_no: '9999' }))
      expect(foreignKey).toMatchObject({ ok: false, code: 'foreign-key-violation' })
      expect(foreignKey).not.toHaveProperty('constraint')
      expect(await insertOrder(records, newOrder({ status: 'lost' }))).toMatchObject({ ok: false, code: 'check-violation' })
      expect(await records.update(versioned(PARENT, [valueOf(PARENT, 'id', '2')], '0'))).toMatchObject({ ok: false, code: 'foreign-key-violation' })
      expect(await insertOrder(records, newOrder({}, ['amount']))).toMatchObject({ ok: false, code: 'not-null-violation' })
    } finally {
      await german.close()
    }
  })
})

describe('when the connection fails', () => {
  // A pool that cannot hand out a connection sent nothing, so even a write is
  // `unavailable`: it certainly did not commit, and a retry is safe. The
  // write carries a definition, so the write is what meets the closed pool,
  // not a description before it.
  test('a pool that cannot connect is unavailable, for a write too', async () => {
    const closed = await new mssql.ConnectionPool(fixture.admin).connect()
    await closed.close()
    const records = defined(createSqlServerRecords(closed))
    const definition = await ownersDefinition(ORDER)
    expect(await records.insert({ target: orderTarget(), values: newOrder(), returning: [columnOf(ORDER, 'id')], definition })).toMatchObject({ ok: false, code: 'unavailable' })
    expect(
      await records.read({ target: orderTarget(), key: [valueOf(ORDER, 'id', FIXTURE_ORDER)], columns: [columnOf(ORDER, 'status')], filters: tenant('1') }),
    ).toMatchObject({ ok: false, code: 'unavailable' })
  })

  /** Holds sales.country exclusively on its own connection until released, so a write to it waits inside the server. */
  async function holdCountry(): Promise<{ release: () => Promise<void>; waiting: (session: number) => Promise<void> }> {
    const holder = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
    const transaction = new mssql.Transaction(holder)
    await transaction.begin()
    await new mssql.Request(transaction).query('select count(*) as n from sales.country with (tablockx, holdlock)')
    return {
      release: async () => {
        await transaction.rollback()
        await holder.close()
      },
      waiting: async (session) => {
        for (let attempt = 0; ; attempt += 1) {
          const found = await owner
            .request()
            .input('session', mssql.Int, session)
            .query<{ blocked: number }>('select blocking_session_id as blocked from sys.dm_exec_requests where session_id = @session')
          if ((found.recordset[0]?.blocked ?? 0) > 0) return
          if (attempt === 200) throw new Error('the write never waited on the held table')
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      },
    }
  }

  const countryInsert = (name: string) => ({ target: target(COUNTRY), values: [valueOf(COUNTRY, 'iso_code', 'KK'), valueOf(COUNTRY, 'name', name)], returning: [] })

  async function countries(name: string): Promise<number | undefined> {
    const found = await owner.request().input('name', mssql.NVarChar(mssql.MAX), name).query<{ n: number }>('select count(*) as n from sales.country where name = @name')
    return found.recordset[0]?.n
  }

  // A pool whose every connection is busy makes a request wait for one, and
  // after `acquireTimeoutMillis` gives up with its own timeout — not a
  // ConnectionError, and the same error every waiter after the first gets
  // while the server is down. No connection was handed out, so nothing was
  // sent: it is `unavailable`, never an exception the port promises not to throw.
  // With a definition, so the write is what waits for the connection.
  test('a pool that hands out no connection in time is unavailable, for a write too', async () => {
    const busy = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1, acquireTimeoutMillis: 500 } }).connect()
    const definition = await ownersDefinition(COUNTRY)
    const holding = new mssql.Transaction(busy)
    await holding.begin()
    try {
      const records = defined(createSqlServerRecords(busy))
      expect(await records.insert({ ...countryInsert('Never sent'), definition })).toMatchObject({ ok: false, code: 'unavailable' })
      expect(await records.read({ target: target(COUNTRY), key: [valueOf(COUNTRY, 'id', '1')], columns: [columnOf(COUNTRY, 'name')], filters: EVERY_ROW })).toMatchObject({
        ok: false,
        code: 'unavailable',
      })
    } finally {
      await holding.rollback()
      await busy.close()
    }
    expect(await countries('Never sent')).toBe(0)
  })

  // The plan's "connection lost around commit": the write was sent and the
  // session died before an answer came. It may have committed, so the answer
  // is unknown-outcome — and it is never retried. Were it retried, the retry
  // would wait on the held table and this result would not arrive until the
  // table was released; it arrives first, and after the release no row exists.
  test('a write whose session is killed while it waits is unknown-outcome, and is not retried', async () => {
    const pool = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
    const held = await holdCountry()
    try {
      const session = await pool.request().query<{ id: number }>('select @@spid as id')
      const id = session.recordset[0]?.id ?? 0
      const pending = defined(createSqlServerRecords(pool)).insert(countryInsert('Killed'))
      await held.waiting(id)
      await owner.request().batch(`kill ${String(id)}`)
      expect(await pending).toMatchObject({ ok: false, code: 'unknown-outcome' })
    } finally {
      await held.release()
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await countries('Killed')).toBe(0)
    await pool.close()
  })

  // A request timeout cancels a statement the server may already have run: a
  // write is unknown-outcome. A read that times out changed nothing, so it is
  // simply unavailable.
  test('a timeout is unknown-outcome for a write and unavailable for a read', async () => {
    const impatient = await new mssql.ConnectionPool({ ...fixture.admin, requestTimeout: 1000 }).connect()
    const held = await holdCountry()
    try {
      const records = defined(createSqlServerRecords(impatient))
      expect(await records.insert(countryInsert('Timed out'))).toMatchObject({ ok: false, code: 'unknown-outcome' })
      expect(await records.read({ target: target(COUNTRY), key: [valueOf(COUNTRY, 'id', '1')], columns: [columnOf(COUNTRY, 'name')], filters: EVERY_ROW })).toMatchObject({
        ok: false,
        code: 'unavailable',
      })
    } finally {
      await held.release()
      await impatient.close()
    }
    expect(await countries('Timed out')).toBe(0)
  })
})
