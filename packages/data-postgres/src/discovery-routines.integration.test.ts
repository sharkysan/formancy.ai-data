import type { MetadataSnapshot, RoutineMeta } from '@formancy/data-core'
import { describeRoutine } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { covers, FIXTURE_SCOPE, MODEL_CASES, ROUTINE_SCOPE, routineDisagreements, snapshotDisagreements, startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ROUTINE_TYPES } from './discovery/routines.js'
import { discoverPostgres } from './index.js'

/**
 * The routines discovery records when its scope asks for them (0158) --
 * against REAL PostgreSQL, loaded with the shared fixture, as its superuser
 * owner, `formancy_reader` and `formancy_writer`.
 *
 * Schema `probe` holds what the fixture does not: a routine of each shape
 * no action could bind, one PUBLIC may execute and one it may not, a
 * SECURITY DEFINER pair over a table the reader may not read, an
 * aggregate, and a STRICT pair beside one called given a NULL (0167).
 * Schema `sealed` holds a function the reader is granted EXECUTE on in a
 * schema it has no USAGE on. Schema `ext` holds an extension's functions
 * beside one of its own. None touches `sales`, which stays exactly what
 * the model describes.
 */
let fixture: PostgresFixture
let owner: Sql
let reader: Sql
let writer: Sql

const opened: Sql[] = []
function connect(url: string): Sql {
  const sql = postgres(url, { onnotice: () => {} })
  opened.push(sql)
  return sql
}

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = connect(fixture.admin)
  reader = connect(fixture.reader)
  writer = connect(fixture.writer)
  await owner.unsafe(`
    create schema probe;
    grant usage on schema probe to formancy_reader, formancy_forms;
    create function probe.open_to_all(n integer) returns void language sql as $$ select $$;
    create function probe.revoked(n integer) returns void language sql as $$ select $$;
    revoke execute on function probe.revoked(integer) from public;

    create procedure probe.a_procedure(n integer) language sql as $$ select $$;
    create procedure probe.out_procedure(n integer, out m integer) language sql as $$ select n $$;
    create function probe.returns_integer(n integer) returns integer language sql immutable as $$ select n $$;
    create function probe.returns_text(n integer) returns text language sql stable as $$ select n::text $$;
    create function probe.returns_set(n integer) returns setof integer language sql as $$ select n $$;
    create function probe.returns_table(n integer) returns table (a integer, b text) language sql as $$ select n, n::text $$;
    create function probe.with_out(n integer, out doubled integer) language sql as $$ select n * 2 $$;
    create function probe.with_inout(inout n integer) language sql as $$ select n $$;
    create function probe.with_variadic(variadic ns integer[]) returns void language sql as $$ select $$;
    create function probe.unnamed(integer) returns void language sql as $$ select $$;
    create domain probe.positive as integer check (value > 0);
    create type probe.mood as enum ('calm', 'cross');
    create function probe.typed(p probe.positive, m probe.mood, b bytea, v varchar(20), c char(2), x numeric(14, 2)) returns void
      language sql as $$ select $$;
    create function probe.overloaded(n integer) returns void language sql as $$ select $$;
    create function probe.overloaded(n bigint, t text) returns void language sql as $$ select $$;
    create function probe.defaulted(n integer) returns void language sql as $$ select $$;
    create function probe.defaulted(n integer, m integer default 0, out doubled integer) language sql as $$ select n * 2 $$;
    create aggregate probe.total(integer) (sfunc = int4pl, stype = integer);
    create function probe.every_type(a bool, b int8, c int2, d int4, e text, f float4, g float8, h varchar, i date, j time, k timestamp,
      l timestamptz, m numeric, n uuid) returns void language sql as $$ select $$;
    create function probe.strict_seven(n integer) returns integer language sql strict as $$ select 7 $$;
    create function probe.null_on_null_seven(n integer) returns integer language sql returns null on null input as $$ select 7 $$;
    create function probe.called_seven(n integer) returns integer language sql called on null input as $$ select 7 $$;

    create table probe.secret (v integer);
    insert into probe.secret values (42);
    create function probe.peek_as_owner() returns integer language sql stable security definer as $$ select v from probe.secret $$;
    create function probe.peek_as_caller() returns integer language sql stable as $$ select v from probe.secret $$;

    create schema sealed;
    create function sealed.inside() returns void language sql as $$ select $$;
    grant execute on function sealed.inside() to formancy_reader;

    create schema ext;
    create extension pgcrypto schema ext;
    create function ext.own() returns void language sql as $$ select $$;
  `)
})

