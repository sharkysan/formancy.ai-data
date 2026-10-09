import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ApiValue, LookupConfig, LookupQuery, MetadataSnapshot, ObjectMeta, ObjectRef, RecordColumn, RecordTarget, RecordValue, RowFilters, UpdateRequest } from '@formancy/data-core'
import { buildLookupConfig, encodeKeyToken, findObject, generateForm, scopeRowFilters } from '@formancy/data-core'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { covers, DISPLAY_PARITY, displayCase, FILTER_PARITY, filterCase, PARITY_SCOPE, REFUSAL_PARITY, refusalCase, startSqlServerFixture } from '@formancy/data-fixtures'
import { createSqlServerLookups, createSqlServerRecords, discoverSqlServer } from './index.js'

/**
 * The parity schema (0028) against REAL SQL Server: the row filters, labels
 * and refusals `@formancy/data-fixtures` expects of both engines, run here
 * through the lookup and record halves exactly as PostgreSQL's suite runs
 * them. Discovered as the owner; every config is generated from the snapshot
 * and every filter scoped with `scopeRowFilters`, as a deployment does it.
 *
 * Beside it, schema `local` holds what the parity fixture cannot: a char(n)
 * key, a varchar created under ANSI_PADDING OFF, columns that become
 * generated after discovery — a system-versioning period among them — and a
 * trigger that fails with a number nobody maps; and database `ro_probe` is
 * one that becomes read-only after discovery.
 *
 * One test reads what no result set shows: the plan SQL Server cached for a
 * lookup, from `sys.dm_exec_query_stats`, because whether a filter seeks its
 * index is in the plan and nowhere else.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let german: mssql.ConnectionPool
let parity: MetadataSnapshot
let local: MetadataSnapshot

const TENANT_ITEM: ObjectRef = { schema: 'parity', name: 'tenant_item' }
const ITEM_USE: ObjectRef = { schema: 'parity', name: 'item_use' }
const DISPLAY_KINDS: ObjectRef = { schema: 'parity', name: 'display_kinds' }
const DISPLAY_USE: ObjectRef = { schema: 'parity', name: 'display_use' }
const GUARDED: ObjectRef = { schema: 'parity', name: 'guarded' }
const DECLINED: ObjectRef = { schema: 'parity', name: 'declined' }
const GENERATED: ObjectRef = { schema: 'parity', name: 'generated' }
const CONTENDED: ObjectRef = { schema: 'parity', name: 'contended' }
const CODE: ObjectRef = { schema: 'local', name: 'code' }
const CODE_USE: ObjectRef = { schema: 'local', name: 'code_use' }
const UNPADDED: ObjectRef = { schema: 'local', name: 'unpadded' }
const DRIFTING: ObjectRef = { schema: 'local', name: 'drifting' }
const DIVIDING: ObjectRef = { schema: 'local', name: 'dividing' }

/** parity.tenant_item's four named rows, in item_no order. */
const NAMED = [
  ['acme', '1'],
  ['ACME', '2'],
  ['acme ', '3'],
  ['Acmé', '4'],
] as const

const EVERY_ROW: RowFilters = { kind: 'unrestricted' }
const PAGE: LookupQuery = { search: '', offset: 0, limit: 50 }

