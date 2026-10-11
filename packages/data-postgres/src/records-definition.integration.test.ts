import { createHash } from 'node:crypto'
import { describedOf, findObject } from '@formancy/data-core'
import type { ApiValue, ColumnMeta, Described, DescribedTable, MetadataSnapshot, ObjectRef, RecordOutcome, RecordTarget, RecordValue, UpdateRequest } from '@formancy/data-core'
import { covers, driftingCase, driftingOn, FIXTURE_SCOPE, MODEL_CASES, PARITY_SCOPE, sharedDrifting, startPostgresFixture } from '@formancy/data-fixtures'
import type { DriftingCase, PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'
import { factsOf, spellingsOf } from './records/definition.js'
import { describeStatement, readStatement } from './records/sql.js'
import { run, Statement } from './sql/statement.js'

/*
 * The root's definition on PostgreSQL (0041), against the shared fixture's
 * real server: every write runs only while the table still has the
 * definition it was decided over, and the definition moves for every change
 * a description reads and for nothing else.
 *
 * `DRIFTING` (data-fixtures) is the table of changes, the same one the SQL
 * Server suite and the server's runtime suite run; each case is declared
 * with `covers()` as a shared case (0035). The owner makes every change, and
 * every case is described as the fixture's writer as well, so the
 * definition is held to being the same for an account that is not the
 * owner.
 */

let fixture: PostgresFixture
let owner: Sql
/** The fixture's writer, granted the case tables: an account that is not the owner, as the runtime's usually is. */
let restricted: Sql
/** Every case table as discovery saw it before any ALTER: the types a published form would bind with. */
let published: MetadataSnapshot

const SCOPE = { schemas: ['drifting'] }
const ID = { name: 'id', type: { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } } as const

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  await owner.unsafe('create schema drifting')
  // The writer's role may use the schema and write its tables, those an ALTER creates included.
  await owner.unsafe('grant usage on schema drifting to formancy_forms')
  await owner.unsafe('alter default privileges in schema drifting grant select, insert, update on tables to formancy_forms')
  for (const entry of driftingOn('postgres')) for (const statement of entry.setUp.postgres as readonly string[]) await owner.unsafe(statement)
  published = await discoverPostgres(owner, SCOPE)
  restricted = postgres(fixture.writer, { onnotice: () => {} })
})

afterAll(async () => {
  await restricted?.end()
  await owner?.end()
  await fixture?.stop()
})

const ref = (table: string): ObjectRef => ({ schema: 'drifting', name: table })

function described(outcome: Described): DescribedTable {
  if (!outcome.ok) throw new Error(`expected a description, got ${outcome.code}: ${outcome.message}`)
  return outcome.described
}