afterAll(async () => {
  await Promise.all(opened.map((sql) => sql.end()))
  await fixture?.stop()
})

const ROLLED_BACK = new Error('rolled back')

/** The server's answer to one statement as `sql`'s account, rolled back: `ok`, or the SQLSTATE it refused with. */
async function answer(sql: Sql, statement: string): Promise<string> {
  let said = 'ok'
  await sql
    .begin(async (tx) => {
      await tx.unsafe(statement)
      throw ROLLED_BACK
    })
    .catch((error: unknown) => {
      if (error !== ROLLED_BACK) said = String((error as { code?: unknown }).code)
    })
  return said
}

function routine(snapshot: MetadataSnapshot, name: string, signature?: string): RoutineMeta {
  const found = snapshot.routines?.find((entry) => entry.ref.name === name && (signature === undefined || entry.ref.signature === signature))
  if (found === undefined) throw new Error(`${name} is not among ${String(snapshot.routines?.map((entry) => describeRoutine(entry.ref)))}`)
  return found
}

/** A routine as one line: kind, effects, returns and its result, reach, and each parameter as `mode name: typeId kind`. */
function shape(entry: RoutineMeta): string {
  const parameters = entry.parameters.map((parameter) => `${parameter.mode} ${parameter.name || '(unnamed)'}: ${parameter.typeId} ${parameter.type.kind}`)
  const result = entry.result === null ? '' : ` ${entry.result.databaseType}`
  return `${entry.kind} ${entry.effects} ${entry.returns}${result} ${entry.reach} [${parameters.join(', ')}]`
}

describe('the fixture’s routine (0158)', () => {
  // One fixture written twice (0005): ship_order is a function returning
  // void here and a procedure on SQL Server, typed alike. The owner reads
  // it as the model says, and nothing else in sales; the objects are the
  // model's still. Asked for, the routines are in the snapshot and its
  // fingerprint; not asked for, nothing more is read and the snapshot is
  // the one discovery made before, with no routines at all.
  test('the owner discovers the routines the model gives PostgreSQL, and only when the scope asks', covers('postgres', MODEL_CASES.routines), async () => {
    const [asked, unasked] = await Promise.all([discoverPostgres(owner, ROUTINE_SCOPE), discoverPostgres(owner, FIXTURE_SCOPE)])
    expect(routineDisagreements(asked)).toEqual([])
    expect(snapshotDisagreements(asked)).toEqual([])
    expect(asked.routines?.map((entry) => describeRoutine(entry.ref))).toEqual(['sales.ship_order(pg_catalog.int8, pg_catalog.int4)'])
    expect(asked.scope).toEqual(ROUTINE_SCOPE)
    expect(unasked).not.toHaveProperty('routines')
    expect(unasked.scope).toEqual(FIXTURE_SCOPE)
    expect([asked.objects, asked.gaps]).toEqual([unasked.objects, unasked.gaps])
    expect(asked.fingerprint).not.toBe(unasked.fingerprint)
  })

  // Whether an account may execute the routine is the server's own answer:
  // the writer through its role formancy_forms, the reader not, since the
  // fixture revokes PUBLIC's EXECUTE. pg_proc shows every role every
  // routine, so the reader is told "may not", never "cannot tell": no gap.
  // Each answer is the one a call gets.
  test('reads EXECUTE as the owner, the reader and the writer, as a call answers', covers('postgres', MODEL_CASES.routineAccess), async () => {
    const [asOwner, asReader, asWriter] = await Promise.all([
      discoverPostgres(owner, ROUTINE_SCOPE),
      discoverPostgres(reader, ROUTINE_SCOPE),
      discoverPostgres(writer, ROUTINE_SCOPE),
    ])
    expect(routineDisagreements(asOwner, 'owner')).toEqual([])
    expect(routineDisagreements(asReader, 'reader')).toEqual([])
    expect(routineDisagreements(asWriter, 'writer')).toEqual([])
    expect([asReader, asWriter].flatMap((snapshot) => snapshot.gaps)).toEqual([])
    const call = 'select sales.ship_order(0, 0)'
    expect(await Promise.all([answer(owner, call), answer(reader, call), answer(writer, call)])).toEqual(['ok', '42501', 'ok'])
  })
})

