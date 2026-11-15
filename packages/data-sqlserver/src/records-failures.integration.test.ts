import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  ApiValue,
  DeleteOutcome,
  DescribedTable,
  FormBindings,
  FormPolicy,
  FormRecord,
  MetadataSnapshot,
  ObjectRef,
  PolicyContext,
  RecordAdapter,
  RecordColumn,
  RecordOutcome,
  RecordTarget,
  RecordValue,
  RowFilters,
  RowFilterType,
  UpdateRequest,
} from '@formancy/data-core'
import {
  findObject,
  generateForm,
  planCreate,
  planDelete,
  planRead,
  planSupersede,
  planUpdate,
  recordToken,
  REFUSAL_LONGEST,
  REFUSAL_PREFIX,
  toFormAnswers,
} from '@formancy/data-core'
import type { DeclineAnswer, DeclineCase, DefinedRecords, SqlServerFixture, Undefined } from '@formancy/data-fixtures'
import { covers, DECLINE_PARITY, declineCase, DECLINING_MESSAGES, defined, EDGE_VALUES, startSqlServerFixture } from '@formancy/data-fixtures'
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
    'create trigger ops.raised_insert on ops.raised after insert as begin set nocount on; declare @note nvarchar(20) = (select top (1) note from inserted); ' +
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
const tenant = (value: string): RowFilters => ({
  kind: 'restricted',
  equal: [{ column: 'tenant_id', type: columnOf(ORDER, 'tenant_id').type as RowFilterType, value }],
})
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }

function target(ref: ObjectRef, versionColumn: string | null = null): RecordTarget {
  const key = findObject(snapshot, ref)?.primaryKey?.columns ?? []
  return {
    table: ref,
    identity: key.map((name) => columnOf(ref, name)),
    concurrency: versionColumn === null ? null : { kind: 'version-column', column: versionColumn },
  }
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
  return {
    target: { ...target(ref), concurrency: { kind: 'version-column', column: 'version' } },
    key,
    set,
    expectedVersion,
    filters: EVERY_ROW,
    through: [],
    returning: [],
  }
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

/** A login and a user of its own, granted exactly `grants` (constants of this file, so spliced), and a pool connected as it, sized by `pool`. */
async function account(name: string, grants: string, pool?: mssql.config['pool']): Promise<mssql.ConnectionPool> {
  const password = 'Probe-Account-Password-1'
  const master = await new mssql.ConnectionPool({ ...fixture.admin, database: 'master' }).connect()
  try {
    await master.request().batch(`create login ${name} with password = '${password}', check_policy = off`)
  } finally {
    await master.close()
  }
  await owner.request().batch(`create user ${name} for login ${name}`)
  await owner.request().batch(grants)
  return new mssql.ConnectionPool({ ...fixture.reader, user: name, password, ...(pool === undefined ? {} : { pool }) }).connect()
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
    expect(await records.insert({ target: target(UNIQ), values: [valueOf(UNIQ, 'id', '2'), valueOf(UNIQ, 'code', 'taken')], returning: [] })).toMatchObject({
      ok: false,
      code: 'unique-violation',
      constraint: 'ux_uniq_code',
    })
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
    expect(await records.insert({ target: target(node), values: [valueOf(node, 'id', '3'), valueOf(node, 'parent_id', '99')], returning: [] })).toMatchObject(
      broken,
    )
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
      const outcome = await defined(createSqlServerRecords(old)).insert({
        target: { table: { schema: 'dbo', name: 'code' }, identity: [], concurrency: null },
        values,
        returning: [],
      })
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
      const read = records.read({
        target: orderTarget(),
        key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
        columns: [columnOf(ORDER, 'status')],
        filters: tenant(tenantId),
        through: [],
      })
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
    const truncated = await records.insert({
      target: target(UNIQ),
      values: [valueOf(UNIQ, 'id', '4'), valueOf(UNIQ, 'code', 'much-too-long-code')],
      returning: [],
    })
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
    const read = () => records.read({ target: orderTarget(), key, columns: [columnOf(ORDER, 'status')], filters: tenant('1'), through: [] })
    const before = await read()
    if (!before.ok || before.version === null) throw new Error('the order and its version are readable')
    const outcome = await records.update({
      target: { ...orderTarget(), concurrency: { kind: 'rowversion', column: 'row_version' } },
      key,
      set: [valueOf(ORDER, 'status', 'drąft')],
      expectedVersion: before.version,
      filters: tenant('1'),
      through: [],
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
    const read = await records.read({
      target: orderTarget(),
      key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
      columns: [columnOf(ORDER, 'notes')],
      filters: tenant('1'),
      through: [],
    })
    if (!read.ok || read.version === null) throw new Error('the reader can read the order and its version')
    const update = await records.update({
      target: { ...orderTarget(), concurrency: { kind: 'rowversion', column: 'row_version' } },
      key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
      set: [valueOf(ORDER, 'notes', 'not mine to write')],
      expectedVersion: read.version,
      filters: tenant('1'),
      through: [],
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
        records.read({
          target: orderTarget(),
          key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
          columns: [columnOf(ORDER, column)],
          filters: tenant('1'),
          through: [],
        })
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
    await owner
      .request()
      .batch('create function blk.fn_tenant_one(@tenant_id int) returns table with schemabinding as return select 1 as allowed where @tenant_id = 1')
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
      through: [],
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
    expect(await records.insert({ target: target(ignored), values: [valueOf(ignored, 'note', 'new')], returning: [columnOf(ignored, 'id')] })).toMatchObject(
      refused,
    )
    expect(await records.update(versioned(ignored, [valueOf(ignored, 'note', 'changed')], '0'))).toMatchObject(refused)
    expect(
      await records.insert({
        target: target(rewritten),
        values: [valueOf(rewritten, 'note', 'new')],
        returning: [columnOf(rewritten, 'id'), columnOf(rewritten, 'note')],
      }),
    ).toMatchObject(refused)
    const stored = await owner
      .request()
      .query('select (select count(*) from ops.ignored) as ignored, (select note from ops.ignored) as note, (select count(*) from ops.rewritten) as rewritten')
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
      expect(
        await records.insert({ target: target(ref), values: [valueOf(ref, 'id', '1'), valueOf(ref, 'note', 'stored')], returning: [columnOf(ref, 'note')] }),
      ).toEqual({
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
      expect(
        await records.read({
          target: target(ignored),
          key: [valueOf(ignored, 'id', '1')],
          columns: [columnOf(ignored, 'note')],
          filters: EVERY_ROW,
          through: [],
        }),
      ).toMatchObject({
        ok: false,
        code: 'schema-changed',
      })
      const seen = await createSqlServerRecords(owner).describe(ignored)
      if (!seen.ok) throw new Error('the owner sees ops.ignored')
      const outcome = await records.insert({
        target: target(ignored),
        values: [valueOf(ignored, 'note', 'unseen')],
        returning: [],
        definition: seen.described.definition,
      })
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
    expect(
      await records.insert({ target: target(restarted), values: [valueOf(restarted, 'id', '2'), valueOf(restarted, 'note', 'new')], returning: [] }),
    ).toMatchObject(unknown)
    expect(await records.update(versioned(restarted, [valueOf(restarted, 'note', 'changed')], '0'))).toMatchObject(unknown)
    expect(
      await records.insert({ target: target(reopened), values: [valueOf(reopened, 'id', '1'), valueOf(reopened, 'note', 'kept')], returning: [] }),
    ).toMatchObject(unknown)
    const stored = await owner
      .request()
      .query(
        "select (select string_agg(concat(id, ':', note, ':', version), ',') from ops.restarted) as restarted, (select string_agg(concat(id, ':', note), ',') from ops.reopened) as reopened",
      )
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
    const read = (columns: RecordColumn[]) =>
      records.read({ target: target(MOVING), key: [valueOf(MOVING, 'id', '1')], columns, filters: EVERY_ROW, through: [] })
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
      expect(await records.insert({ target: target(drifting), values: [valueOf(drifting, 'id', '2'), note('lost')], returning: [], definition })).toMatchObject(
        {
          ok: false,
          code: 'schema-changed',
        },
      )
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
    expect(await records.insert({ target: orderTarget(), values: newOrder(), returning: [columnOf(ORDER, 'id')], definition })).toMatchObject({
      ok: false,
      code: 'unavailable',
    })
    expect(
      await records.read({
        target: orderTarget(),
        key: [valueOf(ORDER, 'id', FIXTURE_ORDER)],
        columns: [columnOf(ORDER, 'status')],
        filters: tenant('1'),
        through: [],
      }),
    ).toMatchObject({ ok: false, code: 'unavailable' })
  })

  // A login that fails later: the pool opened, its connection was idle and
  // closed, and the next connection's login is refused -- here because the
  // login was disabled, as an Entra principal's would be refused once its
  // grant or its token is gone (0074). mssql rejects the request with the
  // ConnectionError the pool's create step met, and nothing was sent, so a
  // write is `unavailable` as a read is, not the unknown outcome of a write
  // that may have committed. The closed pool above never logs in again;
  // this one does, and is refused. Watched failing with failureFor's first
  // branch removed (the write was unknown-outcome).
  test('a login refused after the pool opened is unavailable, for a write too', async () => {
    const later = await account('probe_later', 'grant select on sales.country to probe_later', {
      min: 0,
      max: 1,
      idleTimeoutMillis: 100,
      reapIntervalMillis: 50,
    })
    try {
      const records = defined(createSqlServerRecords(later))
      const read = () =>
        records.read({ target: target(COUNTRY), key: [valueOf(COUNTRY, 'id', '1')], columns: [columnOf(COUNTRY, 'name')], filters: EVERY_ROW, through: [] })
      expect(await read()).toMatchObject({ ok: true })
      await owner.request().batch('alter login probe_later disable')
      // An open session outlives the login's disabling; the pool's idle one is closed first.
      for (let attempt = 0; later.size > 0; attempt += 1) {
        if (attempt === 200) throw new Error('the pool never closed its idle connection')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const definition = await ownersDefinition(COUNTRY)
      expect(await records.insert({ ...countryInsert('Refused later'), definition })).toMatchObject({ ok: false, code: 'unavailable' })
      expect(await read()).toMatchObject({ ok: false, code: 'unavailable' })
    } finally {
      await later.close()
    }
    expect(await countries('Refused later')).toBe(0)
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

  const countryInsert = (name: string) => ({
    target: target(COUNTRY),
    values: [valueOf(COUNTRY, 'iso_code', 'KK'), valueOf(COUNTRY, 'name', name)],
    returning: [],
  })

  async function countries(name: string): Promise<number | undefined> {
    const found = await owner
      .request()
      .input('name', mssql.NVarChar(mssql.MAX), name)
      .query<{ n: number }>('select count(*) as n from sales.country where name = @name')
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
      expect(
        await records.read({
          target: target(COUNTRY),
          key: [valueOf(COUNTRY, 'id', '1')],
          columns: [columnOf(COUNTRY, 'name')],
          filters: EVERY_ROW,
          through: [],
        }),
      ).toMatchObject({
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
      expect(
        await records.read({
          target: target(COUNTRY),
          key: [valueOf(COUNTRY, 'id', '1')],
          columns: [columnOf(COUNTRY, 'name')],
          filters: EVERY_ROW,
          through: [],
        }),
      ).toMatchObject({
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

/*
 * A refusal the deployment words for the person (0156): DECLINE_PARITY's
 * cases, which the PostgreSQL suite runs too, each declared with
 * `covers()` (0035), and what is SQL Server's own -- its user error numbers,
 * RAISERROR beside THROW, a trigger that ends the write's transaction, and
 * how long a message THROW carries.
 *
 * `declining.declining` is the table the cases are about, in this engine's
 * DDL: an AFTER trigger THROWs 50001 with the message `declining.said`
 * holds for the note a row is written with, and `declining.removable`'s for
 * the note a row is deleted with; the write batch's CATCH rolls the write
 * back and raises the error again as it was. Each request is the planner's,
 * over forms generated from what discovery reports as the owner, as the
 * server sends it, and the owner reads the tables after.
 */
describe('a refusal the deployment words for the person', () => {
  const TABLE: ObjectRef = { schema: 'declining', name: 'declining' }
  const REMOVABLE: ObjectRef = { schema: 'declining', name: 'removable' }
  const CLARA: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: {} }
  const RW = { read: ['clerk'], write: ['clerk'] }
  const READS = { read: ['clerk'], write: [] }
  const POLICY: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: { item_no: RW, valid_from: RW, valid_to: READS, note: RW },
    rowFilters: [],
    lookups: {},
  }
  const REMOVABLE_POLICY: FormPolicy = {
    ...POLICY,
    operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
    fields: { id: READS, note: READS },
  }
  const STORED = { update: 2, supersede: 3 } as const
  /** The reason every case below that is declined gives, and the message it is raised with. */
  const CLOSED = DECLINE_PARITY.insert.answer.reason
  const CLOSED_MESSAGE = `${REFUSAL_PREFIX}${CLOSED}`
  let declining: MetadataSnapshot
  let records: RecordAdapter
  let recordsForm: FormBindings
  let versionsForm: FormBindings
  let removableForm: FormBindings

  beforeAll(async () => {
    // Constants of this file, so they are spliced; the messages are data, bound.
    await owner.request().batch('create schema declining')
    await owner.request().batch(`
      create table declining.said (note nvarchar(20) not null constraint pk_said primary key, message nvarchar(max) not null);
      create table declining.declining (
        item_no int not null,
        valid_from date not null,
        valid_to date null,
        note nvarchar(20) null,
        version int not null constraint df_declining_version default 1,
        constraint pk_declining primary key (item_no, valid_from)
      );
      create table declining.removable (id int identity(1, 1) not null constraint pk_removable primary key, note nvarchar(20) null,
        version int not null constraint df_removable_version default 1);
      create table declining.owned (id int not null constraint pk_owned primary key);
      create table declining.raised (id int not null constraint pk_raised primary key, note nvarchar(20) null);
      create table declining.ended (id int not null constraint pk_ended primary key);
      create table declining.measured (id int identity(1, 1) not null constraint pk_measured primary key, how nvarchar(10) not null,
        message nvarchar(max) not null)`)
    for (const trigger of [
      `create trigger declining.tr_declining on declining.declining after insert, update as begin set nocount on;
        declare @said nvarchar(max) = (select top (1) s.message from declining.said as s join inserted as i on i.note = s.note);
        if @said is not null throw 50001, @said, 1; end`,
      `create trigger declining.tr_removable on declining.removable after delete as begin set nocount on;
        declare @said nvarchar(max) = (select top (1) s.message from declining.said as s join deleted as d on d.note = s.note);
        if @said is not null throw 50001, @said, 1; end`,
      // One of the adapter's own numbers, DEFINITION_MOVED's, with the prefix.
      `create trigger declining.tr_owned on declining.owned after insert as throw 51706, N'${CLOSED_MESSAGE}', 1;`,
      // RAISERROR, at THROW's severity and below it.
      `create trigger declining.tr_raised on declining.raised after insert as begin set nocount on;
        declare @note nvarchar(20) = (select top (1) note from inserted);
        if @note = N'sixteen' raiserror(N'${CLOSED_MESSAGE}', 16, 1);
        else if @note = N'eleven' raiserror(N'${CLOSED_MESSAGE}', 11, 1); end`,
      // Commits the write and then refuses it in words for the person.
      `create trigger declining.tr_ended on declining.ended after insert as begin set nocount on; commit transaction; throw 50001, N'${CLOSED_MESSAGE}', 1; end`,
      // THROWs or RAISERRORs the message the row holds, as it was written.
      `create trigger declining.tr_measured on declining.measured after insert as begin set nocount on;
        declare @how nvarchar(10), @message nvarchar(max);
        select top (1) @how = how, @message = message from inserted;
        if @how = N'throw' throw 50001, @message, 1;
        raiserror(@message, 16, 1); end`,
    ]) {
      await owner.request().batch(trigger)
    }
    for (const item of Object.values(STORED)) {
      await owner
        .request()
        .input('item', mssql.Int, item)
        .query("insert into declining.declining (item_no, valid_from, note) values (@item, '2026-01-01', N'open')")
    }
    await owner.request().input('note', mssql.NVarChar(20), DECLINE_PARITY.delete.note).query('insert into declining.removable (note) values (@note)')
    for (const [note, message] of Object.entries(DECLINING_MESSAGES)) {
      await owner
        .request()
        .input('note', mssql.NVarChar(20), note)
        .input('message', mssql.NVarChar(mssql.MAX), message)
        .query('insert into declining.said (note, message) values (@note, @message)')
    }
    declining = await discoverSqlServer(owner, { schemas: ['declining'] })
    const request = { connection: 'test', root: TABLE, formId: 'declining', title: 'Declining', lookups: [], versionColumn: 'version' }
    recordsForm = generateForm(declining, request).bindings
    versionsForm = generateForm(declining, { ...request, formId: 'declining-versions', validity: { from: 'valid_from', to: 'valid_to' } }).bindings
    removableForm = generateForm(declining, { ...request, root: REMOVABLE, formId: 'removable' }).bindings
    records = createSqlServerRecords(owner)
  })

  async function describedAs(table: ObjectRef): Promise<DescribedTable> {
    const found = await records.describe(table)
    if (!found.ok) throw new Error(`expected a description, got ${found.code}`)
    return found.described
  }

  function tokenOf(item: number): string {
    const token = recordToken(['item_no', 'valid_from'], { item_no: String(item), valid_from: '2026-01-01' })
    if (!token.ok) throw new Error(token.message)
    return token.token
  }

  async function asRead(bindings: FormBindings, item: number): Promise<FormRecord> {
    const plan = planRead(declining, bindings, POLICY, CLARA, tokenOf(item))
    if (!plan.ok) throw new Error(`expected a read, got ${plan.code}`)
    const read = await records.read(plan.request)
    if (!read.ok || read.record === null) throw new Error('expected the record')
    return toFormAnswers(bindings, plan.fields, { ok: true, ...read.record })
  }

  async function rowsOf(item: number) {
    const rows = await owner
      .request()
      .input('item', mssql.Int, item)
      .query<{ from: string; to: string | null; note: string | null; version: number }>(
        'select convert(nvarchar(10), valid_from, 23) as [from], convert(nvarchar(10), valid_to, 23) as [to], note, version from declining.declining where item_no = @item order by valid_from',
      )
    return rows.recordset
  }

  /** What a write answered, as DECLINE_PARITY names it; and that a reason never reaches the sentence for the log. */
  function answerOf(outcome: RecordOutcome | DeleteOutcome): DeclineAnswer | { code: 'written' } {
    if (outcome.ok) return { code: 'written' }
    if (outcome.reason !== undefined) expect(outcome.message).not.toContain(outcome.reason)
    return {
      code: outcome.code,
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      ...(outcome.code !== 'declined' || outcome.column === undefined ? {} : { column: outcome.column }),
    }
  }

  async function created(name: DeclineCase, item: number) {
    const answers = { item_no: String(item), valid_from: '2026-01-01', note: DECLINE_PARITY[name].note }
    const plan = planCreate(declining, recordsForm, POLICY, CLARA, answers, await describedAs(TABLE))
    if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
    return { answer: answerOf(await records.insert(plan.request)), rows: await rowsOf(item) }
  }

  function typeOf(table: ObjectRef, name: string) {
    const found = findObject(declining, table)?.columns.find((column) => column.name === name)
    if (found === undefined) throw new Error(`${table.name} has no column ${name}`)
    return found.type
  }

  const insertInto = (table: ObjectRef, values: Record<string, ApiValue>) =>
    defined(records).insert({
      target: { table, identity: [{ name: 'id', type: typeOf(table, 'id') }], concurrency: null },
      values: Object.entries(values).map(([name, value]) => ({ name, type: typeOf(table, name), value })),
      returning: [],
    })

  // The reason is the deployment's sentence, verbatim, for every write a
  // person makes, THROWn by an AFTER trigger and raised again as it was by
  // the batch's CATCH. Before 0156 each was `refused`, in the server's
  // sentence. Watched failing with the user error's reading taken out:
  // refused, on every write.
  test(
    'a create, an update, a change from a date and a delete the trigger refuses are declined with its reason, and nothing is written',
    covers('sqlserver', declineCase('insert'), declineCase('update'), declineCase('supersede'), declineCase('delete')),
    async () => {
      expect(await created('insert', 1)).toEqual({ answer: DECLINE_PARITY.insert.answer, rows: [] })

      const read = await asRead(recordsForm, STORED.update)
      const update = planUpdate(
        declining,
        recordsForm,
        POLICY,
        CLARA,
        tokenOf(STORED.update),
        '1',
        { note: DECLINE_PARITY.update.note },
        read,
        await describedAs(TABLE),
      )
      if (!update.ok) throw new Error(`expected an update, got ${update.code}`)
      expect(answerOf(await records.update(update.request))).toEqual(DECLINE_PARITY.update.answer)
      expect(await rowsOf(STORED.update)).toEqual([{ from: '2026-01-01', to: null, note: 'open', version: 1 }])

      const change = planSupersede(
        declining,
        versionsForm,
        POLICY,
        CLARA,
        tokenOf(STORED.supersede),
        '1',
        { valid_from: '2026-07-01', note: DECLINE_PARITY.supersede.note },
        await asRead(versionsForm, STORED.supersede),
        await describedAs(TABLE),
      )
      if (!change.ok) throw new Error(`expected a change, got ${change.code}: ${change.message}`)
      expect(answerOf(await records.supersede(change.request))).toEqual(DECLINE_PARITY.supersede.answer)
      // The version the batch ended first is open again: the batch rolled back what it had done.
      expect(await rowsOf(STORED.supersede)).toEqual([{ from: '2026-01-01', to: null, note: 'open', version: 1 }])

      const removal = planDelete(declining, removableForm, REMOVABLE_POLICY, CLARA, 'k1:1', '1', await describedAs(REMOVABLE))
      if (!removal.ok) throw new Error(`expected a delete, got ${removal.code}: ${removal.message}`)
      expect(answerOf(await records.delete(removal.request))).toEqual(DECLINE_PARITY.delete.answer)
      const kept = await owner.request().query<{ id: number; note: string; version: number }>('select id, note, version from declining.removable')
      expect(kept.recordset).toEqual([{ id: 1, note: 'kept', version: 1 }])
    },
  )

  // Watched failing with the bracket left unread: refused.
  test('a refusal that names a column is declined with the column and the reason after it', covers('sqlserver', declineCase('column')), async () => {
    expect(await created('column', 5)).toEqual({ answer: DECLINE_PARITY.column.answer, rows: [] })
  })

  // Nothing changes for a trigger written before 0156, as REFUSAL_PARITY's
  // guardedInsert holds for THROW 50001. Watched failing with every user
  // error's message passed on: declined.
  test('the same reason without the prefix is refused, as every THROW was', covers('sqlserver', declineCase('unprefixed')), async () => {
    expect(await created('unprefixed', 6)).toEqual({ answer: DECLINE_PARITY.unprefixed.answer, rows: [] })
  })

  // The bound is THROW's, measured below: the longest message passed on
  // arrives whole through the trigger and the batch's CATCH, one more code
  // unit is refused, and one far past it, which THROW cuts, is refused
  // rather than shown cut. Watched failing with the bound at 2,047: cut
  // declined, its reason ending in `...`.
  test(
    'a reason with a control character, or longer than THROW carries uncut, is refused; the longest is declined whole',
    covers('sqlserver', declineCase('control'), declineCase('longest'), declineCase('overlong'), declineCase('cut')),
    async () => {
      expect(await created('control', 7)).toEqual({ answer: DECLINE_PARITY.control.answer, rows: [] })
      expect(await created('longest', 8)).toEqual({ answer: DECLINE_PARITY.longest.answer, rows: [] })
      expect(await created('overlong', 9)).toEqual({ answer: DECLINE_PARITY.overlong.answer, rows: [] })
      expect(await created('cut', 10)).toEqual({ answer: DECLINE_PARITY.cut.answer, rows: [] })
    },
  )

  // What a message of each length arrives as, THROWn or RAISERRORed by a
  // trigger inside the write batch's shape -- TRY, the write, CATCH, roll
  // back, THROW again -- which is what REFUSAL_LONGEST rests on: the
  // longest message that arrives whole and cannot be the start of a longer
  // one. Measured, not read from Microsoft's documentation, which gives
  // THROW's message as nvarchar(2048): both keep 2,047 code units whole and
  // cut a longer message to its first 2,044 and `...`, 2,047 too, so the
  // bound is one short of it. First run with the bound typed as 2,047, from
  // the design: `cut` above was declined with a reason ending in `...`.
  test('a message THROW or RAISERROR carries arrives whole one past the bound, and a longer one arrives cut to that length', async () => {
    const lengths = [REFUSAL_LONGEST - 1, REFUSAL_LONGEST, REFUSAL_LONGEST + 1, REFUSAL_LONGEST + 2, 4019]
    const arrived: Record<string, Record<number, { number: unknown; length: number; tail: string }>> = { throw: {}, raiserror: {} }
    for (const how of ['throw', 'raiserror'] as const) {
      for (const length of lengths) {
        const message = `${REFUSAL_PREFIX}${'x'.repeat(length - REFUSAL_PREFIX.length - 1)}y`
        try {
          await owner
            .request()
            .input('how', mssql.NVarChar(10), how)
            .input('message', mssql.NVarChar(mssql.MAX), message)
            .query(
              'set xact_abort on; begin try begin transaction; insert into declining.measured (how, message) values (@how, @message); commit transaction; end try ' +
                'begin catch if @@trancount > 0 rollback transaction; throw; end catch',
            )
          ;(arrived[how] as Record<number, unknown>)[length] = 'nothing raised'
        } catch (error) {
          const { number, message: said } = error as { number: unknown; message: string }
          ;(arrived[how] as Record<number, unknown>)[length] = { number, length: said.length, tail: said.slice(-3) }
        }
      }
    }
    const carried = REFUSAL_LONGEST + 1
    const expected = (number: number) =>
      Object.fromEntries(lengths.map((length) => [length, length <= carried ? { number, length, tail: 'xxy' } : { number, length: carried, tail: '...' }]))
    expect(arrived).toEqual({ throw: expected(50001), raiserror: expected(50000) })
  })

  // A number the adapter answers by is the adapter's, whatever a trigger
  // puts after it: DEFINITION_MOVED's with the prefix is no reason for the
  // person. Watched failing with the adapter's own numbers left unasked:
  // declined.
  test("the prefix under one of the adapter's own numbers is refused, never declined", async () => {
    expect(await insertInto({ schema: 'declining', name: 'owned' }, { id: '1' })).toMatchObject({
      ok: false,
      code: 'refused',
      message: expect.stringContaining('51706'),
    })
  })

  // RAISERROR is a user error too, number 50000, and is declined at THROW's
  // severity, 16. Below it the batch's CATCH still rolls it back and raises
  // it again, and it is refused. Watched failing with the severity left
  // unasked: eleven declined.
  test('a RAISERROR at severity 16 with the prefix is declined, and one below it refused', async () => {
    const raised: ObjectRef = { schema: 'declining', name: 'raised' }
    expect(await insertInto(raised, { id: '1', note: 'sixteen' })).toMatchObject({ ok: false, code: 'declined', reason: CLOSED })
    expect(await insertInto(raised, { id: '2', note: 'eleven' })).toMatchObject({ ok: false, code: 'refused' })
    expect((await owner.request().query<{ n: number }>('select count(*) as n from declining.raised')).recordset[0]?.n).toBe(0)
  })

  // A trigger that commits the write and then THROWs the prefix: the batch
  // raises its own error in the trigger's place (0031), so a reason never
  // says "not saved" over a COMMIT that stored the row. Watched failing
  // with the batch's TRANSACTION_ENDED left out of CATCH.
  test('the prefix after a trigger ended the write’s transaction is unknown-outcome, and the row is stored', async () => {
    expect(await insertInto({ schema: 'declining', name: 'ended' }, { id: '1' })).toMatchObject({ ok: false, code: 'unknown-outcome' })
    expect((await owner.request().query<{ n: number }>('select count(*) as n from declining.ended')).recordset[0]?.n).toBe(1)
  })
})
