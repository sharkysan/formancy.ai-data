import { createHash } from 'node:crypto'
import { describedOf, findObject } from '@formancy/data-core'
import type { ApiValue, ColumnMeta, Described, DescribedTable, MetadataSnapshot, ObjectRef, RecordOutcome, RecordTarget, RecordValue, UpdateRequest } from '@formancy/data-core'
import { covers, driftingCase, driftingOn, FIXTURE_SCOPE, MODEL_CASES, PARITY_SCOPE, sharedDrifting, startSqlServerFixture } from '@formancy/data-fixtures'
import type { DriftingCase, SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'
import { describeStatement } from './records/statements.js'
import { run } from './sql/statement.js'

/*
 * The root's definition on SQL Server (0041), against the shared fixture's
 * real server: every write's batch checks, after its statement and in CATCH,
 * that the table still has the definition the write was decided over, and
 * the definition moves for every change a description reads and for
 * nothing else.
 *
 * `DRIFTING` (data-fixtures) is the table of changes the PostgreSQL suite
 * and the server's runtime suite run too; each case is declared with
 * `covers()` as a shared case (0035). The owner makes every change, and
 * every case is described as an account without VIEW DEFINITION as well,
 * whose catalog SQL Server filters, so the definition is held to moving
 * for it exactly as for the owner.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
/**
 * An account that writes every case table and holds no VIEW DEFINITION:
 * SQL Server filters the catalog by permission, and hides a default's
 * definition from it, so its facts are not the owner's.
 */
let restricted: mssql.ConnectionPool
/** Every case table as discovery saw it before any ALTER: the types a published form would bind with. */
let published: MetadataSnapshot

const RESTRICTED = { user: 'drifting_writer', password: 'Drifting-Writer-Password-1' }

const SCOPE = { schemas: ['drifting'] }
const ID = { name: 'id', type: { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } } as const

async function batches(pool: mssql.ConnectionPool | mssql.Transaction, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await new mssql.Request(pool as mssql.ConnectionPool).batch(statement)
}

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  await owner.request().batch('create schema drifting')
  for (const entry of driftingOn('sqlserver')) await batches(owner, entry.setUp.sqlserver as readonly string[])
  published = await discoverSqlServer(owner, SCOPE)
  const master = await new mssql.ConnectionPool({ ...fixture.admin, database: 'master' }).connect()
  try {
    await master.request().batch(`create login ${RESTRICTED.user} with password = '${RESTRICTED.password}', check_policy = off`)
  } finally {
    await master.close()
  }
  await batches(owner, [`create user ${RESTRICTED.user} for login ${RESTRICTED.user}`, `grant select, insert, update on schema::drifting to ${RESTRICTED.user}`])
  restricted = await new mssql.ConnectionPool({ ...fixture.writer, user: RESTRICTED.user, password: RESTRICTED.password }).connect()
})