function succeeded(outcome: RecordOutcome): Extract<RecordOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.code}: ${outcome.message}`)
  return outcome
}

/** A column of a case table as `snapshot` has it. */
function column(snapshot: MetadataSnapshot, table: string, name: string): ColumnMeta {
  const found = findObject(snapshot, ref(table))?.columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`drifting.${table} has no column ${name}`)
  return found
}

/**
 * A value of a case table's column, canonical for the type `snapshot` gives
 * it, as a codec would make it: a case's answers hold before and after its
 * ALTER, and a decimal retyped to a float is a number where it was a string.
 */
function value(snapshot: MetadataSnapshot, table: string, name: string, held: ApiValue): RecordValue {
  const { type } = column(snapshot, table, name)
  const canonical = type.kind === 'float' && typeof held === 'string' ? Number(held) : type.kind !== 'float' && typeof held === 'number' ? String(held) : held
  return { name, type, value: canonical }
}

function target(table: string): RecordTarget & UpdateRequest['target'] {
  return { table: ref(table), identity: [ID], concurrency: { kind: 'version-column', column: 'row_version' } }
}

/** The owner's view of a case table: row 1 and the number of rows. */
async function held(table: string): Promise<{ row: string | null; rows: number }> {
  const [found] = await owner.unsafe<Array<{ row: string | null; rows: number }>>(
    `select (select pg_catalog.row_to_json(t)::text from drifting.${table} t where t.id = 1) as row, (select pg_catalog.count(*)::int from drifting.${table}) as rows`,
  )
  return found as { row: string | null; rows: number }
}

/** A write of `memo`, and a create of the case's answers and `memo`, typed from `snapshot`, under `definition`. */
function writes(entry: DriftingCase, snapshot: MetadataSnapshot, version: string, definition: string) {
  const update = { target: target(entry.table), key: [{ ...ID, value: '1' }], set: [value(snapshot, entry.table, 'memo', 'written')], expectedVersion: version, filters: { kind: 'unrestricted' } as const, through: [], returning: [], definition }
  const values = [...Object.entries(entry.insert).map(([name, held]) => value(snapshot, entry.table, name, held)), value(snapshot, entry.table, 'memo', 'created')]
  const insert = { target: target(entry.table), values, returning: [ID], definition }
  return { update, insert }
}

const declared = (entry: DriftingCase) => (sharedDrifting().includes(entry) ? covers('postgres', driftingCase(entry.name)) : {})

describe('the definition, change by change', () => {
  for (const entry of driftingOn('postgres')) {
    // A guard that let the old definition write is the reproduction's 1234.57;
    // a definition that moved for a comment or an index would refuse every
    // write after harmless DDL; one that did not move for a key or a typmod
    // would let a write through the change it was decided before.
    test(`${entry.name}: the definition moves exactly when the change is one a description reads, and a write decided before it is refused`, declared(entry), async () => {
    const records = createPostgresRecords(owner)
    const read = { target: target(entry.table), key: [{ ...ID, value: '1' }], columns: [ID], filters: { kind: 'unrestricted' } as const, through: [] }
    const before = described(await records.describe(ref(entry.table)))
    // The read's description is the table as that statement found it, and the same as describe's.
    const first = await records.read(read)
    expect(first).toMatchObject({ ok: true, described: before, record: { version: '1' } })
    // As the writer too: the catalog it reads is every account's, so its definition is the owner's.
    const asRestricted = createPostgresRecords(restricted)
    expect(described(await asRestricted.describe(ref(entry.table))).definition).toBe(before.definition)

    // The guard passes on the table as it is: a write decided over this description is written.
    const unchanged = writes(entry, published, '1', before.definition)
    expect(succeeded(await records.update(unchanged.update)).version).toBe('2')

    for (const statement of entry.alter.postgres as readonly string[]) await owner.unsafe(statement)
    const altered = await held(entry.table)
    const now = await records.describe(ref(entry.table))
    const stale = writes(entry, published, entry.name === 'readded-same-definition' ? '1' : '2', before.definition)

    if (!now.ok) {
      // A relation discovery no longer describes is gone as a request sees it.
      expect(now).toMatchObject({ code: 'schema-changed' })
      expect((await records.read(read)) as { code?: string }).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await records.update(stale.update)).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await records.insert(stale.insert)).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await held(entry.table)).toEqual(altered)
      return
    }
    expect(now.described.definition !== before.definition, 'the definition moved').toBe(entry.moves)
    const second = await records.read(read)
    expect(second).toMatchObject({ ok: true, described: now.described })
    // A digest that read anything the account's privileges decide would move for one account and not another.
    expect(described(await asRestricted.describe(ref(entry.table))).definition, 'the writer describes what the owner does').toBe(now.described.definition)

    if (entry.moves) {
      // Decided over the old definition: refused, and the row is as the ALTER left it.
      expect(await records.update(stale.update)).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await records.insert(stale.insert)).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await asRestricted.insert(stale.insert)).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await held(entry.table)).toEqual(altered)
    }
    // Decided over the table as it is now, they are what the column now does.
    const after = await discoverPostgres(owner, SCOPE)
    const fresh = writes(entry, after, (second as { record: { version: string } }).record.version, now.described.definition)
    expect(succeeded(await records.update(fresh.update)).values).toEqual({})
    expect(succeeded(await records.insert(fresh.insert)).values).toEqual({ id: expect.any(String) })
    if (entry.name === 'readded-same-definition') {
      // The limitation, held: the version column started again at its default, which drift does not see.
      expect(altered.row).toMatch(/"row_version":1\b/)
    }
    })
  }
})

/** A copy of a case's table under another name, so a test can change it without reaching the case's. */
async function copyOf(name: string, as: string): Promise<DriftingCase> {
  const entry = driftingOn('postgres').find((candidate) => candidate.name === name) as DriftingCase
  const renamed = (statements: readonly string[] | undefined) => (statements ?? []).map((statement) => statement.replaceAll(entry.table, as))
  const copy = { ...entry, table: as, setUp: { postgres: renamed(entry.setUp.postgres) }, alter: { postgres: renamed(entry.alter.postgres) } }
  for (const statement of copy.setUp.postgres) await owner.unsafe(statement)
  return copy
}

async function alter(entry: DriftingCase): Promise<void> {
  for (const statement of entry.alter.postgres as readonly string[]) await owner.unsafe(statement)
}

describe('a statement that fails on a moved table', () => {
  // PostgreSQL folds a constant's cast to its column while it plans the
  // statement, before any WHERE runs: ten characters into the narrowed
  // varchar(8) is 22001, an overflow of the narrowed numeric 22003, though
  // the guard would have refused. Without the definition asked after the
  // failure, the person is told "too long" about a form whose table moved,
  // and fixes a value that was never the problem.
  test('is schema-changed, and the same value under the new definition is what the column says', async () => {
    const records = createPostgresRecords(owner)
    for (const [name, field, sent, refused] of [
      ['tightened-text', 'code', 'ABCDEFGHIJ', 'too-long'],
      ['narrowed-decimal', 'amount', '12345678.1234', 'out-of-range'],
    ] as const) {
      const entry = await copyOf(name, `${name.replaceAll('-', '_')}_failing`)
      const snapshot = await discoverPostgres(owner, SCOPE)
      const old = described(await records.describe(ref(entry.table))).definition
      await alter(entry)
      const update = (definition: string, types: MetadataSnapshot) => ({ ...writes(entry, types, '1', definition).update, set: [value(types, entry.table, field, sent)] })
      const insert = (definition: string, types: MetadataSnapshot) => ({ target: target(entry.table), values: [value(types, entry.table, field, sent)], returning: [], definition })
      expect(await records.update(update(old, snapshot)), name).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await records.insert(insert(old, snapshot)), name).toMatchObject({ ok: false, code: 'schema-changed' })
      const now = described(await records.describe(ref(entry.table))).definition
      const after = await discoverPostgres(owner, SCOPE)
      expect(await records.update(update(now, after)), name).toMatchObject({ ok: false, code: refused })
      expect(await records.insert(insert(now, after)), name).toMatchObject({ ok: false, code: refused })
      expect((await held(entry.table)).rows).toBe(1)
    }
  })
})

describe('what a refused write leaves behind', () => {
  // The record is not written; a statement-level trigger fires for the
  // statement that changed no row, and in autocommit what it did is kept.
  // SQL Server's batch rolls the same back. Held here so the difference the
  // limitation names cannot pass unnoticed.
  test('a statement-level trigger still fires, and what it did is kept', async () => {
    const entry = await copyOf('tightened-text', 'tightened_text_logged')
    await owner.unsafe(`
      create table drifting.statement_log (at bigint generated always as identity, operation text not null);
      create function drifting.log_statement() returns trigger language plpgsql as $$ begin insert into drifting.statement_log (operation) values (tg_op); return null; end $$;
      create trigger logged after insert or update on drifting.tightened_text_logged for each statement execute function drifting.log_statement();`)
    const records = createPostgresRecords(owner)
    const snapshot = await discoverPostgres(owner, SCOPE)
    const old = described(await records.describe(ref(entry.table))).definition
    await alter(entry)
    const stale = writes(entry, snapshot, '1', old)
    expect(await records.update(stale.update)).toMatchObject({ ok: false, code: 'schema-changed' })
    expect(await records.insert({ ...stale.insert, values: stale.insert.values.filter((entry) => entry.name !== 'code') })).toMatchObject({ ok: false, code: 'schema-changed' })
    expect([...(await owner`select operation from drifting.statement_log order by at`)].map((row) => row.operation)).toEqual(['UPDATE', 'INSERT'])
    expect((await held(entry.table)).rows).toBe(1)
  })
})

/** How many plan nodes of `text` read pg_attribute: the catalog walk the facts and their spellings make, counted. */
async function attributeScans(text: string, params: readonly (string | null)[]): Promise<number> {
  const [row] = await owner.unsafe<Array<{ 'QUERY PLAN': unknown }>>(`explain (format json) ${text}`, [...params])
  const count = (node: unknown): number => {
    if (Array.isArray(node)) return node.reduce((sum: number, entry) => sum + count(entry), 0)
    if (typeof node !== 'object' || node === null) return 0
    const own = (node as Record<string, unknown>)['Relation Name'] === 'pg_attribute' ? 1 : 0
    return own + Object.values(node).reduce((sum: number, entry) => sum + count(entry), 0)
  }
  return count(row?.['QUERY PLAN'])
}

describe('what a description costs the catalog', () => {
  // The facts are the catalog walk every describe and read makes, and the
  // digest is computed over them in the same statement. Measured
  // (2026-10-10, before this test): the planner pulled the derived table
  // that holds the facts up into the statement and planned the walk twice,
  // once for the facts and once for their digest -- eleven scans of
  // pg_attribute where the facts and their spellings make six, twice the
  // planning and execution of every describe and read. Held to the facts and
  // the spellings each computed once, as one statement of the two alone
  // computes them.
  test('describe and a read walk the catalog once for the facts, whatever the digest asks of them', async () => {
    const table: ObjectRef = { schema: 'sales', name: 'order' }
    const once = new Statement()
    const reference = await attributeScans(`select ${factsOf(once, table)}, ${spellingsOf(once, table)}`, once.params)
    expect(reference).toBeGreaterThan(0)
    const describing = describeStatement(table)
    expect(await attributeScans(describing.text, describing.params)).toBe(reference)
    const id = { name: 'id', type: { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } } as const
    const reading = readStatement({ target: { table, identity: [id], concurrency: null }, key: [{ ...id, value: '1' }], columns: [id], filters: { kind: 'unrestricted' }, through: [] }, [], [])
    expect(await attributeScans(reading.text, reading.params)).toBe(reference)
  })
})

/** The settings 0016's suites vary, one driver each, and all of them at once. */
const SETTINGS: ReadonlyArray<Record<string, string>> = [
  {},
  { DateStyle: 'SQL, DMY' },
  { TimeZone: 'Pacific/Chatham' },
  { IntervalStyle: 'sql_standard' },
  { extra_float_digits: '-3' },
  { default_transaction_isolation: 'repeatable read' },
  { search_path: 'public, pg_catalog' },
  { search_path: 'drifting_types, public' },
  { DateStyle: 'SQL, DMY', TimeZone: 'Pacific/Chatham', IntervalStyle: 'sql_standard', extra_float_digits: '-3', search_path: 'drifting_types, public' },
]

describe('the description and discovery', () => {
  // A description that read a table otherwise than discovery would make the
  // runtime decide over another table than review did. And a digest that is
  // not the SHA-256 of the facts the description parsed would guard
  // something nobody read. As the owner, the reader and the writer, over
  // every table of the fixture and the parity schema.
  test('describe reads every fixture table as discovery does, and its digest is the SHA-256 of the facts it parsed', covers('postgres', MODEL_CASES.described), async () => {
    // Every kind of relation discovery describes, which the fixture's schemas
    // do not all have: a materialized view and a partitioned table, and a
    // partition beside it that is described through its parent. A
    // description that mapped a kind otherwise than discovery would have the
    // runtime see a view where review saw a table, and refuse by a rule
    // review never ran.
    await owner.unsafe(`
      create schema drifting_kinds;
      create table drifting_kinds.ranged (id integer not null, label text, constraint pk_ranged primary key (id)) partition by range (id);
      create table drifting_kinds.ranged_low partition of drifting_kinds.ranged for values from (minvalue) to (1000);
      create materialized view drifting_kinds.summary as select id, label from drifting_kinds.ranged;
      create unique index ux_summary_id on drifting_kinds.summary (id);
      create view drifting_kinds.labels as select label from drifting_kinds.ranged;`)
    const KINDS_SCOPE = { schemas: ['drifting_kinds'] }
    for (const uri of [fixture.admin, fixture.reader, fixture.writer]) {
      const sql = postgres(uri, { onnotice: () => {} })
      try {
        const records = createPostgresRecords(sql)
        for (const scope of [FIXTURE_SCOPE, PARITY_SCOPE, KINDS_SCOPE]) {
          const snapshot = await discoverPostgres(sql, scope)
          for (const object of snapshot.objects) {
            const where = `${new URL(uri).username}: ${object.ref.schema}.${object.ref.name}`
            const { definition, ...description } = described(await records.describe(object.ref))
            expect(description, where).toEqual(describedOf(snapshot, object.ref))
            const statement = describeStatement(object.ref)
            const [facts, digest] = (await run(sql, statement.text, statement.params)).rows[0] as [string, string]
            expect(createHash('sha256').update(facts, 'utf8').digest('hex'), where).toBe(digest)
            expect(definition, where).toBe(`${digest}@read committed`)
          }
        }
      } finally {
        await sql.end()
      }
    }
  })

  // The guard must not depend on a session setting 0016 promises changes no
  // answer. A spelled default or a type qualified by search_path in the
  // facts would move the digest with DateStyle or search_path, and every
  // write from a differently configured driver would be refused.
  test('the digest is the same under every setting, and the description is discovery’s on the same driver', async () => {
    await owner.unsafe(`
      create schema drifting_types;
      create domain drifting_types.amount as numeric(10, 2);
      create table drifting.spelled (id integer primary key, opened date not null default '2026-10-08', at timestamptz default '2026-10-08 12:00:00+02', span interval default '1 day 02:00:00', ratio double precision default 0.1, amount drifting_types.amount);`)
    const digests = new Set<string>()
    for (const connection of SETTINGS) {
      const sql = postgres(fixture.admin, { onnotice: () => {}, connection })
      try {
        const records = createPostgresRecords(sql)
        const snapshot = await discoverPostgres(sql, SCOPE)
        const { definition, ...description } = described(await records.describe(ref('spelled')))
        expect(description, JSON.stringify(connection)).toEqual(describedOf(snapshot, ref('spelled')))
        digests.add(definition.split('@')[0] as string)
      } finally {
        await sql.end()
      }
    }
    expect(digests.size).toBe(1)
  })
})

/** The owner's ALTER of `entry`, run in a transaction it holds open: resolved once the ALTER holds its lock, and committed by `commit`. */
async function holdAlter(entry: DriftingCase): Promise<{ commit(): Promise<void> }> {
  let altered = (): void => {}
  let release = (): void => {}
  const done = new Promise<void>((resolve) => (altered = resolve))
  const holding = owner.begin(async (tx) => {
    for (const statement of entry.alter.postgres as readonly string[]) await tx.unsafe(statement)
    altered()
    await new Promise<void>((resolve) => (release = resolve))
  })
  await Promise.race([done, holding])
  return {
    commit: async () => {
      release()
      await holding
    },
  }
}

/** Waits until `count` other sessions wait for a lock on `table`. */
async function waiting(table: string, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await owner`
      select count(*)::int as n from pg_catalog.pg_locks l
      where not l.granted and l.relation = ${`drifting.${table}`}::regclass`
    if ((row?.n as number) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${String(count)} sessions never waited for drifting.${table}`)
}

