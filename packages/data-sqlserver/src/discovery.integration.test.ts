import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta, ObjectRef } from '@formancy/data-core'
import { findObject } from '@formancy/data-core'
// The shared fixture harness, by path to its build: this package does not yet
// declare @formancy/data-fixtures as a devDependency, and the install is
// strict (node-linker=isolated), so the bare name does not resolve here. The
// source path would pull data-fixtures' files under this package's rootDir.
// The dependency line is the fix; see the package README.
import type { SqlServerFixture } from '../../data-fixtures/dist/index.mjs'
import {
  FIXTURE_SCOPE,
  restrictedDisagreements,
  snapshotDisagreements,
  startSqlServerFixture,
} from '../../data-fixtures/dist/index.mjs'
import { discoverSqlServer } from './index.js'

/**
 * Discovery against REAL SQL Server, as the fixture's owner and as
 * `formancy_reader`, who may select from sales.order and nothing else.
 *
 * What the catalog hides from a restricted account is the product's hardest
 * question, and only the server can answer it: every expectation about what
 * the reader sees below was found by asking one, not by reading documentation.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let reader: mssql.ConnectionPool

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  reader = await new mssql.ConnectionPool(fixture.reader).connect()
})

afterAll(async () => {
  await reader?.close()
  await owner?.close()
  await fixture?.stop()
})

const ORDER: ObjectRef = { schema: 'sales', name: 'order' }

function object(snapshot: MetadataSnapshot, schema: string, name: string): ObjectMeta {
  const found = findObject(snapshot, { schema, name })
  if (found === undefined) throw new Error(`${schema}.${name} is not in the snapshot`)
  return found
}

function column(meta: ObjectMeta, name: string): ColumnMeta {
  const found = meta.columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`${meta.ref.schema}.${meta.ref.name} has no column ${name}`)
  return found
}

/** Batches the owner runs to set up a test's own schema; constants, never input. */
async function asOwner(...batches: string[]): Promise<void> {
  for (const batch of batches) await owner.request().batch(batch)
}

/**
 * A fresh login mapped into the fixture database with exactly the grants
 * given, connected. The login is server-level, so it is made in master. Names
 * and grants are this file's constants, which is why they can be spliced.
 */
async function connectAs(login: string, ...grants: string[]): Promise<mssql.ConnectionPool> {
  const password = 'Probe-Fixture-Password-1'
  const master = await new mssql.ConnectionPool({ ...fixture.admin, database: 'master' }).connect()
  try {
    await master.request().batch(`create login ${login} with password = '${password}', check_policy = off`)
  } finally {
    await master.close()
  }
  await asOwner(`create user ${login} for login ${login}`, ...grants)
  return new mssql.ConnectionPool({ ...fixture.reader, user: login, password }).connect()
}