const connect = (config: mssql.config): Promise<mssql.ConnectionPool> => new mssql.ConnectionPool(config).connect()

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await connect(fixture.admin)
  german = await connect({ ...fixture.admin, options: { ...fixture.admin.options, language: 'Deutsch' } })
  // Constants of this file, so they are spliced.
  await owner.request().batch('create schema local')
  await owner.request().batch(`
    create table local.code (code char(5) not null constraint pk_code primary key, label nvarchar(20) not null);
    create table local.code_use (id int not null constraint pk_code_use primary key,
      code char(5) null constraint fk_code_use_code references local.code (code));
    insert into local.code (code, label) values ('AB', N'Short');
    create table local.drifting (id int not null constraint pk_drifting primary key, made int null, computed int null, stamped int null,
      started datetimeoffset null, ended datetimeoffset null, version int not null constraint df_drifting_version default 0);
    insert into local.drifting (id) values (1);
    create table local.dividing (id int not null constraint pk_dividing primary key)`)
  await owner.request().batch('create trigger local.dividing_insert on local.dividing after insert as begin set nocount on; declare @x int = 1 / 0; end')
  // A raw batch, so the SET holds for the CREATE after it, and is put back
  // before the pooled connection serves anything else.
  await owner.request().batch(`set ansi_padding off;
    create table local.unpadded (id int not null constraint pk_unpadded primary key, v varchar(10) null, n nvarchar(10) null,
      version int not null constraint df_unpadded_version default 0);
    set ansi_padding on;
    insert into local.unpadded (id, v, n) values (1, 'start', N'start')`)
  parity = await discoverSqlServer(owner, PARITY_SCOPE)
  local = await discoverSqlServer(owner, { schemas: ['local'] })
  // After discovery: the snapshot still says plain int for each of these.
  await owner.request().batch(`
    alter table local.drifting drop column made, computed, stamped, started, ended;
    alter table local.drifting add made int identity(1, 1) not null, computed as (id * 2), stamped rowversion,
      started datetime2 generated always as row start not null constraint df_drifting_started default sysutcdatetime(),
      ended datetime2 generated always as row end not null constraint df_drifting_ended default convert(datetime2, '9999-12-31 23:59:59.9999999'),
      period for system_time (started, ended)`)
})

afterAll(async () => {
  await german?.close()
  await owner?.close()
  await fixture?.stop()
})

function meta(snapshot: MetadataSnapshot, ref: ObjectRef): ObjectMeta {
  const found = findObject(snapshot, ref)
  if (found === undefined) throw new Error(`${ref.schema}.${ref.name} is not in the snapshot`)
  return found
}

function columnOf(snapshot: MetadataSnapshot, ref: ObjectRef, name: string): RecordColumn {
  const found = meta(snapshot, ref).columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`${ref.name} has no column ${name}`)
  return { name, type: found.type }
}

const parityValue = (ref: ObjectRef, name: string, value: ApiValue): RecordValue => ({ ...columnOf(parity, ref, name), value })
const localValue = (ref: ObjectRef, name: string, value: ApiValue): RecordValue => ({ ...columnOf(local, ref, name), value })

function versioned(snapshot: MetadataSnapshot, ref: ObjectRef): RecordTarget & { concurrency: { kind: 'version-column'; column: string } } {
  const key = meta(snapshot, ref).primaryKey?.columns ?? []
  return { table: ref, identity: key.map((name) => columnOf(snapshot, ref, name)), concurrency: { kind: 'version-column', column: 'version' } }
}

/** The lookup a form over `root` gets for `foreignKey`, derived exactly as a deployment derives it. */
function lookupConfig(snapshot: MetadataSnapshot, root: ObjectRef, foreignKey: string, display: string[]): LookupConfig {
  const { bindings } = generateForm(snapshot, { connection: 'erp', root, formId: 'form', title: 'Form', lookups: [{ foreignKey, display }] })
  const field = bindings.fields.find((binding) => binding.kind === 'lookup')
  if (field === undefined) throw new Error(`the form over ${root.name} has no lookup for ${foreignKey}`)
  return buildLookupConfig(bindings, field.field, { snapshot })
}

function token(key: readonly string[]): string {
  const encoded = encodeKeyToken(key)
  if (!encoded.ok) throw new Error(`${key.join(',')} has no token`)
  return encoded.token
}

/** The filter as the planner and the lookup route scope it, from the snapshot's column. */
function tenantItemFilter(column: string, value: string): RowFilters {
  const scoped = scopeRowFilters(meta(parity, TENANT_ITEM), [{ column, value }], 'parity')
  if (!scoped.ok) throw new Error(scoped.message)
  return scoped.filters
}

async function scalar<T>(sql: string): Promise<T | undefined> {
  const result = await owner.request().query<{ value: T }>(sql)
  return result.recordset[0]?.value
}

