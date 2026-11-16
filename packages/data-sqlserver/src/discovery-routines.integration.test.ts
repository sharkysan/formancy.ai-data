import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { MetadataSnapshot, RoutineMeta } from '@formancy/data-core'
import { describeRoutine } from '@formancy/data-core'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { covers, FIXTURE_SCOPE, MODEL_CASES, ROUTINE_SCOPE, routineDisagreements, snapshotDisagreements, startSqlServerFixture } from '@formancy/data-fixtures'
import { ROUTINE_TYPES } from './discovery/routines.js'
import { discoverSqlServer } from './index.js'

/**
 * The routines discovery records when its scope asks for them (0158) --
 * against REAL SQL Server, loaded with the shared fixture, as `sa` (the
 * database's `dbo`), `formancy_reader`, `formancy_writer` and logins this
 * file makes for one question each.
 *
 * Schema `probe` holds what the fixture does not: a routine of each shape no
 * action could bind, one the reader is granted and one the writer's role is
 * granted and the writer denied, a procedure and a function over a table
 * the reader may not read, and one marked as Microsoft's. None touches
 * `sales`, which stays exactly what the model describes.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let reader: mssql.ConnectionPool
let writer: mssql.ConnectionPool
const opened: mssql.ConnectionPool[] = []

const PASSWORD = 'Probe-Fixture-Password-1'

async function connect(config: mssql.config): Promise<mssql.ConnectionPool> {
  const pool = await new mssql.ConnectionPool(config).connect()
  opened.push(pool)
  return pool
}

/** Batches the owner runs; this file's constants, never input. */
async function asOwner(...batches: string[]): Promise<void> {
  for (const batch of batches) await owner.request().batch(batch)
}

/** A fresh login, mapped into the fixture database with exactly the grants given, connected. */
async function connectAs(login: string, grants: readonly string[]): Promise<mssql.ConnectionPool> {
  const master = await new mssql.ConnectionPool({ ...fixture.admin, database: 'master' }).connect()
  try {
    await master.request().batch(`create login ${login} with password = '${PASSWORD}', check_policy = off`)
  } finally {
    await master.close()
  }
  await asOwner(`create user ${login} for login ${login}`, ...grants)
  return connect({ ...fixture.admin, user: login, password: PASSWORD })
}

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await connect(fixture.admin)
  reader = await connect(fixture.reader)
  writer = await connect(fixture.writer)
  await asOwner(
    'create schema probe',
    'create table probe.secret (v int); insert into probe.secret values (42)',
    'create procedure probe.granted @n int as set nocount on',
    'create procedure probe.denied @n int as set nocount on',
    'create procedure probe.peek as select v from probe.secret',
    'create function probe.peek_value() returns int as begin return (select top (1) v from probe.secret) end',
    'create function probe.returns_text(@n int) returns nvarchar(20) as begin return cast(@n as nvarchar(20)) end',
    'create function probe.rows_inline(@n int) returns table as return select @n as n',
    'create function probe.rows_multi(@n int) returns @rows table (n int) as begin insert into @rows values (@n); return end',
    'create procedure probe.with_output @n int, @doubled int output as set @doubled = @n * 2',
    'create type probe.amount from decimal(14, 2)',
    'create type probe.keys as table (k int)',
    `create procedure probe.typed @a probe.amount, @k probe.keys readonly, @b varbinary(16), @v varchar(20), @nv nvarchar(max), @x decimal(14, 2), @s sysname
      as set nocount on`,
    'create procedure probe.as_owner with execute as owner as set nocount on',
    'create procedure probe.shipped as set nocount on',
    "exec sys.sp_MS_marksystemobject N'probe.shipped'",
    `create procedure probe.every_type @a uniqueidentifier, @b date, @c time(3), @d datetime2(7), @e datetimeoffset(7), @f tinyint, @g smallint,
      @h int, @i smalldatetime, @j real, @k money, @l datetime, @m float, @n bit, @o decimal(9, 3), @p numeric(5, 0), @q smallmoney, @r bigint,
      @s varchar(10), @t char(2), @u nvarchar(30), @w nchar(4)
      as set nocount on`,
    'grant execute on probe.granted to formancy_reader',
    'grant execute on probe.peek to formancy_reader',
    'grant execute on probe.peek_value to formancy_reader',
    'grant execute on probe.denied to formancy_forms',
    'deny execute on probe.denied to formancy_writer',
  )
})

afterAll(async () => {
  for (const pool of opened) await pool.close()
  await fixture?.stop()
})