describe('who may execute a routine (0158)', () => {
  // PostgreSQL grants EXECUTE on a new function to PUBLIC, so every function
  // a deployment did not revoke is executable by any account; a revoke from
  // PUBLIC is read as the reader's "no". An adapter that read only grants
  // made to the account would call open_to_all closed.
  test('EXECUTE held through PUBLIC is read as executable, and a revoke from PUBLIC as not', async () => {
    const snapshot = await discoverPostgres(reader, { schemas: ['probe'], routines: true })
    expect([routine(snapshot, 'open_to_all').executable, routine(snapshot, 'revoked').executable]).toEqual([true, false])
    expect([await answer(reader, 'select probe.open_to_all(1)'), await answer(reader, 'select probe.revoked(1)')]).toEqual(['ok', '42501'])
  })

  // A function in a schema the account has no USAGE on cannot be called,
  // whatever EXECUTE says. pg_catalog lists it to every role, so it is
  // listed, not executable, and no gap says anything is hidden: on
  // PostgreSQL nothing is. Without the USAGE check the reader's grant would
  // read as a routine it may run.
  test('a routine in a schema without USAGE is listed, not executable, and behind no gap', async () => {
    const snapshot = await discoverPostgres(reader, { schemas: ['sealed'], routines: true })
    expect(snapshot.routines?.map((entry) => [describeRoutine(entry.ref), entry.executable])).toEqual([['sealed.inside()', false]])
    expect(snapshot.gaps).toEqual([])
    expect(await answer(reader, 'select sealed.inside()')).toBe('42501')
  })
})