describe('what SQL Server does on its own', () => {
  // The three facts the exact comparison and the canonical char(n) read are
  // built on (C1, C1b, C2). Were BIN2 ever to count trailing spaces, or
  // rtrim to remove more than U+0020, the adapter's spelling would be
  // redundant or wrong, and this says so by name.
  test('BIN2 ignores trailing spaces, char(n) keeps its padding as nvarchar, and rtrim removes U+0020 alone', async () => {
    const facts = await owner.request().query<{ bin2: number; padded: string; nbsp: number; tab: number }>(`
      declare @c char(3) = 'AB';
      select case when N'acme' = N'acme ' collate Latin1_General_100_BIN2 then 1 else 0 end as bin2,
        convert(nvarchar(max), @c) + N'|' as padded,
        datalength(rtrim(N'AB' + nchar(160))) as nbsp,
        datalength(rtrim(N'AB' + nchar(9))) as tab`)
    expect(facts.recordset).toEqual([{ bin2: 1, padded: 'AB |', nbsp: 6, tab: 6 }])
  })
})

describe('FILTER_PARITY: a row filter compares the canonical value exactly', () => {
  // Under the database's case-insensitive collation `=` ignores case, and
  // under every SQL Server collation it ignores trailing spaces. Before 0028
  // the filter compared under BIN2 alone, so tenant `acme` read the rows of
  // `acme ` (C2-table) where PostgreSQL did not. Each case is asked of every
  // operation a filter scopes: a lookup's page, resolve and membership, and a
  // record's read and guarded update.
  for (const parityCase of FILTER_PARITY) {
    test(`${parityCase.column} = ${JSON.stringify(parityCase.value)}`, covers('sqlserver', filterCase(parityCase)), async () => {
      const scoped = scopeRowFilters(meta(parity, TENANT_ITEM), [{ column: parityCase.column, value: parityCase.value }], 'parity')
      if ('refused' in parityCase) {
        // A fixed-length column's canonical value has no trailing space, so
        // `AB ` names nothing it holds. Bound, SQL Server's `=` would ignore
        // the space and select every row whose code is `AB`; refused, no SQL
        // is built. And a term that reaches the adapter by hand is thrown by
        // its lookups and its records before anything is sent, as
        // PostgreSQL's suite asks of its adapter: this case is declared on
        // both engines, so it asserts the same of both.
        expect(scoped).toMatchObject({ ok: false, code: parityCase.refused })
        const forged = { kind: 'restricted', equal: [{ column: parityCase.column, type: columnOf(parity, TENANT_ITEM, parityCase.column).type, value: parityCase.value }] } as unknown as RowFilters
        const lookups = createSqlServerLookups(owner)
        const config = lookupConfig(parity, ITEM_USE, 'fk_item_use_item', ['label'])
        await expect(lookups.search(config, PAGE, forged)).rejects.toThrow(/not spelled as its column holds it/)
        await expect(lookups.resolve(config, NAMED.map(token), forged)).rejects.toThrow(/not spelled as its column holds it/)
        const key = [parityValue(TENANT_ITEM, 'tenant_code', 'acme'), parityValue(TENANT_ITEM, 'item_no', '1')]
        await expect(createSqlServerRecords(owner).read({ target: versioned(parity, TENANT_ITEM), key, columns: [], filters: forged })).rejects.toThrow(/not spelled as its column holds it/)
        return
      }
      if (!scoped.ok) throw new Error(scoped.message)
      const filters = scoped.filters
      const expected = parityCase.keys.map(token).sort()
      const named = NAMED.map(token)

      const lookups = createSqlServerLookups(owner)
      const config = lookupConfig(parity, ITEM_USE, 'fk_item_use_item', ['label'])
      expect((await lookups.search(config, PAGE, filters)).rows.map((row) => row.token).sort()).toEqual(expected)
      expect((await lookups.resolve(config, named, filters)).map((row) => row.token).sort()).toEqual(expected)
      const rejected = await lookups.rejects(config, named, filters)
      expect(named.filter((candidate) => !rejected.includes(candidate)).sort()).toEqual(expected)

      const records = createSqlServerRecords(owner)
      const target = versioned(parity, TENANT_ITEM)
      const label = columnOf(parity, TENANT_ITEM, 'label')
      for (const [tenantCode, itemNo] of NAMED) {
        const key = [parityValue(TENANT_ITEM, 'tenant_code', tenantCode), parityValue(TENANT_ITEM, 'item_no', itemNo)]
        const admitted = expected.includes(token([tenantCode, itemNo]))
        const read = await records.read({ target, key, columns: [label], filters })
        expect(read.ok, `read ${tenantCode}`).toBe(admitted)
        const stored = await owner
          .request()
          .input('item', mssql.Int, Number(itemNo))
          .query<{ label: string; version: number }>('select label, version from parity.tenant_item where item_no = @item')
        const row = stored.recordset[0]
        if (row === undefined) throw new Error(`item ${itemNo} is in the fixture`)
        const update: UpdateRequest = { target, key, set: [{ ...label, value: row.label }], expectedVersion: String(row.version), filters, returning: [] }
        expect(await records.update(update), `update ${tenantCode}`).toMatchObject(admitted ? { ok: true } : { ok: false, code: 'not-found' })
      }
    })
  }

  // The exactness conjunct must not cost the index: an nvarchar column under
  // the database's own collation seeks when the first conjunct compares in
  // that collation and the exact ones filter the few rows it finds (C5b).
  // BIN2 alone could not seek: SQL Server scanned ix_tenant_item_fixed_code
  // for every row and looked each match up (C5a). The plan is read from the
  // cache, because the plan is the only place a seek is visible.
  test('a tenant filter seeks pk_tenant_item', async () => {
    await owner.request().batch('dbcc freeproccache with no_infomsgs')
    const lookups = createSqlServerLookups(owner)
    await lookups.search(lookupConfig(parity, ITEM_USE, 'fk_item_use_item', ['label']), PAGE, tenantItemFilter('tenant_code', 'acme'))
    const plans = await owner.request().query<{ plan: string }>(`
      select [p].[query_plan] as [plan] from sys.dm_exec_query_stats as [s]
      cross apply sys.dm_exec_sql_text([s].[sql_handle]) as [t]
      cross apply sys.dm_exec_text_query_plan([s].[plan_handle], [s].[statement_start_offset], [s].[statement_end_offset]) as [p]
      where charindex(N'[parity].[tenant_item]', [t].[text]) > 0 and charindex(N'dm_exec', [t].[text]) = 0`)
    expect(plans.recordset).toHaveLength(1)
    // Each operator up to the next: a leaf's chunk holds its index and its seek predicates.
    const operators = (plans.recordset[0]?.plan ?? '')
      .split('<RelOp ')
      .slice(1)
      .map((operator) => ({
        op: /PhysicalOp="([^"]+)"/.exec(operator)?.[1],
        index: /<Object [^>]*Index="\[([^\]]+)\]"/.exec(operator)?.[1],
        // A key lookup is a clustered seek too, for rows a scan of another index found: what BIN2 alone did.
        lookup: /<IndexScan [^>]*Lookup="1"/.test(operator),
        // The range is on tenant_code: a dynamic seek (GetRangeWithMismatchedTypes) names the column in its RangeColumns.
        seeksTenant: /<SeekPredicates>(?:(?!<\/SeekPredicates>)[\s\S])*Column="tenant_code"/.test(operator),
      }))
    expect(operators).toContainEqual({ op: 'Clustered Index Seek', index: 'pk_tenant_item', lookup: false, seeksTenant: true })
    // A Constant Scan computes the dynamic seek's range from the parameter; an index or table scan reads rows.
    expect(operators.map((operator) => operator.op).filter((op) => /Index Scan|Table Scan/.test(op ?? ''))).toEqual([])
  })
})