describe('an ALTER that commits while a request waits for it', () => {
  // The window between a description and its write. The owner holds the
  // ALTER uncommitted while a create, an update and a read queue behind its
  // lock, then commits. Under READ COMMITTED each statement takes its
  // snapshot after the lock and the guard sees the change. Under REPEATABLE
  // READ a statement's snapshot is taken before it waits: without the lock
  // taken first, the read behind a rewrite answers no row, and the write
  // stores the narrowed value (the probes before 0041 measured both).
  for (const isolation of ['read committed', 'repeatable read'] as const) {
    for (const name of ['narrowed-decimal', 'sequence-default'] as const) {
      test(`${name} under ${isolation}: the writes are schema-changed, nothing is written, and the read is the table after`, async () => {
        const entry = await copyOf(name, `${name.replaceAll('-', '_')}_${isolation.replace(' ', '_')}`)
        const snapshot = await discoverPostgres(owner, SCOPE)
        const sql = postgres(fixture.admin, { onnotice: () => {}, connection: { default_transaction_isolation: isolation } })
        try {
          const records = createPostgresRecords(sql)
          const old = described(await records.describe(ref(entry.table))).definition
          expect(old.endsWith(`@${isolation}`)).toBe(true)
          const stale = writes(entry, snapshot, '1', old)
          const read = { target: target(entry.table), key: [{ ...ID, value: '1' }], columns: [ID], filters: { kind: 'unrestricted' } as const, through: [] }
          const altering = await holdAlter(entry)
          const pending = [records.insert(stale.insert), records.update(stale.update), records.read(read)] as const
          await waiting(entry.table, 3)
          await altering.commit()
          const [inserted, updated, reread] = await Promise.all(pending)
          expect(inserted).toMatchObject({ ok: false, code: 'schema-changed' })
          expect(updated).toMatchObject({ ok: false, code: 'schema-changed' })
          const now = described(await records.describe(ref(entry.table)))
          expect(reread).toMatchObject({ ok: true, described: { definition: now.definition }, record: { version: '1' } })
          expect(await held(entry.table)).toMatchObject({ rows: 1, row: expect.stringMatching(/"memo":null/) })
        } finally {
          await sql.end()
        }
      })
    }
  }

  // A pool whose connections differ in isolation: described on a READ
  // COMMITTED one, a write that lands on a REPEATABLE READ one takes the
  // read-committed path, and its guard requires that isolation. Without the
  // requirement, a create waiting behind a narrowing stored 1234.57.
  test('a write on a connection whose isolation is not the one described writes nothing; described there, it is written', async () => {
    const entry = await copyOf('narrowed-decimal', 'narrowed_decimal_mixed')
    const snapshot = await discoverPostgres(owner, SCOPE)
    const committed = postgres(fixture.admin, { onnotice: () => {} })
    const repeatable = postgres(fixture.admin, { onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    try {
      const old = described(await createPostgresRecords(committed).describe(ref(entry.table))).definition
      const create = { target: target(entry.table), values: [value(snapshot, entry.table, 'amount', '1234.5678')], returning: [], definition: old }
      // With nothing changed, the isolation alone refuses it, and says so: an insert, and an update.
      expect(await createPostgresRecords(repeatable).insert(create)).toMatchObject({ ok: false, code: 'unavailable', message: expect.stringMatching(/isolation/) })
      const update = { ...writes(entry, snapshot, '1', old).update }
      expect(await createPostgresRecords(repeatable).update(update)).toMatchObject({ ok: false, code: 'unavailable', message: expect.stringMatching(/isolation/) })
      // Behind a narrowing that commits while it waits, the guard reads the
      // catalog from before the wait on this connection: only the isolation
      // refuses it. The table moved, which is the answer, and nothing is stored.
      const alter = await holdAlter(entry)
      const pending = createPostgresRecords(repeatable).insert(create)
      await waiting(entry.table, 1)
      await alter.commit()
      expect(await pending).toMatchObject({ ok: false, code: 'schema-changed' })
      expect((await held(entry.table)).rows).toBe(1)

      const here = described(await createPostgresRecords(repeatable).describe(ref(entry.table))).definition
      const after = await discoverPostgres(owner, SCOPE)
      expect(await createPostgresRecords(repeatable).insert({ ...create, values: [value(after, entry.table, 'amount', '12.50')], definition: here })).toMatchObject({ ok: true })
      expect((await held(entry.table)).rows).toBe(2)
    } finally {
      await Promise.all([committed.end(), repeatable.end()])
    }
  })

  // Measured, and held: the lock-first path needs a privilege on the whole
  // table, which column grants do not give. The writer holds table SELECT
  // and INSERT on sales.order, and only column SELECT on sales.customer; the
  // reader table SELECT on sales.order.
  test('under REPEATABLE READ the restricted accounts take the lock where they hold a table privilege, and are refused where they hold columns', async () => {
    for (const [uri, table, columns, code] of [
      [fixture.writer, 'order', ['id'], undefined],
      [fixture.reader, 'order', ['id'], undefined],
      [fixture.writer, 'customer', ['customer_no'], 'permission-denied'],
    ] as const) {
      const sql = postgres(uri, { onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
      try {
        const records = createPostgresRecords(sql)
        const snapshot = await discoverPostgres(sql, FIXTURE_SCOPE)
        const object = findObject(snapshot, { schema: 'sales', name: table })
        const key = (object?.primaryKey?.columns ?? []).map((name) => ({ name, type: object?.columns.find((candidate) => candidate.name === name)?.type as RecordValue['type'], value: '1' }))
        const read = await records.read({
          target: { table: { schema: 'sales', name: table }, identity: key.map(({ name, type }) => ({ name, type })), concurrency: null },
          key,
          columns: columns.map((name) => ({ name, type: object?.columns.find((candidate) => candidate.name === name)?.type as RecordValue['type'] })),
          filters: { kind: 'unrestricted' }, through: [],
        })
        expect(read.ok ? undefined : read.code, `${new URL(uri).username} on ${table}`).toBe(code)
      } finally {
        await sql.end()
      }
    }
  })
})