/**
 * The server's answer to one batch as `pool`'s account, in a transaction
 * always rolled back: `ok`, or the error number it refused with.
 */
async function answer(pool: mssql.ConnectionPool, batch: string): Promise<string> {
  const transaction = pool.transaction()
  await transaction.begin()
  try {
    await transaction.request().batch(batch)
    return 'ok'
  } catch (error) {
    return String((error as { number?: unknown }).number)
  } finally {
    await transaction.rollback().catch(() => {})
  }
}

function routine(snapshot: MetadataSnapshot, name: string): RoutineMeta {
  const found = snapshot.routines?.find((entry) => entry.ref.name === name)
  if (found === undefined) throw new Error(`${name} is not among ${String(snapshot.routines?.map((entry) => describeRoutine(entry.ref)))}`)
  return found
}

const names = (snapshot: MetadataSnapshot): string[] => (snapshot.routines ?? []).map((entry) => describeRoutine(entry.ref))
const routineGaps = (snapshot: MetadataSnapshot) => snapshot.gaps.filter((gap) => gap.aspect === 'routines')

/** A routine as one line: kind, effects, returns and its result, reach, and each parameter as `mode name: typeId kind`. */
function shape(entry: RoutineMeta): string {
  const parameters = entry.parameters.map((parameter) => `${parameter.mode} ${parameter.name}: ${parameter.typeId} ${parameter.type.kind}`)
  const result = entry.result === null ? '' : ` ${entry.result.databaseType}`
  return `${entry.kind} ${entry.effects} ${entry.returns}${result} ${entry.reach} [${parameters.join(', ')}]`
}

describe('the fixture’s routines (0158)', () => {
  // One fixture written twice (0005): ship_order is a procedure here and a
  // function returning void on PostgreSQL, typed alike, and the security
  // policy's predicate is a routine PostgreSQL's file has no counterpart
  // for. The owner reads both as the model says, and the objects are the
  // model's still. Asked for, they are in the snapshot and its fingerprint;
  // not asked for, nothing more is read and the snapshot has no routines.
  test('the owner discovers the routines the model gives SQL Server, and only when the scope asks', covers('sqlserver', MODEL_CASES.routines), async () => {
    const [asked, unasked] = await Promise.all([discoverSqlServer(owner, ROUTINE_SCOPE), discoverSqlServer(owner, FIXTURE_SCOPE)])
    expect(routineDisagreements(asked)).toEqual([])
    expect(snapshotDisagreements(asked)).toEqual([])
    expect(names(asked)).toEqual(['sales.fn_customer_tenant()', 'sales.ship_order()'])
    expect(asked.scope).toEqual(ROUTINE_SCOPE)
    expect(unasked).not.toHaveProperty('routines')
    expect([asked.objects, asked.gaps]).toEqual([unasked.objects, unasked.gaps])
    expect(asked.fingerprint).not.toBe(unasked.fingerprint)
    expect((await discoverSqlServer(owner, { schemas: [], routines: true })).routines).toEqual([])
  })

  // Whether an account may call a routine is the server's own answer: the
  // writer through its role formancy_forms, and with VIEW DEFINITION on the
  // database it sees both routines, the predicate it holds no SELECT on
  // included. The reader holds nothing on either, and SQL Server lists
  // neither to it: absent, behind a routines gap on sales that says why --
  // never absent with nothing said. Each answer is the one a call gets.
  test('reads EXECUTE as the owner, the reader and the writer, as a call answers', covers('sqlserver', MODEL_CASES.routineAccess), async () => {
    const [asOwner, asReader, asWriter] = await Promise.all([
      discoverSqlServer(owner, ROUTINE_SCOPE),
      discoverSqlServer(reader, ROUTINE_SCOPE),
      discoverSqlServer(writer, ROUTINE_SCOPE),
    ])
    expect(routineDisagreements(asOwner, 'owner')).toEqual([])
    expect(routineDisagreements(asReader, 'reader')).toEqual([])
    expect(routineDisagreements(asWriter, 'writer')).toEqual([])
    expect(names(asReader)).toEqual([])
    expect(routineGaps(asReader).map((gap) => gap.subject)).toEqual([{ kind: 'schema', schema: 'sales' }])
    expect(routineGaps(asWriter)).toEqual([])
    const call = 'exec sales.ship_order 0, 0'
    expect([await answer(owner, call), await answer(reader, call), await answer(writer, call)]).toEqual(['ok', '229', 'ok'])
  })
})