describe('discovery as the owner', () => {
  // The baseline every other test leans on. An adapter that misread one
  // catalog view -- nvarchar lengths left in bytes, a WITH NOCHECK key
  // reported as trusted, a cascade reported as no-action -- is named here by
  // the comparator both adapters answer to.
  test('reports the fixture exactly as the model says, with nothing hidden', async () => {
    const snapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
    expect(snapshotDisagreements(snapshot)).toEqual([])
    expect(snapshot.kind).toBe('sqlserver')
    // As ping reports it: SQL Server 2022 is version 16.
    expect(snapshot.serverVersion).toMatch(/^16\./)
  })

  // A check is translated into a form's allowed values from what the server
  // STORES, which is not what was written: the IN list comes back as ORs, in
  // reverse order, every name bracketed. A translator written against the DDL
  // would never match a real catalog.
  test('reads definitions and comments as SQL Server stored them', async () => {
    const snapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
    const order = object(snapshot, 'sales', 'order')
    expect(order.checks).toEqual([
      { name: 'ck_order_status', expression: "([status]='shipped' OR [status]='placed' OR [status]='draft')", validated: true },
    ])
    expect(column(order, 'status')).toMatchObject({ hasDefault: true, defaultExpression: "('draft')", generated: 'none' })
    const customer = object(snapshot, 'sales', 'customer')
    expect(column(customer, 'active').defaultExpression).toBe('((1))')
    expect(column(customer, 'created_at').defaultExpression).toBe('(sysdatetimeoffset())')
    expect(customer.comment).toBe('A buyer, numbered within its tenant.')
  })

  // Each type the contract names, from the catalog of a real server. The
  // classic slips are all here: nvarchar and nchar lengths in bytes, -1 for
  // max, float(24) silently being real, an alias type that hides its base,
  // rowversion catalogued under its deprecated name `timestamp`, and a period
  // column the database writes itself.
  test('normalises every type the contract names', async () => {
    await asOwner(
      'create schema kinds',
      'create type kinds.amount from decimal(18, 4) not null',
      `create table kinds.every (
         t_tinyint tinyint null, t_smallint smallint null, t_int int null, t_bigint bigint null, t_bit bit null,
         t_decimal decimal(9, 3) null, t_numeric numeric(5, 0) null, t_money money null, t_smallmoney smallmoney null,
         t_float float null, t_float24 float(24) null, t_real real null,
         t_date date null, t_time time(3) null, t_datetime2 datetime2(0) null, t_datetimeoffset datetimeoffset(7) null,
         t_datetime datetime null, t_smalldatetime smalldatetime null,
         t_char char(3) null, t_varchar varchar(30) null, t_varchar_max varchar(max) null,
         t_nchar nchar(10) null, t_nvarchar nvarchar(40) null, t_nvarchar_max nvarchar(max) null, t_sysname sysname null,
         t_uniqueidentifier uniqueidentifier null, t_binary binary(16) null, t_varbinary varbinary(32) null,
         t_varbinary_max varbinary(max) null,
         t_xml xml null, t_sql_variant sql_variant null, t_geography geography null, t_geometry geometry null,
         t_hierarchyid hierarchyid null, t_text text null, t_ntext ntext null, t_image image null,
         t_alias kinds.amount,
         t_rowversion rowversion,
         t_identity int identity(1, 1) not null,
         t_computed as (t_int * 2)
       )`,
      `create table kinds.history (
         id int not null constraint pk_history primary key,
         valid_from datetime2 generated always as row start not null,
         valid_to datetime2 generated always as row end not null,
         period for system_time (valid_from, valid_to)
       )`,
      `exec sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Every type.',
         @level0type = N'SCHEMA', @level0name = N'kinds', @level1type = N'TABLE', @level1name = N'every';
       exec sys.sp_addextendedproperty @name = N'MS_Description', @value = N'A plain int.',
         @level0type = N'SCHEMA', @level0name = N'kinds', @level1type = N'TABLE', @level1name = N'every',
         @level2type = N'COLUMN', @level2name = N't_int'`,
    )
    const snapshot = await discoverSqlServer(owner, { schemas: ['kinds'] })
    expect(snapshot.gaps).toEqual([])
    const every = object(snapshot, 'kinds', 'every')
    expect(every.comment).toBe('Every type.')
    expect(column(every, 't_int').comment).toBe('A plain int.')

    const text = (maxLength: number | null, fixedLength = false) => ({ kind: 'text', maxLength, fixedLength })
    const timestamp = (withTimeZone: boolean, precision: number) => ({ kind: 'timestamp', withTimeZone, precision })
    const unsupported = { kind: 'unsupported' }
    const expected: Record<string, [string, unknown]> = {
      t_tinyint: ['tinyint', { kind: 'integer', min: '0', max: '255' }],
      t_smallint: ['smallint', { kind: 'integer', min: '-32768', max: '32767' }],
      t_int: ['int', { kind: 'integer', min: '-2147483648', max: '2147483647' }],
      t_bigint: ['bigint', { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }],
      t_bit: ['bit', { kind: 'boolean' }],
      t_decimal: ['decimal(9,3)', { kind: 'decimal', precision: 9, scale: 3 }],
      t_numeric: ['numeric(5,0)', { kind: 'decimal', precision: 5, scale: 0 }],
      t_money: ['money', { kind: 'decimal', precision: 19, scale: 4 }],
      t_smallmoney: ['smallmoney', { kind: 'decimal', precision: 10, scale: 4 }],
      t_float: ['float', { kind: 'float', bits: 64 }],
      t_float24: ['real', { kind: 'float', bits: 32 }],
      t_real: ['real', { kind: 'float', bits: 32 }],
      t_date: ['date', { kind: 'date' }],
      t_time: ['time(3)', { kind: 'time', precision: 3 }],
      t_datetime2: ['datetime2(0)', timestamp(false, 0)],
      t_datetimeoffset: ['datetimeoffset(7)', timestamp(true, 7)],
      // The catalog's scale. datetime keeps 1/300 s and smalldatetime whole
      // minutes, which neither number says; see 0007.
      t_datetime: ['datetime', timestamp(false, 3)],
      t_smalldatetime: ['smalldatetime', timestamp(false, 0)],
      t_char: ['char(3)', text(3, true)],
      t_varchar: ['varchar(30)', text(30)],
      t_varchar_max: ['varchar(max)', text(null)],
      t_nchar: ['nchar(10)', text(10, true)],
      t_nvarchar: ['nvarchar(40)', text(40)],
      t_nvarchar_max: ['nvarchar(max)', text(null)],
      t_sysname: ['sysname', text(128)],
      t_uniqueidentifier: ['uniqueidentifier', { kind: 'uuid' }],
      t_binary: ['binary(16)', { kind: 'binary', maxLength: 16 }],
      t_varbinary: ['varbinary(32)', { kind: 'binary', maxLength: 32 }],
      t_varbinary_max: ['varbinary(max)', { kind: 'binary', maxLength: null }],
      t_xml: ['xml', unsupported],
      t_sql_variant: ['sql_variant', unsupported],
      t_geography: ['geography', unsupported],
      t_geometry: ['geometry', unsupported],
      t_hierarchyid: ['hierarchyid', unsupported],
      t_text: ['text', unsupported],
      t_ntext: ['ntext', unsupported],
      t_image: ['image', unsupported],
      t_alias: ['kinds.amount', { kind: 'decimal', precision: 18, scale: 4 }],
      t_rowversion: ['rowversion', { kind: 'rowversion' }],
      t_identity: ['int', { kind: 'integer', min: '-2147483648', max: '2147483647' }],
      t_computed: ['int', { kind: 'integer', min: '-2147483648', max: '2147483647' }],
    }
    const actual = Object.fromEntries(every.columns.map((entry) => [entry.name, [entry.databaseType, entry.type]]))
    expect(actual).toEqual(expected)

    expect(column(every, 't_identity').generated).toBe('identity')
    expect(column(every, 't_computed').generated).toBe('computed')
    expect(column(every, 't_rowversion').generated).toBe('rowversion')
    expect(column(every, 't_int').generated).toBe('none')
    // A period column is written by the database, and an insert that names it
    // is refused. 'none' would offer it to the form as an input.
    const history = object(snapshot, 'kinds', 'history')
    expect(column(history, 'valid_from').generated).toBe('computed')
    expect(column(history, 'valid_to').generated).toBe('computed')
  })

  // Trust, enforcement and the referential actions, on keys made to have each.
  // A disabled key reported as enforced would let a form promise an integrity
  // the database is not keeping; a cascade reported as no-action would hide
  // that deleting a parent deletes children. And a composite key declared in
  // the opposite order to its columns, which the fixture's keys are not: an
  // adapter that ordered by column_id instead of key_ordinal, or a foreign key
  // by its columns instead of constraint_column_id, would pair b with a.
  test('reports what each key, foreign key and check actually does', async () => {
    await asOwner(
      'create schema rel',
      'create table rel.parent (id int not null constraint pk_parent primary key)',
      // A second parent: two cascading keys from one table to another are
      // "multiple cascade paths", which SQL Server refuses (error 1785).
      'create table rel.code (code int not null constraint pk_code primary key, label int not null constraint uq_code_label unique)',
      'create table rel.pair (a int not null, b int not null, constraint pk_pair primary key (b, a))',
      `create table rel.child (
         id int not null constraint pk_child primary key,
         pair_a int null,
         pair_b int null,
         constraint fk_child_pair foreign key (pair_b, pair_a) references rel.pair (b, a),
         parent_id int null constraint fk_child_set_null references rel.parent (id) on delete set null on update cascade,
         parent_code int null constraint df_child_parent_code default 0
           constraint fk_child_set_default references rel.code (label) on delete set default,
         amount int null constraint ck_child_amount check (amount > 0)
       )`,
      'alter table rel.child nocheck constraint fk_child_set_default',
      'alter table rel.child nocheck constraint ck_child_amount',
    )
    const snapshot = await discoverSqlServer(owner, { schemas: ['rel'] })
    expect(object(snapshot, 'rel', 'pair').primaryKey).toEqual({ name: 'pk_pair', columns: ['b', 'a'] })
    const child = object(snapshot, 'rel', 'child')
    expect(child.foreignKeys).toEqual([
      {
        name: 'fk_child_pair',
        columns: ['pair_b', 'pair_a'],
        references: { table: { schema: 'rel', name: 'pair' }, columns: ['b', 'a'] },
        onUpdate: 'no-action',
        onDelete: 'no-action',
        enforced: true,
        validated: true,
      },
      {
        name: 'fk_child_set_default',
        columns: ['parent_code'],
        // To a unique key, not the primary key.
        references: { table: { schema: 'rel', name: 'code' }, columns: ['label'] },
        onUpdate: 'no-action',
        onDelete: 'set-default',
        // Disabled: not checked for new rows, and SQL Server marks it untrusted too.
        enforced: false,
        validated: false,
      },
      {
        name: 'fk_child_set_null',
        columns: ['parent_id'],
        references: { table: { schema: 'rel', name: 'parent' }, columns: ['id'] },
        onUpdate: 'cascade',
        onDelete: 'set-null',
        enforced: true,
        validated: true,
      },
    ])
    // A disabled check reads exactly like a WITH NOCHECK one: the contract has
    // no `enforced` for checks, so this is all a consumer can be told.
    expect(child.checks).toEqual([{ name: 'ck_child_amount', expression: '([amount]>(0))', validated: false }])

    // SQL Server pairs a foreign key with a candidate key only in that key's
    // own order: (a, b) against a key on (b, a) is refused, 1776 "no primary
    // or candidate keys ... match". So a target's columns are always reported
    // in its key's order on this engine.
    await expect(
      owner.request().batch('create table rel.unordered (a int null, b int null, constraint fk_unordered foreign key (a, b) references rel.pair (a, b))'),
    ).rejects.toMatchObject({ number: 1750, precedingErrors: [expect.objectContaining({ number: 1776 })] })
  })

  // The scope is bound as parameters. A schema name an attacker chose, spliced
  // into the text, would run its own statement with the discovery account's
  // rights; bound, it is a name that matches nothing.
  test('binds a schema name as a parameter: an injection attempt is a name that matches nothing', async () => {
    const hostile = "sales'; drop table sales.country; --"
    const snapshot = await discoverSqlServer(owner, { schemas: [hostile] })
    expect(snapshot.objects).toEqual([])
    expect(snapshot.gaps).toEqual([])
    expect(snapshot.scope).toEqual({ schemas: [hostile] })
    // No harm: the table the payload names is still there.
    expect(findObject(await discoverSqlServer(owner, FIXTURE_SCOPE), { schema: 'sales', name: 'country' })).toBeDefined()
  })

  // The same binding, from the other side: a real schema whose name needs
  // quoting is found, and its permission check does not mistake it for one the
  // account cannot see. HAS_PERMS_BY_NAME parses the name it is given, and
  // returns NULL for this one unless it is quoted.
  test("finds a schema whose name needs quoting, such as it's [odd]", async () => {
    await asOwner("create schema [it's [odd]]]", "create table [it's [odd]]].t (id int not null constraint pk_t primary key)")
    const snapshot = await discoverSqlServer(owner, { schemas: ["it's [odd]"] })
    expect(snapshot.objects.map((entry) => entry.ref)).toEqual([{ schema: "it's [odd]", name: 't' }])
    expect(snapshot.gaps).toEqual([])
  })

  // An administrator who has approved nothing gets nothing, and an answer:
  // `in ()` is a syntax error in T-SQL, so an empty scope that reached a
  // catalog query would throw instead of reporting the empty set it approved.
  test('an empty scope reads nothing and still says which server answered', async () => {
    const snapshot = await discoverSqlServer(owner, { schemas: [] })
    expect(snapshot.objects).toEqual([])
    expect(snapshot.gaps).toEqual([])
    expect(snapshot.serverVersion).toMatch(/^16\./)
  })

  // An administrator approved a scope. An object outside it -- even one that
  // points into it -- reported anyway would put a table nobody approved in
  // front of the form generator.
  test('reports nothing outside the scope', async () => {
    await asOwner(
      'create schema outside',
      `create table outside.stray (
         id int not null constraint pk_stray primary key,
         country_id int null constraint fk_stray_country references sales.country (id)
       )`,
    )
    const snapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
    expect(snapshot.objects.filter((entry) => entry.ref.schema !== 'sales')).toEqual([])
    expect(snapshotDisagreements(snapshot)).toEqual([])
  })

  // SQL Server resolves identifiers by the database's collation, and the
  // fixture database is case-insensitive: SALES.[order] is sales.[order].
  // Matching the scope any other way would report "no such schema" for one
  // the database itself resolves -- a silent absence. Objects carry the
  // catalog's spelling, which is what any later statement quotes.
  test("matches the scope as the database's collation does, and reports the catalog's spelling", async () => {
    const snapshot = await discoverSqlServer(owner, { schemas: ['SALES'] })
    expect(findObject(snapshot, ORDER)).toBeDefined()
    expect(new Set(snapshot.objects.map((entry) => entry.ref.schema))).toEqual(new Set(['sales']))
  })

  // Drift review compares fingerprints. One that moved between two readings of
  // an unchanged database would report drift nobody made; one that did not
  // move after an ALTER would miss the drift that matters. Undoing the change
  // restores it, so it is a function of the catalog and not of the moment.
  test('the fingerprint is stable for an unchanged database and moves with an ALTER TABLE', async () => {
    const first = await discoverSqlServer(owner, FIXTURE_SCOPE)
    const second = await discoverSqlServer(owner, FIXTURE_SCOPE)
    expect(second.fingerprint).toBe(first.fingerprint)

    await asOwner('alter table sales.employee add nickname nvarchar(50) null')
    try {
      const altered = await discoverSqlServer(owner, FIXTURE_SCOPE)
      expect(altered.fingerprint).not.toBe(first.fingerprint)
    } finally {
      await asOwner('alter table sales.employee drop column nickname')
    }
    expect((await discoverSqlServer(owner, FIXTURE_SCOPE)).fingerprint).toBe(first.fingerprint)
  })
})