describe('which routines are recorded (0158)', () => {
  // An extension's functions are the extension's, replaced by its upgrade,
  // and no deployment's logic: left out, so installing or upgrading one
  // moves no fingerprint. Its schema's own function is recorded. pg_proc
  // does hold pgcrypto's there, so the absence is the filter's.
  test("an extension's functions are left out, and a function of the same schema is recorded", async () => {
    const snapshot = await discoverPostgres(owner, { schemas: ['ext'], routines: true })
    expect(snapshot.routines?.map((entry) => describeRoutine(entry.ref))).toEqual(['ext.own()'])
    const [held] = await owner<{ count: number }[]>`
      select pg_catalog.count(*)::int as count from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'ext' and p.proname = 'digest'`
    expect(held?.count).toBeGreaterThan(0)
  })

  // What a later generator will refuse a routine for is recorded, never
  // dropped (0158): a procedure, a result, a set, an OUT, INOUT, VARIADIC or
  // TABLE argument, a parameter with no name, a type no codec speaks -- so
  // it can say which rule refused it. A procedure with an OUT argument
  // returns a record, as PostgreSQL files it. pg_proc keeps no typmod, so varchar(20) is varchar and
  // numeric(14,2) numeric, and char(2) is bare bpchar, which no codec speaks.
  // An aggregate is no routine a statement calls with values, and is not
  // listed. Overloads are two routines, told apart by their signatures.
  test('records every routine no action could bind, with the fact that would refuse it', async () => {
    const snapshot = await discoverPostgres(owner, { schemas: ['probe'], routines: true })
    const shapes = Object.fromEntries((snapshot.routines ?? []).map((entry) => [describeRoutine(entry.ref), shape(entry)]))
    expect(shapes).toMatchObject({
      'probe.a_procedure(pg_catalog.int4)': 'procedure writes void account [in n: 23 integer]',
      'probe.out_procedure(pg_catalog.int4)': 'procedure writes scalar record account [in n: 23 integer, out m: 23 integer]',
      'probe.returns_integer(pg_catalog.int4)': 'function reads scalar integer account [in n: 23 integer]',
      'probe.returns_text(pg_catalog.int4)': 'function reads scalar text account [in n: 23 integer]',
      'probe.returns_set(pg_catalog.int4)': 'function writes set account [in n: 23 integer]',
      'probe.returns_table(pg_catalog.int4)': 'function writes set account [in n: 23 integer, table a: 23 integer, table b: 25 text]',
      'probe.with_out(pg_catalog.int4)': 'function writes scalar integer account [in n: 23 integer, out doubled: 23 integer]',
      'probe.with_inout(pg_catalog.int4)': 'function writes scalar integer account [inout n: 23 integer]',
      'probe.with_variadic(pg_catalog._int4)': 'function writes void account [variadic ns: 1007 unsupported]',
      'probe.unnamed(pg_catalog.int4)': 'function writes void account [in (unnamed): 23 integer]',
      'probe.overloaded(pg_catalog.int4)': 'function writes void account [in n: 23 integer]',
      'probe.overloaded(pg_catalog.int8, pg_catalog.text)': 'function writes void account [in n: 20 integer, in t: 25 text]',
      'probe.peek_as_owner()': 'function reads scalar integer owner []',
      'probe.peek_as_caller()': 'function reads scalar integer account []',
    })
    const typed = routine(snapshot, 'typed')
    expect(typed.ref.signature).toBe('probe.positive, probe.mood, pg_catalog.bytea, pg_catalog."varchar", pg_catalog.bpchar, pg_catalog."numeric"')
    expect(typed.parameters.map((parameter) => [parameter.name, parameter.databaseType, parameter.type])).toEqual([
      ['p', 'probe.positive', { kind: 'unsupported' }],
      ['m', 'probe.mood', { kind: 'unsupported' }],
      ['b', 'bytea', { kind: 'unsupported' }],
      ['v', 'character varying', { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }],
      ['c', 'character', { kind: 'unsupported' }],
      ['x', 'numeric', { kind: 'decimal', precision: null, scale: null }],
    ])
    expect(Object.keys(shapes)).not.toContain('probe.total(pg_catalog.int4)')
    expect(snapshot.gaps).toEqual([])
  })

  // Which parameters have a default is pg_proc's `pronargdefaults`, the last
  // of the arguments a call passes. Recorded because PostgreSQL makes it
  // decide which call can be made at all: beside an overload that differs
  // only by a trailing defaulted parameter, every call by the shorter
  // signature is ambiguous, cast or named -- 42725 -- while the longer one
  // answers. An OUT parameter takes no value and has none. Without it, a
  // generator would offer the shorter routine, and every run would fail.
  test('records which parameters have a default, which makes a call by the shorter of two overloads ambiguous', async () => {
    const snapshot = await discoverPostgres(owner, { schemas: ['probe'], routines: true })
    const defaults = (signature: string) => routine(snapshot, 'defaulted', signature).parameters.map((parameter) => [parameter.name, parameter.hasDefault])
    expect(defaults('pg_catalog.int4')).toEqual([['n', false]])
    expect(defaults('pg_catalog.int4, pg_catalog.int4')).toEqual([
      ['n', false],
      ['m', true],
      ['doubled', false],
    ])
    expect(
      await Promise.all(
        ['select probe.defaulted(1)', 'select probe.defaulted(1::pg_catalog.int4)', 'select probe.defaulted(n => 1)', 'select probe.defaulted(1, 2)'].map(
          (call) => answer(owner, call),
        ),
      ),
    ).toEqual(['42725', '42725', '42725', 'ok'])
  })

  // SECURITY DEFINER is what lets a routine act beyond its caller's grants,
  // and `reach` says so. Measured, not assumed: the reader, who may not read
  // probe.secret, reads it through the definer function and is refused
  // through the invoker one.
  test('a SECURITY DEFINER routine reaches past its caller’s grants, and is read as the owner’s reach', async () => {
    expect([await answer(reader, 'select probe.peek_as_owner()'), await answer(reader, 'select probe.peek_as_caller()')]).toEqual(['ok', '42501'])
    const [peeked] = await reader<{ v: number }[]>`select probe.peek_as_owner() as v`
    expect(peeked?.v).toBe(42)
  })
})