afterAll(async () => {
  await restricted?.close()
  await owner?.close()
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

function column(snapshot: MetadataSnapshot, table: string, name: string): ColumnMeta {
  const found = findObject(snapshot, ref(table))?.columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`drifting.${table} has no column ${name}`)
  return found
}

/** A value of a case table's column, canonical for the type `snapshot` gives it, as a codec would make it. */
function value(snapshot: MetadataSnapshot, table: string, name: string, held: ApiValue): RecordValue {
  const { type } = column(snapshot, table, name)
  const canonical = type.kind === 'float' && typeof held === 'string' ? Number(held) : type.kind !== 'float' && typeof held === 'number' ? String(held) : held
  return { name, type, value: canonical }
}

function target(table: string): RecordTarget & UpdateRequest['target'] {
  return { table: ref(table), identity: [ID], concurrency: { kind: 'rowversion', column: 'rv' } }
}

/** The owner's view of a case table: row 1 and the number of rows. */
async function held(table: string): Promise<{ row: string | null; rows: number }> {
  const result = await owner
    .request()
    .query<{ row: string | null; rows: number }>(`select (select * from drifting.${table} where id = 1 for json path, without_array_wrapper, include_null_values) as row, (select count(*) from drifting.${table}) as rows`)
  return result.recordset[0] as { row: string | null; rows: number }
}

function writes(entry: DriftingCase, snapshot: MetadataSnapshot, version: string, definition: string) {
  const update = { target: target(entry.table), key: [{ ...ID, value: '1' }], set: [value(snapshot, entry.table, 'memo', 'written')], expectedVersion: version, filters: { kind: 'unrestricted' } as const, returning: [], definition }
  const values = [...Object.entries(entry.insert).map(([name, given]) => value(snapshot, entry.table, name, given)), value(snapshot, entry.table, 'memo', 'created')]
  const insert = { target: target(entry.table), values, returning: [ID], definition }
  return { update, insert }
}

const read = (table: string) => ({ target: target(table), key: [{ ...ID, value: '1' }], columns: [ID], filters: { kind: 'unrestricted' } as const })

/** The version a read found, which the next update is guarded by. */
async function versionOf(table: string): Promise<string> {
  const found = await createSqlServerRecords(owner).read(read(table))
  if (!found.ok || found.record === null) throw new Error(`drifting.${table} has no row 1`)
  return found.record.version as string
}

const declared = (entry: DriftingCase) => (sharedDrifting().includes(entry) ? covers('sqlserver', driftingCase(entry.name)) : {})

describe('the definition, change by change', () => {
  for (const entry of driftingOn('sqlserver')) {
    // A batch that let the old definition write is the reproduction's 43 in
    // a column retyped to int; a definition that moved for a comment or an
    // index would refuse every write after harmless DDL; one that did not
    // move for a key or a precision would let a write through it.
    test(`${entry.name}: the definition moves exactly when the change is one a description reads, and a write decided before it is refused`, declared(entry), async () => {
      const records = createSqlServerRecords(owner)
      const before = described(await records.describe(ref(entry.table)))
      const first = await records.read(read(entry.table))
      expect(first).toMatchObject({ ok: true, described: before, record: { version: expect.any(String) } })
      // As the account without VIEW DEFINITION too, whose catalog is not the owner's.
      const asRestricted = createSqlServerRecords(restricted)
      const restrictedBefore = described(await asRestricted.describe(ref(entry.table)))

      // The batch passes on the table as it is.
      const unchanged = writes(entry, published, await versionOf(entry.table), before.definition)
      succeeded(await records.update(unchanged.update))

      const version = await versionOf(entry.table)
      await batches(owner, entry.alter.sqlserver as readonly string[])
      const altered = await held(entry.table)
      const now = described(await records.describe(ref(entry.table)))
      expect(now.definition !== before.definition, 'the definition moved').toBe(entry.moves)
      expect(await records.read(read(entry.table))).toMatchObject({ ok: true, described: now })
      // A definition that moved for the owner and not for an account that
      // reads less of the catalog would let that account's write through the
      // change; one that moved only for it would refuse it after harmless DDL.
      // What it describes is what discovery as it reports.
      const restrictedNow = described(await asRestricted.describe(ref(entry.table)))
      expect(restrictedNow.definition !== restrictedBefore.definition, 'the definition moved for the account without VIEW DEFINITION').toBe(entry.moves)
      const { definition: _restrictedDefinition, ...restrictedDescription } = restrictedNow
      expect(restrictedDescription).toEqual(describedOf(await discoverSqlServer(restricted, SCOPE), ref(entry.table)))

      if (entry.moves) {
        // Decided over the old definition: refused, and rolled back.
        const stale = writes(entry, published, version, before.definition)
        expect(await records.update(stale.update)).toMatchObject({ ok: false, code: 'schema-changed' })
        expect(await records.insert(stale.insert)).toMatchObject({ ok: false, code: 'schema-changed' })
        expect(await asRestricted.insert(writes(entry, published, version, restrictedBefore.definition).insert)).toMatchObject({ ok: false, code: 'schema-changed' })
        expect(await held(entry.table)).toEqual(altered)
      }
      if (entry.name === 'masked-after-publication') {
        // The limitation 0041 registers, held: the definition did not move, and
        // the account without UNMASK reads the mask where the owner reads the
        // value, so nothing the runtime asks tells it the form now shows, and
        // would save back, something else.
        const note = { name: 'note', type: column(published, entry.table, 'note').type }
        const shown = await asRestricted.read({ ...read(entry.table), columns: [note] })
        expect(shown).toMatchObject({ ok: true, record: { values: { note: 'xxxx' } } })
        expect(await records.read({ ...read(entry.table), columns: [note] })).toMatchObject({ ok: true, record: { values: { note: 'seed' } } })
        // A save that sends back every field it was shown, as a renderer does (0022), writes the mask over the value.
        const version = (shown as { record: { version: string } }).record.version
        succeeded(await asRestricted.update({ ...writes(entry, published, version, restrictedNow.definition).update, set: [{ ...note, value: 'xxxx' }] }))
        expect(await records.read({ ...read(entry.table), columns: [note] })).toMatchObject({ ok: true, record: { values: { note: 'xxxx' } } })
      }
      if (entry.name === 'sequence-default') {
        // The limitation 0026 registers, held: the owner reads a sequence's
        // number, the account without VIEW DEFINITION an ordinary default it
        // cannot see -- so review as that account calls the column loosened,
        // and the runtime, reading the same catalog, allows its writes.
        expect(now.columns.find((candidate) => candidate.name === 'quantity')).toMatchObject({ generated: 'identity-by-default', hasDefault: true })
        expect(restrictedNow.columns.find((candidate) => candidate.name === 'quantity')).toMatchObject({ generated: 'none', hasDefault: true, defaultExpression: null })
      }
      // Decided over the table as it is now, they are what the column now does.
      const after = await discoverSqlServer(owner, SCOPE)
      const fresh = writes(entry, after, await versionOf(entry.table), now.definition)
      expect(succeeded(await records.update(fresh.update)).values).toEqual({})
      // A wall clock has no write path (0009): this adapter refuses to bind one, before the guard is asked.
      if (!fresh.insert.values.some((given) => given.type.kind === 'timestamp' && !given.type.withTimeZone)) {
        expect(succeeded(await records.insert(fresh.insert)).values).toEqual({ id: expect.any(String) })
      }
    })
  }
})

/** A copy of a case's table under another name, so a test can change it without reaching the case's. */
async function copyOf(name: string, as: string): Promise<DriftingCase> {
  const entry = driftingOn('sqlserver').find((candidate) => candidate.name === name) as DriftingCase
  const renamed = (statements: readonly string[] | undefined) => (statements ?? []).map((statement) => statement.replaceAll(entry.table, as))
  const copy = { ...entry, table: as, setUp: { sqlserver: renamed(entry.setUp.sqlserver) }, alter: { sqlserver: renamed(entry.alter.sqlserver) } }
  await batches(owner, copy.setUp.sqlserver)
  return copy
}

describe('a statement that fails on a moved table', () => {
  // 'many' into the column retyped to int is 245, an overflow of the narrowed
  // decimal 8115, ten characters into the narrowed nvarchar(8) 2628: each a
  // refusal that, answered as itself, has the person fix a value that was
  // never the problem. CATCH asks the definition after the rollback.
  test('is schema-changed, and the same value under the new definition is what the column says', async () => {
    const records = createSqlServerRecords(owner)
    for (const [name, field, sent, refused] of [
      ['retyped-integer', 'quantity', 'many', 'out-of-range'],
      ['tightened-text', 'code', 'ABCDEFGHIJ', 'too-long'],
      ['narrowed-decimal', 'amount', '12345678.1234', 'out-of-range'],
    ] as const) {
      const entry = await copyOf(name, `${name.replaceAll('-', '_')}_failing`)
      const snapshot = await discoverSqlServer(owner, SCOPE)
      const old = described(await records.describe(ref(entry.table))).definition
      const version = await versionOf(entry.table)
      await batches(owner, entry.alter.sqlserver as readonly string[])
      // Typed as published, as the runtime binds: the new definition then shows what the column itself refuses.
      const update = (definition: string) => ({ ...writes(entry, snapshot, version, definition).update, set: [value(snapshot, entry.table, field, sent)] })
      const insert = (definition: string) => ({ target: target(entry.table), values: [value(snapshot, entry.table, field, sent)], returning: [], definition })
      expect(await records.update(update(old)), name).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(await records.insert(insert(old)), name).toMatchObject({ ok: false, code: 'schema-changed' })
      const now = described(await records.describe(ref(entry.table))).definition
      expect(await records.update(update(now)), name).toMatchObject({ ok: false, code: refused })
      expect(await records.insert(insert(now)), name).toMatchObject({ ok: false, code: refused })
      expect((await held(entry.table)).rows).toBe(1)
    }
  })
})

describe('what a refused write leaves behind', () => {
  // The batch rolls the refused write back, and what a trigger did with it.
  // PostgreSQL keeps a statement-level trigger's work; held on both engines
  // so the difference the limitation names cannot pass unnoticed.
  test('a trigger fired by the refused statement is rolled back with it', async () => {
    const entry = await copyOf('tightened-text', 'tightened_text_logged')
    await owner.request().batch('create table drifting.statement_log (at int identity(1,1), operation nvarchar(10) not null)')
    await owner.request().batch(`create trigger drifting.logged on drifting.tightened_text_logged after insert, update as
      begin set nocount on; insert into drifting.statement_log (operation) values (N'written'); end`)
    const records = createSqlServerRecords(owner)
    const snapshot = await discoverSqlServer(owner, SCOPE)
    const old = described(await records.describe(ref(entry.table))).definition
    const stale = writes(entry, snapshot, await versionOf(entry.table), old)
    await batches(owner, entry.alter.sqlserver as readonly string[])
    expect(await records.update(stale.update)).toMatchObject({ ok: false, code: 'schema-changed' })
    expect(await records.insert(stale.insert)).toMatchObject({ ok: false, code: 'schema-changed' })
    expect((await owner.request().query<{ n: number }>('select count(*) as n from drifting.statement_log')).recordset[0]?.n).toBe(0)
    expect((await held(entry.table)).rows).toBe(1)
  })
})

describe('a trigger that ended the transaction of a write decided before a change', () => {
  // The write may have committed (0031), so the answer is unknown-outcome,
  // which says it is not retried. Answered as the moved definition instead --
  // "nothing was written" -- over a row the trigger committed, the person
  // presses again, and a table whose key the database numbers stores the
  // record twice. The definition is asked in CATCH only for a transaction
  // that is still the batch's own.
  test('is unknown-outcome, never schema-changed, and what the trigger committed is stored', async () => {
    await owner.request().batch('create table drifting.ended_moved (id int not null constraint pk_ended_moved primary key, note nvarchar(20) null)')
    await owner.request().batch(
      'create trigger drifting.ended_moved_insert on drifting.ended_moved after insert as begin set nocount on; ' +
        "declare @note nvarchar(20) = (select top (1) note from inserted); if @note = N'commit' commit transaction; " +
        "else if @note = N'reopen' begin commit transaction; begin transaction; end; else if @note = N'raise' begin commit transaction; raiserror(N'a refusal of the customer''s own', 16, 1); end; end",
    )
    const records = createSqlServerRecords(owner)
    const old = described(await records.describe(ref('ended_moved'))).definition
    await owner.request().batch('alter table drifting.ended_moved add extra int null')
    const snapshot = await discoverSqlServer(owner, SCOPE)
    const key = { name: 'id', type: column(snapshot, 'ended_moved', 'id').type }
    // 3609 after a COMMIT, the batch's 51704 after a COMMIT and a BEGIN, its 51705 after a COMMIT and an error.
    const answered: Array<[string, string]> = []
    for (const [id, note] of [
      ['1', 'commit'],
      ['2', 'reopen'],
      ['3', 'raise'],
    ] as const) {
      const outcome = await records.insert({
        target: { table: ref('ended_moved'), identity: [key], concurrency: null },
        values: [value(snapshot, 'ended_moved', 'id', id), value(snapshot, 'ended_moved', 'note', note)],
        returning: [],
        definition: old,
      })
      answered.push([note, outcome.ok ? 'ok' : outcome.code])
    }
    expect(answered).toEqual([
      ['commit', 'unknown-outcome'],
      ['reopen', 'unknown-outcome'],
      ['raise', 'unknown-outcome'],
    ])
    const stored = await owner.request().query<{ id: number; note: string }>('select id, note from drifting.ended_moved order by id')
    expect(stored.recordset).toEqual([
      { id: 1, note: 'commit' },
      { id: 2, note: 'reopen' },
      { id: 3, note: 'raise' },
    ])
  })
})

describe('the description and discovery', () => {
  // A description that read a table otherwise than discovery would make the
  // runtime decide over another table than review did; a digest that is not
  // the SHA-256 of the UTF-16 facts the description parsed would guard
  // something nobody read. As the owner, the reader and the writer -- whose
  // catalog SQL Server filters by permission -- over every table they see.
  test('describe reads every fixture table as discovery does, and its digest is the SHA-256 of the facts it parsed', covers('sqlserver', MODEL_CASES.described), async () => {
    for (const config of [fixture.admin, fixture.reader, fixture.writer]) {
      const pool = await new mssql.ConnectionPool(config).connect()
      try {
        const records = createSqlServerRecords(pool)
        for (const scope of [FIXTURE_SCOPE, PARITY_SCOPE]) {
          const snapshot = await discoverSqlServer(pool, scope)
          for (const object of snapshot.objects) {
            const where = `${String(config.user)}: ${object.ref.schema}.${object.ref.name}`
            const { definition, ...description } = described(await records.describe(object.ref))
            expect(description, where).toEqual(describedOf(snapshot, object.ref))
            const [row] = await run<{ facts: string; digest: Uint8Array }>(pool, describeStatement(object.ref))
            expect(createHash('sha256').update(Buffer.from(row?.facts as string, 'utf16le')).digest('hex'), where).toBe(Buffer.from(row?.digest as Uint8Array).toString('hex'))
            expect(definition, where).toBe(Buffer.from(row?.digest as Uint8Array).toString('hex'))
          }
        }
      } finally {
        await pool.close()
      }
    }
  })

  // The text a client receives is cut to TEXTSIZE, and HASHBYTES hashes it
  // whole: decided over the cut text, the description would be guessed.
  test('a description cut by the connection’s TEXTSIZE is unavailable, never parsed', async () => {
    const pool = await new mssql.ConnectionPool({ ...fixture.admin, options: { ...fixture.admin.options, textsize: 64 } as mssql.config['options'] }).connect()
    try {
      expect(await createSqlServerRecords(pool).describe({ schema: 'sales', name: 'order' })).toMatchObject({ ok: false, code: 'unavailable', message: expect.stringMatching(/TEXTSIZE/) })
    } finally {
      await pool.close()
    }
  })
})

/** Sessions of this database waiting for a lock, by any holder. */
async function lockWaiters(): Promise<number> {
  const result = await owner.request().query<{ n: number }>("select count(*) as n from sys.dm_exec_requests where database_id = db_id() and wait_type like 'LCK[_]%'")
  return result.recordset[0]?.n ?? 0
}

async function waiting(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await lockWaiters()) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${String(count)} sessions never waited for a lock`)
}

describe('an ALTER that commits while a request waits for it', () => {
  // The window between a description and its write. The owner holds the
  // ALTER uncommitted while a create, an update and a read queue behind its
  // schema-modification lock, then commits. Each statement then compiles
  // against the new table, and the batch's check after it sees the change.
  // Checked in a statement of its own before the write instead, both writes
  // would commit under the new definition.
  for (const name of ['narrowed-decimal', 'sequence-default'] as const) {
    test(`${name}: the writes are schema-changed, nothing is written, and the read is the table after`, async () => {
      const entry = await copyOf(name, `${name.replaceAll('-', '_')}_raced`)
      const snapshot = await discoverSqlServer(owner, SCOPE)
      const records = createSqlServerRecords(owner)
      const old = described(await records.describe(ref(entry.table))).definition
      const stale = writes(entry, snapshot, await versionOf(entry.table), old)
      const transaction = new mssql.Transaction(owner)
      await transaction.begin()
      await batches(transaction, entry.alter.sqlserver as readonly string[])
      const pending = [records.insert(stale.insert), records.update(stale.update), records.read(read(entry.table))] as const
      await waiting(3)
      await transaction.commit()
      const [inserted, updated, reread] = await Promise.all(pending)
      expect(inserted).toMatchObject({ ok: false, code: 'schema-changed' })
      expect(updated).toMatchObject({ ok: false, code: 'schema-changed' })
      const now = described(await records.describe(ref(entry.table)))
      expect(reread).toMatchObject({ ok: true, described: { definition: now.definition }, record: { version: expect.any(String) } })
      expect(await held(entry.table)).toMatchObject({ rows: 1, row: expect.stringMatching(/"memo":null/) })
    })
  }

  // The other order: the write holds its intent lock -- an AFTER trigger
  // that waits keeps it there -- while an ALTER queues for the schema lock,
  // and then reads the catalog. Either the write commits under the old
  // definition and the ALTER runs after it, or one of them is chosen as a
  // deadlock victim and rolled back. Never a row stored under the new one.
  test('a write holding its lock while an ALTER queues is committed before it, or rolled back; never written after it', async () => {
    const entry = await copyOf('narrowed-decimal', 'narrowed_decimal_queued')
    await owner.request().batch("create trigger drifting.slow on drifting.narrowed_decimal_queued after update as begin set nocount on; waitfor delay '00:00:01'; end")
    const snapshot = await discoverSqlServer(owner, SCOPE)
    const records = createSqlServerRecords(owner)
    const old = described(await records.describe(ref(entry.table))).definition
    const update = { ...writes(entry, snapshot, await versionOf(entry.table), old).update, set: [value(snapshot, entry.table, 'amount', '1234.5678')] }
    const writing = records.update(update)
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await owner.request().query<{ n: number }>("select count(*) as n from sys.dm_exec_requests where database_id = db_id() and wait_type = 'WAITFOR'")
      if ((result.recordset[0]?.n ?? 0) > 0) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const altering = batches(owner, entry.alter.sqlserver as readonly string[]).then(
      () => 'altered' as const,
      (error: { number?: number }) => (error.number === 1205 ? ('victim' as const) : Promise.reject(error)),
    )
    const [written, alter] = await Promise.all([writing, altering])
    const amount = (await owner.request().query<{ amount: string }>(`select convert(nvarchar(40), amount) as amount from drifting.${entry.table} where id = 1`)).recordset[0]?.amount
    if (written.ok) {
      // Written first, under the old definition. A narrowing that ran after it
      // rounded what was stored, as it rounds every row; one chosen as the
      // victim left the old column, and the value, as they were.
      expect(amount).toBe(alter === 'altered' ? '1234.57' : '1234.5678')
    } else {
      expect(['unavailable', 'schema-changed']).toContain(written.code)
      expect(alter).toBe('altered')
      expect(amount).toBe('10.00')
    }
  })
})