describe('DISPLAY_PARITY: a label is spelled from the canonical value', () => {
  // Style 126 spelled a bit `1`, a uuid in upper case, a float as
  // `1.000000000000000e-001` and an offset in its stored zone (C6), where
  // PostgreSQL said otherwise. A label is now the record reader's value,
  // spelled by `displayText`, and a session's language — which moves
  // SQL Server's date format and month names — does not reach it.
  for (const [language, pool] of [
    ['us_english', () => owner],
    ['Deutsch', () => german],
  ] as const) {
    test(`every kind labels alike, in a ${language} session`, covers('sqlserver', ...Object.keys(DISPLAY_PARITY).map(displayCase)), async () => {
      const lookups = createSqlServerLookups(pool())
      const labels: Record<string, string | undefined> = {}
      const resolved: Record<string, string | undefined> = {}
      for (const name of Object.keys(DISPLAY_PARITY)) {
        const config = lookupConfig(parity, DISPLAY_USE, 'fk_display_use_kinds', [name])
        labels[name] = (await lookups.search(config, PAGE, EVERY_ROW)).rows[0]?.label
        resolved[name] = (await lookups.resolve(config, ['k1:1'], EVERY_ROW))[0]?.label
      }
      expect(labels).toEqual(DISPLAY_PARITY)
      expect(resolved).toEqual(DISPLAY_PARITY)
    })
  }

  // SQL Server keeps a char(n)'s padding through a conversion to nvarchar
  // (C1), and PostgreSQL drops it. The record reader trims it, so a char(5)
  // holding AB reads as AB on both engines — U+0020 only, as rtrim removes.
  test('a char(n) column reads without its padding', async () => {
    const records = createSqlServerRecords(owner)
    const read = await records.read({
      target: { table: DISPLAY_KINDS, identity: [columnOf(parity, DISPLAY_KINDS, 'id')], concurrency: null },
      key: [parityValue(DISPLAY_KINDS, 'id', '1')],
      columns: [columnOf(parity, DISPLAY_KINDS, 'fixed'), columnOf(parity, DISPLAY_KINDS, 't')],
      filters: EVERY_ROW,
    })
    expect(read).toEqual({ ok: true, values: { fixed: 'AB', t: 'Text' }, version: null })
  })
})