describe('discovery as the restricted reader', () => {
  // The rule both adapters answer to: for every foreign key of sales.order,
  // the right target or a gap -- never silence. And the exact blind spots, so
  // that a server upgrade that changes what a reader sees fails here by name.
  test('says what it could not see, and nothing else is missing', async () => {
    const snapshot = await discoverSqlServer(reader, FIXTURE_SCOPE)
    expect(restrictedDisagreements(snapshot)).toEqual([])
    // Only what the reader holds a permission on is listed at all.
    expect(snapshot.objects.map((entry) => entry.ref)).toEqual([ORDER])
    expect(snapshot.gaps).toEqual([
      { object: null, aspect: 'objects', detail: expect.stringMatching(/^schema sales: .*VIEW DEFINITION/) },
      { object: ORDER, aspect: 'checks', detail: expect.stringMatching(/^ck_order_status: /) },
      { object: ORDER, aspect: 'defaults', detail: expect.stringMatching(/^status: .*df_order_status/) },
      { object: ORDER, aspect: 'foreign-keys', detail: expect.stringMatching(/^fk_order_approved_by references a table this account cannot see/) },
      { object: ORDER, aspect: 'foreign-keys', detail: expect.stringMatching(/^fk_order_created_by references a table this account cannot see/) },
      { object: ORDER, aspect: 'foreign-keys', detail: expect.stringMatching(/^fk_order_customer references a table this account cannot see/) },
    ])
  })

  // What SQL Server shows of a foreign key whose target the reader cannot
  // read: the key, its own columns in order, its flags and actions -- and a
  // referenced_object_id whose OBJECT_NAME is NULL. An adapter that joined to
  // the target to name it would drop the key; one that took the NULL name for
  // "no target" would invent a relationship to nothing.
  test('reports a foreign key whose target it cannot see, with an unknown target', async () => {
    const order = object(await discoverSqlServer(reader, FIXTURE_SCOPE), 'sales', 'order')
    expect(order.foreignKeys.find((entry) => entry.name === 'fk_order_customer')).toEqual({
      name: 'fk_order_customer',
      columns: ['tenant_id', 'customer_no'],
      references: null,
      onUpdate: 'no-action',
      onDelete: 'no-action',
      enforced: true,
      validated: true,
    })
    // The rest of sales.order is all there: definitions are what is hidden.
    expect(order.primaryKey).toEqual({ name: 'pk_order', columns: ['id'] })
    expect(order.checks).toEqual([{ name: 'ck_order_status', expression: null, validated: true }])
    expect(column(order, 'status')).toMatchObject({ hasDefault: true, defaultExpression: null })
    expect(column(order, 'id').generated).toBe('identity')
    expect(column(order, 'row_version').generated).toBe('rowversion')
  })

  // sys.schemas is not filtered: the reader sees every schema. So a schema
  // that is not there is established as absent, and needs no gap -- while a
  // schema that IS there, in which the reader holds nothing, lists nothing and
  // must say that the list cannot be trusted.
  test('tells a schema it cannot list from a schema that does not exist', async () => {
    await asOwner('create schema elsewhere', 'create table elsewhere.t (id int not null constraint pk_elsewhere primary key)')
    const unseen = await discoverSqlServer(reader, { schemas: ['elsewhere'] })
    expect(unseen.objects).toEqual([])
    expect(unseen.gaps).toEqual([{ object: null, aspect: 'objects', detail: expect.stringMatching(/^schema elsewhere: /) }])

    const absent = await discoverSqlServer(reader, { schemas: ['no_such_schema'] })
    expect(absent.objects).toEqual([])
    expect(absent.gaps).toEqual([])
  })

  // A user-defined type is a securable of its own. The reader may select from
  // a table and still not see the type of one of its columns: TYPE_NAME is
  // NULL for it. An inner join to sys.types would drop the column without a
  // word; the base type is visible, so the column is reported with it, and the
  // lost name is a gap.
  test('reports a column whose alias type it cannot see, by its base type and a gap', async () => {
    await asOwner(
      'create schema aliased',
      'create type aliased.amount from decimal(18, 4) not null',
      'create table aliased.priced (id int not null constraint pk_priced primary key, total aliased.amount)',
      'grant select on aliased.priced to formancy_reader',
    )
    const ownerView = column(object(await discoverSqlServer(owner, { schemas: ['aliased'] }), 'aliased', 'priced'), 'total')
    expect(ownerView.databaseType).toBe('aliased.amount')

    const snapshot = await discoverSqlServer(reader, { schemas: ['aliased'] })
    const total = column(object(snapshot, 'aliased', 'priced'), 'total')
    expect(total.databaseType).toBe('decimal(18,4)')
    expect(total.type).toEqual({ kind: 'decimal', precision: 18, scale: 4 })
    expect(snapshot.gaps).toContainEqual({
      object: { schema: 'aliased', name: 'priced' },
      aspect: 'columns',
      detail: expect.stringMatching(/^total: /),
    })
  })

  // The opposite of a gap: nothing about the column is hidden, and that is the
  // trap. sys.columns lists every column of a table the account can see,
  // including one it is denied SELECT on, so discovery cannot tell a column
  // the reader may read from one it may not. The read finds out, with 230.
  test('lists a column the account is denied SELECT on, which only a read reveals', async () => {
    await asOwner(
      'create schema columnar',
      'create table columnar.t (id int not null constraint pk_columnar primary key, secret int null)',
      'grant select on columnar.t to formancy_reader',
      'deny select on columnar.t (secret) to formancy_reader',
    )
    const snapshot = await discoverSqlServer(reader, { schemas: ['columnar'] })
    expect(object(snapshot, 'columnar', 't').columns.map((entry) => entry.name)).toEqual(['id', 'secret'])
    await expect(reader.request().query('select secret from columnar.t')).rejects.toMatchObject({ number: 230 })
  })

  // The documented minimum privilege for complete discovery: VIEW DEFINITION
  // on the schema, and no data access at all. If it were not enough, every
  // customer following the documentation would get gaps; if SELECT were also
  // needed, the documentation would be asking for more than discovery uses.
  test('VIEW DEFINITION on the schema, without SELECT, sees everything the owner sees', async () => {
    const viewer = await connectAs('formancy_viewer', 'grant view definition on schema::sales to formancy_viewer')
    try {
      expect(snapshotDisagreements(await discoverSqlServer(viewer, FIXTURE_SCOPE))).toEqual([])
      await expect(viewer.request().query('select * from sales.customer')).rejects.toMatchObject({ number: 229 })
    } finally {
      await viewer.close()
    }
  })

  // The hole in that grant: a DBA who denies VIEW DEFINITION on one table
  // removes it from sys.objects, while HAS_PERMS_BY_NAME on the schema still
  // says the account may view every definition in it. The table is gone
  // without trace -- except that an account can read its own DENY rows, whose
  // object names are NULL to it. Those are counted, and become a gap.
  test('a table denied VIEW DEFINITION under a schema grant is missing, and a gap says so', async () => {
    const denied = await connectAs(
      'formancy_denied',
      'grant view definition on schema::sales to formancy_denied',
      'deny view definition on sales.employee to formancy_denied',
    )
    try {
      const snapshot = await discoverSqlServer(denied, FIXTURE_SCOPE)
      expect(findObject(snapshot, { schema: 'sales', name: 'employee' })).toBeUndefined()
      expect(snapshot.gaps).toEqual([
        { object: null, aspect: 'objects', detail: expect.stringMatching(/^this account is denied VIEW DEFINITION on 1 object/) },
        { object: ORDER, aspect: 'foreign-keys', detail: expect.stringMatching(/^fk_order_approved_by references a table this account cannot see/) },
        { object: ORDER, aspect: 'foreign-keys', detail: expect.stringMatching(/^fk_order_created_by references a table this account cannot see/) },
      ])
    } finally {
      await denied.close()
    }
  })
})