describe('who may execute a routine, and who can see one (0158)', () => {
  // A DENY binds the writer through its own user while its role holds the
  // GRANT, and SQL Server lets the DENY win: read as not executable, as the
  // call answers. An adapter that read the role's grant would offer a
  // routine every call to which is refused.
  test('a DENY under a role’s GRANT is read as not executable', async () => {
    const snapshot = await discoverSqlServer(writer, { schemas: ['probe'], routines: true })
    expect(routine(snapshot, 'denied').executable).toBe(false)
    expect(await answer(writer, 'exec probe.denied 1')).toBe('229')
  })

  // SQL Server lists a routine only to an account that holds a permission
  // on it or VIEW DEFINITION on its schema. The reader, holding EXECUTE on
  // three routines of probe, sees those three, each with its parameters,
  // and a routines gap on probe says the list may be short. An account with
  // VIEW DEFINITION on sales sees ship_order, which it may not run, and no
  // gap; one denied VIEW DEFINITION on a routine does not see it, and
  // cannot be told where it is: a gap on the scope.
  test('a schema without VIEW DEFINITION gives a routines gap, and a schema with it lists what the account may not run', async () => {
    const granted = await discoverSqlServer(reader, { schemas: ['probe'], routines: true })
    expect(names(granted)).toEqual(['probe.granted()', 'probe.peek()', 'probe.peek_value()'])
    expect(routine(granted, 'granted').parameters.map((parameter) => parameter.name)).toEqual(['@n'])
    expect(routine(granted, 'peek_value').result?.databaseType).toBe('int')
    expect(routineGaps(granted).map((gap) => gap.subject)).toEqual([{ kind: 'schema', schema: 'probe' }])

    const viewer = await connectAs('routine_viewer', ['grant view definition on schema::sales to routine_viewer'])
    const seen = await discoverSqlServer(viewer, ROUTINE_SCOPE)
    expect(names(seen)).toEqual(['sales.fn_customer_tenant()', 'sales.ship_order()'])
    expect(seen.routines?.map((entry) => entry.executable)).toEqual([false, false])
    expect(routineGaps(seen)).toEqual([])
    expect(await answer(viewer, 'exec sales.ship_order 0, 0')).toBe('229')

    const denied = await connectAs('routine_denied', [
      'grant view definition on schema::probe to routine_denied',
      'deny view definition on probe.granted to routine_denied',
    ])
    const short = await discoverSqlServer(denied, { schemas: ['probe'], routines: true })
    expect(names(short)).not.toContain('probe.granted()')
    expect(names(short)).toContain('probe.denied()')
    expect(routineGaps(short).map((gap) => gap.subject)).toEqual([{ kind: 'scope' }])
  })
})