describe('a fixed-length key', () => {
  // A char(5) key holding AB was offered as `AB` plus three escaped spaces on
  // SQL Server and as `AB` on PostgreSQL: two tokens for one key, so an
  // answer stored on one engine was not a member on the other. The padded
  // token is not a key value at all now, and is rejected without a query.
  test('is offered, resolved and a member under the token PostgreSQL gives it', async () => {
    const lookups = createSqlServerLookups(owner)
    const config = lookupConfig(local, CODE_USE, 'fk_code_use_code', ['label'])
    expect(await lookups.search(config, PAGE, EVERY_ROW)).toEqual({ rows: [{ token: 'k1:AB', label: 'Short' }], hasMore: false, omitted: 0 })
    expect(await lookups.resolve(config, ['k1:AB'], EVERY_ROW)).toEqual([{ token: 'k1:AB', label: 'Short' }])
    const padded = token(['AB   '])
    expect(await lookups.rejects(config, ['k1:AB', padded], EVERY_ROW)).toEqual([padded])
  })

  // The write check compares what the column stored with what was sent,
  // exactly. The stored side is the canonical value — trimmed — so a char(5)
  // given CD, which it stores padded, is a write that is true, not a refusal.
  test('a value shorter than its char(n) column is written, and reads back unpadded', async () => {
    const records = createSqlServerRecords(owner)
    const target: RecordTarget = { table: CODE, identity: [columnOf(local, CODE, 'code')], concurrency: null }
    const inserted = await records.insert({ target, values: [localValue(CODE, 'code', 'CD'), localValue(CODE, 'label', 'Inserted')], returning: [columnOf(local, CODE, 'code')] })
    expect(inserted).toEqual({ ok: true, values: { code: 'CD' }, version: null })
  })
})