describe('whether PostgreSQL calls a routine given a NULL (0167)', () => {
  // STRICT, and its other spelling RETURNS NULL ON NULL INPUT, make
  // PostgreSQL answer NULL for a call given a NULL argument without running
  // the body: what a run over a record whose field is NULL would answer
  // done for (0160), and what the generator refuses to bind. Each is
  // recorded not called, from `proisstrict`, and every other routine --
  // a procedure, which cannot be declared either, among them -- called;
  // none is left unread, since pg_proc shows every role every routine. The
  // server's own answer to a NULL is asserted beside it, so the fact is
  // held to what the engine does and not to its spelling. First run in CI.
  test('a STRICT function is recorded as not called given a NULL, as the server answers one, and every other routine as called', async () => {
    const snapshot = await discoverPostgres(reader, { schemas: ['probe'], routines: true })
    expect(['strict_seven', 'null_on_null_seven', 'called_seven', 'a_procedure', 'open_to_all'].map((name) => routine(snapshot, name).onNull)).toEqual([
      'not-called',
      'not-called',
      'called',
      'called',
      'called',
    ])
    expect((snapshot.routines ?? []).filter((entry) => entry.onNull === undefined).map((entry) => describeRoutine(entry.ref))).toEqual([])
    const [answers] = await owner<{ strict: number | null; spelled: number | null; called: number | null }[]>`
      select probe.strict_seven(null) as strict, probe.null_on_null_seven(null) as spelled, probe.called_seven(null) as called`
    expect(answers).toEqual({ strict: null, spelled: null, called: 7 })
  })
})

describe('the type table (0158)', () => {
  // A later record spells every cast from this table and from nothing else,
  // keyed by oid. An oid that named another type than the table says would
  // cast an argument to the wrong type on every image of the matrix: each
  // is held to the server's own answer for its name.
  test('each entry’s oid is the one the server gives its name in pg_catalog', async () => {
    const names = [...ROUTINE_TYPES.values()]
    const rows = await owner<{ name: string; oid: number }[]>`
      select n.name, pg_catalog.to_regtype('pg_catalog.' operator(pg_catalog.||) n.name)::pg_catalog.oid as oid
      from pg_catalog.unnest(${names}::pg_catalog.text[]) as n (name)`
    expect(new Map(rows.map((row) => [row.oid, row.name]))).toEqual(ROUTINE_TYPES)
  })

  // A parameter of each type in the table is one a codec speaks: none is
  // read as unsupported, each is identified by the oid the table keys, and
  // the kinds are the ones a column of the same type has.
  test('a parameter of each type in the table is read as the kind a column of that type is', async () => {
    const snapshot = await discoverPostgres(owner, { schemas: ['probe'], routines: true })
    const every = routine(snapshot, 'every_type')
    expect(every.parameters.map((parameter) => [parameter.typeId, parameter.type.kind])).toEqual([
      ['16', 'boolean'],
      ['20', 'integer'],
      ['21', 'integer'],
      ['23', 'integer'],
      ['25', 'text'],
      ['700', 'float'],
      ['701', 'float'],
      ['1043', 'text'],
      ['1082', 'date'],
      ['1083', 'time'],
      ['1114', 'timestamp'],
      ['1184', 'timestamp'],
      ['1700', 'decimal'],
      ['2950', 'uuid'],
    ])
    expect(every.parameters.every((parameter) => ROUTINE_TYPES.has(Number(parameter.typeId)))).toBe(true)
  })
})