describe('which routines are recorded (0158)', () => {
  // A routine Microsoft shipped is the server's, not the deployment's, and
  // is left out though it is in scope; sys.objects does list it, marked.
  test('a routine marked as shipped by Microsoft is left out', async () => {
    const snapshot = await discoverSqlServer(owner, { schemas: ['probe'], routines: true })
    expect(names(snapshot)).not.toContain('probe.shipped()')
    const marked = await owner
      .request()
      .query<{ shipped: boolean }>("select is_ms_shipped as shipped from sys.objects where object_id = object_id(N'probe.shipped')")
    expect(marked.recordset[0]?.shipped).toBe(true)
  })

  // What a later generator will refuse a routine for is recorded, never
  // dropped (0158): a function, which cannot write; a scalar's result; a table-valued function's rows; an
  // OUTPUT parameter; an alias type, a table type, sysname and varbinary,
  // none in the type table. The catalog keeps a parameter's length,
  // precision and scale, which PostgreSQL's does not. EXECUTE AS changes
  // nothing reach can say: every routine already reaches by its owner.
  test('records every routine no action could bind, with the fact that would refuse it', async () => {
    const snapshot = await discoverSqlServer(owner, { schemas: ['probe'], routines: true })
    const shapes = Object.fromEntries((snapshot.routines ?? []).map((entry) => [describeRoutine(entry.ref), shape(entry)]))
    expect(shapes).toMatchObject({
      'probe.granted()': 'procedure writes void owner [in @n: 56:4:10:0 integer]',
      'probe.as_owner()': 'procedure writes void owner []',
      'probe.peek_value()': 'function reads scalar int owner []',
      'probe.returns_text()': 'function reads scalar nvarchar(20) owner [in @n: 56:4:10:0 integer]',
      'probe.rows_inline()': 'function reads set owner [in @n: 56:4:10:0 integer]',
      'probe.rows_multi()': 'function reads set owner [in @n: 56:4:10:0 integer]',
      'probe.with_output()': 'procedure writes void owner [in @n: 56:4:10:0 integer, inout @doubled: 56:4:10:0 integer]',
    })
    expect(routine(snapshot, 'typed').parameters.map((parameter) => [parameter.name, parameter.databaseType, parameter.type])).toEqual([
      ['@a', 'probe.amount', { kind: 'unsupported' }],
      ['@k', 'probe.keys', { kind: 'unsupported' }],
      ['@b', 'varbinary(16)', { kind: 'unsupported' }],
      ['@v', 'varchar(20)', { kind: 'text', maxLength: 20, lengthUnit: 'code-page-bytes', fixedLength: false }],
      ['@nv', 'nvarchar(max)', { kind: 'text', maxLength: null, lengthUnit: 'utf16-code-units', fixedLength: false }],
      ['@x', 'decimal(14,2)', { kind: 'decimal', precision: 14, scale: 2 }],
      ['@s', 'sysname', { kind: 'unsupported' }],
    ])
    expect(routine(snapshot, 'typed').parameters.find((parameter) => parameter.name === '@s')?.typeId).toBe('256:256:0:0')
    expect(routineGaps(snapshot)).toEqual([])
  })

  // Ownership chaining, measured rather than assumed: the reader, who may
  // not read probe.secret, reads it through a procedure and a scalar
  // function it may execute, neither with EXECUTE AS. So a SQL Server
  // routine may act beyond its caller's grants, and reach says so of each.
  test('a procedure and a function reach their owner’s objects past their caller’s grants', async () => {
    expect(await answer(reader, 'select v from probe.secret')).toBe('229')
    expect((await reader.request().query<{ v: number }>('exec probe.peek')).recordset[0]?.v).toBe(42)
    expect((await reader.request().query<{ v: number }>('select probe.peek_value() as v')).recordset[0]?.v).toBe(42)
    const snapshot = await discoverSqlServer(reader, { schemas: ['probe'], routines: true })
    expect([routine(snapshot, 'peek').reach, routine(snapshot, 'peek_value').reach]).toEqual(['owner', 'owner'])
  })
})

describe('the type table (0158)', () => {
  // A later record declares every argument from this table and from
  // nothing else, keyed by user_type_id. An id that named another type
  // than the table says would declare an argument of the wrong type on
  // every image of the matrix: each is held to the server's own answer.
  test('each entry’s id is the one TYPE_ID gives its name', async () => {
    const request = owner.request()
    const names = [...ROUTINE_TYPES.values()]
    const selects = names.map((name, index) => {
      request.input(`name${String(index)}`, mssql.NVarChar(128), name)
      return `select @name${String(index)} as name, type_id(@name${String(index)}) as id`
    })
    const rows = (await request.query<{ name: string; id: number }>(selects.join(' union all '))).recordset
    expect(new Map(rows.map((row) => [row.id, row.name]))).toEqual(ROUTINE_TYPES)
  })

  // A parameter of each type in the table is one a codec speaks: none is
  // read as unsupported, each is identified by the user_type_id the table
  // keys, and the kinds are the ones a column of the same type has.
  test('a parameter of each type in the table is read as the kind a column of that type is', async () => {
    const snapshot = await discoverSqlServer(owner, { schemas: ['probe'], routines: true })
    const every = routine(snapshot, 'every_type')
    expect(every.parameters.map((parameter) => [parameter.typeId.split(':')[0], parameter.type.kind])).toEqual([
      ['36', 'uuid'],
      ['40', 'date'],
      ['41', 'time'],
      ['42', 'timestamp'],
      ['43', 'timestamp'],
      ['48', 'integer'],
      ['52', 'integer'],
      ['56', 'integer'],
      ['58', 'timestamp'],
      ['59', 'float'],
      ['60', 'decimal'],
      ['61', 'timestamp'],
      ['62', 'float'],
      ['104', 'boolean'],
      ['106', 'decimal'],
      ['108', 'decimal'],
      ['122', 'decimal'],
      ['127', 'integer'],
      ['167', 'text'],
      ['175', 'text'],
      ['231', 'text'],
      ['239', 'text'],
    ])
    expect(every.parameters.every((parameter) => ROUTINE_TYPES.has(Number(parameter.typeId.split(':')[0])))).toBe(true)
  })
})