describe('a varchar created under ANSI_PADDING OFF', () => {
  // Such a column drops a trailing space without an error, and OUTPUT shows
  // the row already trimmed (C12): `acme ` was reported saved while the
  // table held `acme`, and BIN2 alone compares the two equal. Comparing the
  // lengths too refuses it, and the batch rolls it back.
  test("refuses a value it would trim, and writes nothing; an nvarchar beside it keeps the space", async () => {
    const padding = await owner
      .request()
      .query<{ name: string; padded: boolean }>("select name, is_ansi_padded as padded from sys.columns where object_id = object_id(N'local.unpadded') and name = N'v'")
    expect(padding.recordset).toEqual([{ name: 'v', padded: false }])
    const records = createSqlServerRecords(owner)
    const target = versioned(local, UNPADDED)
    const trimmed = { ok: false, code: 'out-of-range', column: 'v', message: expect.stringContaining('trailing spaces') }
    expect(await records.insert({ target, values: [localValue(UNPADDED, 'id', '2'), localValue(UNPADDED, 'v', 'acme ')], returning: [] })).toMatchObject(trimmed)
    const update: UpdateRequest = { target, key: [localValue(UNPADDED, 'id', '1')], set: [localValue(UNPADDED, 'v', 'acme ')], expectedVersion: '0', filters: EVERY_ROW, returning: [] }
    expect(await records.update(update)).toMatchObject(trimmed)
    const kept = await records.insert({ target, values: [localValue(UNPADDED, 'id', '3'), localValue(UNPADDED, 'n', 'acme ')], returning: [columnOf(local, UNPADDED, 'n')] })
    expect(kept).toMatchObject({ ok: true, values: { n: 'acme ' } })
    const stored = await owner.request().query<{ id: number; v: string | null; version: number }>('select id, v, version from local.unpadded order by id')
    expect(stored.recordset).toEqual([
      { id: 1, v: 'start', version: 0 },
      { id: 3, v: null, version: 0 },
    ])
  })
})

describe('REFUSAL_PARITY: a refusal names the same code on both engines', () => {
  const sessions = [
    ['us_english', () => owner],
    ['Deutsch', () => german],
  ] as const

  // A trigger's THROW (50001) and RAISERROR (50000) are a business rule's
  // refusal, which sending again will not change. They were `unavailable`,
  // an invitation to retry, and PostgreSQL's RAISE was `check-violation`, a
  // constraint the form could have checked. The code is from the number, so
  // a German session gets the same.
  for (const [language, pool] of sessions) {
    test(`a trigger's own error is refused on insert and update, and nothing is written, in a ${language} session`, covers('sqlserver', refusalCase('guardedInsert'), refusalCase('oddInsert'), refusalCase('guardedUpdate')), async () => {
      const records = createSqlServerRecords(pool())
      const target = versioned(parity, GUARDED)
      const insert = (id: string, note: string) => records.insert({ target, values: [parityValue(GUARDED, 'id', id), parityValue(GUARDED, 'note', note)], returning: [] })
      // The number, and the sentence for a number at or above 50000: a trigger's or a procedure's own, for whoever reads the log.
      const own = (number: string) => expect.stringContaining(`an error of its own (${number}), a trigger's or a procedure's`)
      expect(await insert('1', 'refuse')).toMatchObject({ ok: false, code: REFUSAL_PARITY.guardedInsert, message: own('50001') })
      expect(await insert('2', 'odd')).toMatchObject({ ok: false, code: REFUSAL_PARITY.oddInsert, message: own('50000') })
      await owner.request().batch("if not exists (select 1 from parity.guarded where id = 10) insert into parity.guarded (id, note) values (10, N'fine')")
      for (const note of ['refuse', 'odd']) {
        const update: UpdateRequest = { target, key: [parityValue(GUARDED, 'id', '10')], set: [parityValue(GUARDED, 'note', note)], expectedVersion: '0', filters: EVERY_ROW, returning: [] }
        expect(await records.update(update)).toMatchObject({ ok: false, code: REFUSAL_PARITY.guardedUpdate, message: own(note === 'refuse' ? '50001' : '50000') })
      }
      const stored = await owner.request().query<{ id: number; note: string; version: number }>('select id, note, version from parity.guarded')
      expect(stored.recordset).toEqual([{ id: 10, note: 'fine', version: 0 }])
    })
  }

  // An INSTEAD OF trigger that stores nothing and says nothing (C9b): the
  // adapter cannot verify what it stored, so it refuses the write. It was
  // `unavailable`; PostgreSQL's BEFORE trigger returning NULL is the same
  // refusal, and neither passes with time.
  test('a declined insert is refused, and nothing is written', covers('sqlserver', refusalCase('declinedInsert')), async () => {
    for (const [, pool] of sessions) {
      const records = createSqlServerRecords(pool())
      const target: RecordTarget = { table: DECLINED, identity: [columnOf(parity, DECLINED, 'id')], concurrency: null }
      const outcome = await records.insert({ target, values: [parityValue(DECLINED, 'id', '1'), parityValue(DECLINED, 'note', 'declined')], returning: [] })
      expect(outcome).toMatchObject({ ok: false, code: REFUSAL_PARITY.declinedInsert, message: expect.stringContaining('INSTEAD OF') })
    }
    expect(await scalar<number>('select count(*) as value from parity.declined')).toBe(0)
  })

  // Writing a column the database generates is what PostgreSQL calls 428C9:
  // the binding names a column the database now writes itself. 544 and 8102
  // are an identity, 271 a computed column, 273 and 272 a rowversion, 13536
  // and 13537 a system-versioning period's GENERATED ALWAYS column — local
  // .drifting's columns became each after discovery, which is how a binding
  // comes to name one, and discovery counts every one as generated. 544 was
  // `unavailable`; the period's numbers were `refused`, as if sending again
  // could not help when a review of the form would.
  test('writing a generated column is schema-changed, and nothing is written', covers('sqlserver', refusalCase('generatedInsert')), async () => {
    for (const [, pool] of sessions) {
      const records = createSqlServerRecords(pool())
      const generated: RecordTarget = { table: GENERATED, identity: [columnOf(parity, GENERATED, 'id')], concurrency: null }
      const named = await records.insert({ target: generated, values: [parityValue(GENERATED, 'id', '5'), parityValue(GENERATED, 'note', 'named')], returning: [] })
      expect(named).toMatchObject({ ok: false, code: REFUSAL_PARITY.generatedInsert, message: expect.stringContaining('544') })

      const drifting = versioned(local, DRIFTING)
      for (const [column, value, inserted, updated] of [
        ['made', '7', '544', '8102'],
        ['computed', '7', '271', '271'],
        ['stamped', '7', '273', '272'],
        ['started', '2026-10-09T10:00:00Z', '13536', '13537'],
        ['ended', '2026-10-09T10:00:00Z', '13536', '13537'],
      ] as const) {
        const insert = await records.insert({ target: drifting, values: [localValue(DRIFTING, 'id', '2'), localValue(DRIFTING, column, value)], returning: [] })
        expect(insert, `insert ${column}`).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringContaining(inserted) })
        const update: UpdateRequest = { target: drifting, key: [localValue(DRIFTING, 'id', '1')], set: [localValue(DRIFTING, column, value)], expectedVersion: '0', filters: EVERY_ROW, returning: [] }
        expect(await records.update(update), `update ${column}`).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringContaining(updated) })
      }
    }
    expect(await scalar<number>('select count(*) as value from parity.generated')).toBe(0)
    expect(await scalar<string>("select string_agg(concat(id, ':', version), ',') as value from local.drifting")).toBe('1:0')
  })

  // An error number this adapter has no code for — a trigger dividing by
  // zero, 8134 — was `unavailable`, a promise it would pass. Nothing says it
  // will, so it is `refused`, with the number for whoever reads the log.
  test('an error number the adapter does not recognise is refused, and nothing is written', async () => {
    const records = createSqlServerRecords(owner)
    const target: RecordTarget = { table: DIVIDING, identity: [columnOf(local, DIVIDING, 'id')], concurrency: null }
    expect(await records.insert({ target, values: [localValue(DIVIDING, 'id', '1')], returning: [] })).toMatchObject({
      ok: false,
      code: 'refused',
      message: expect.stringContaining('8134'),
    })
    expect(await scalar<number>('select count(*) as value from local.dividing')).toBe(0)
  })

  // A deadlock victim (1205) is the one refusal SQL Server documents as
  // passing, so it stays `unavailable`. The holder takes row 2, the adapter's
  // update of row 1 waits in its trigger for row 2, and only once the server
  // shows it blocked does the holder ask for row 1: on a timer the update
  // sometimes finished first and nothing deadlocked (C10). The holder's high
  // deadlock priority makes the adapter the one chosen.
  test('the victim of a deadlock is unavailable, and the row is unchanged', covers('sqlserver', refusalCase('deadlockVictim')), async () => {
    const adapterPool = await connect({ ...fixture.admin, pool: { max: 1 } })
    const holderPool = await connect({ ...fixture.admin, pool: { max: 1 } })
    const holder = new mssql.Transaction(holderPool)
    try {
      const session = (await adapterPool.request().query<{ id: number }>('select @@spid as id')).recordset[0]?.id ?? 0
      await holder.begin()
      await new mssql.Request(holder).batch('set deadlock_priority high; select id from parity.contended with (updlock, rowlock) where id = 2')
      const update: UpdateRequest = {
        target: versioned(parity, CONTENDED),
        key: [parityValue(CONTENDED, 'id', '1')],
        set: [parityValue(CONTENDED, 'note', 'changed')],
        expectedVersion: '0',
        filters: EVERY_ROW,
        returning: [],
      }
      const pending = createSqlServerRecords(adapterPool).update(update)
      await blocked(session)
      await new mssql.Request(holder).query('select id from parity.contended with (updlock, rowlock) where id = 1')
      expect(await pending).toMatchObject({ ok: false, code: REFUSAL_PARITY.deadlockVictim, message: expect.stringContaining('1205') })
    } finally {
      await holder.rollback()
      await holderPool.close()
      await adapterPool.close()
    }
    expect(await scalar<string>("select concat(note, ':', version) as value from parity.contended where id = 1")).toBe('one:0')
  })

  // A database switched to read-only refuses every write with 3906. It is
  // PostgreSQL's 25006 — a read-only transaction, a standby — which is
  // `unavailable` there: the database cannot take writes now, and will when
  // it is writable again or a failover finishes. As the default it was
  // `refused`, which told a person the same request would be refused forever.
  // A database of its own, because READ_ONLY ends every session in it.
  test('a write to a database switched to read-only is unavailable, and nothing is written', async () => {
    await owner.request().batch('create database ro_probe')
    const probe: mssql.config = { ...fixture.admin, database: 'ro_probe' }
    const setup = await connect(probe)
    let snapshot: MetadataSnapshot
    try {
      await setup.request().batch(`create table dbo.note (id int not null constraint pk_note primary key, note nvarchar(50) null,
        version int not null constraint df_note_version default 0);
        insert into dbo.note (id, note) values (1, N'one')`)
      snapshot = await discoverSqlServer(setup, { schemas: ['dbo'] })
    } finally {
      await setup.close()
    }
    await owner.request().batch('alter database ro_probe set read_only with rollback immediate')
    const reader = await connect(probe)
    try {
      const NOTE: ObjectRef = { schema: 'dbo', name: 'note' }
      const value = (name: string, given: string): RecordValue => ({ ...columnOf(snapshot, NOTE, name), value: given })
      const records = createSqlServerRecords(reader)
      const target = versioned(snapshot, NOTE)
      const unavailable = { ok: false, code: 'unavailable', message: expect.stringContaining('3906') }
      expect(await records.insert({ target, values: [value('id', '2'), value('note', 'two')], returning: [] })).toMatchObject(unavailable)
      const update: UpdateRequest = { target, key: [value('id', '1')], set: [value('note', 'changed')], expectedVersion: '0', filters: EVERY_ROW, returning: [] }
      expect(await records.update(update)).toMatchObject(unavailable)
      const stored = await reader.request().query<{ id: number; note: string; version: number }>('select id, note, version from dbo.note')
      expect(stored.recordset).toEqual([{ id: 1, note: 'one', version: 0 }])
    } finally {
      await reader.close()
      await owner.request().batch('alter database ro_probe set single_user with rollback immediate; drop database ro_probe')
    }
  })
})

/** Waits until the server shows `session` waiting on another's lock: polled, never a fixed delay. */
async function blocked(session: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = await owner
      .request()
      .input('session', mssql.Int, session)
      .query<{ blocker: number }>('select blocking_session_id as blocker from sys.dm_exec_requests where session_id = @session')
    if ((found.recordset[0]?.blocker ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`session ${String(session)} never waited on the held row`)
}
