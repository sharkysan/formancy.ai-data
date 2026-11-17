import { LIST_PAGE_SIZE } from '@formancy/data-core'
import type { ActionAdapter, ActionOutcome, ActionRequest } from '@formancy/data-core'
import {
  ACTION_DECLINED_REASON,
  ACTION_SCOPE,
  actionAnswer,
  actionCase,
  actionExpected,
  actionForms,
  actionTagForm,
  actionToken,
  covers,
  plannedSelection,
  startSqlServerFixture,
  tagToken,
} from '@formancy/data-fixtures'
import type { ActionBundle, ActionCase, ActionForms, SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerActions, discoverSqlServer } from './index.js'

/*
 * An action's run over a selection of records (0165) against REAL SQL
 * Server loaded with the actions schema (fixtures/sqlserver.actions.sql):
 * `close-all`, close_order over the orders chosen, in one batch. Each
 * shared case's answer is written once in `@formancy/data-fixtures`
 * (`ACTION_PARITY`), and the PostgreSQL suite runs the same cases, each
 * declared with `covers()` (0035); the case only SQL Server has -- two
 * keys a case-insensitive key collation makes one row -- follows them.
 *
 * As in actions.integration.test.ts, every run goes as formancy_writer and
 * is the planner's, planned before anything a case changes; the owner
 * inserts, reads what is stored and counts the calls that began by the
 * sequence each procedure draws from as it begins, which no rollback gives
 * back.
 *
 * Written on 2026-11-17 on a machine without Docker: CI is these cases'
 * first run, and none has yet been watched failing. Each says the rule it
 * holds and the failure it prevents.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let writer: mssql.ConnectionPool
let actions: ActionAdapter
let forms: ActionForms
let tagged: ActionBundle

/** The deadline a case runs under: its half, the lock timeout, long enough for a loaded runner's waits; the whole for a page of calls. */
const DEADLINE = 20_000
/** How long a case waits for the database to reach a state it polls for. Generous: a loaded runner, not a measurement. */
const PATIENCE_MS = 15_000

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  writer = await new mssql.ConnectionPool(fixture.writer).connect()
  const snapshot = await discoverSqlServer(writer, ACTION_SCOPE)
  forms = actionForms(snapshot)
  tagged = actionTagForm(snapshot)
  actions = createSqlServerActions(writer)
})

afterAll(async () => {
  await writer?.close()
  await owner?.close()
  await fixture?.stop()
})

const expected = (name: ActionCase): string => actionExpected(name, 'sqlserver')

/** One statement as the owner, its values bound by name: its rows. */
async function query<Row>(sql: string, values: Record<string, number | string> = {}): Promise<Row[]> {
  const request = owner.request()
  for (const [name, value] of Object.entries(values)) request.input(name, typeof value === 'number' ? mssql.BigInt : mssql.NVarChar(mssql.MAX), value)
  const result = await request.query<Row>(sql)
  return [...(result.recordset ?? [])]
}

/** `count` orders of one new customer of tenant 1, each of `amount`, as the owner inserts them; their ids, ascending. */
async function orders(count: number, amount = '12.50'): Promise<number[]> {
  const [customer] = await query<{ id: string }>("insert into actions.customer (tenant_id, name) output inserted.id values (1, N'Customer')")
  const rows = await query<{ id: string }>(
    'insert into actions.[order] (customer_id, amount) output inserted.id select top (@count) @customer, convert(decimal(12, 2), @amount) from sys.all_objects',
    { count, customer: Number((customer as { id: string }).id), amount },
  )
  return rows.map((row) => Number(row.id)).sort((left, right) => left - right)
}

/** Each order's status and version, as the owner reads them, in the order of `ids`. */
async function stored(ids: readonly number[]): Promise<Array<{ status: string; version: number }>> {
  const rows = await query<{ id: string; status: string; version: number }>(
    `select convert(nvarchar(20), id) as id, status, version from actions.[order] where N',' + @ids + N',' like N'%,' + convert(nvarchar(20), id) + N',%'`,
    { ids: ids.join(',') },
  )
  return ids.map((id) => {
    const row = rows.find((candidate) => Number(candidate.id) === id)
    return { status: row?.status ?? 'gone', version: row?.version ?? 0 }
  })
}

/** Every call close_order recorded for any of `ids`, as `id:note`, by id. */
async function calls(ids: readonly number[]): Promise<string[]> {
  const rows = await query<{ call: string }>(
    `select concat_ws(N':', convert(nvarchar(20), record_id), note) as [call] from actions.call
     where routine = N'close_order' and N',' + @ids + N',' like N'%,' + convert(nvarchar(20), record_id) + N',%' order by record_id, id`,
    { ids: ids.join(',') },
  )
  return rows.map((row) => row.call)
}

/** How many calls of the actions schema's procedures have begun, as the sequence each draws from as it begins counts them. */
async function begun(): Promise<number> {
  const [row] = await query<{ n: string }>(
    "select convert(nvarchar(20), coalesce(convert(bigint, last_used_value), 0)) as n from sys.sequences where object_id = object_id(N'actions.called')",
  )
  return Number((row as { n: string }).n)
}

/** `run`'s outcome, and how many procedure calls began while it ran. */
async function counted<T>(run: () => Promise<T>): Promise<{ outcome: T; begun: number }> {
  const before = await begun()
  const outcome = await run()
  return { outcome, begun: (await begun()) - before }
}

/** `close-all` over `ids`, in that order, with this note, planned from the versions the owner reads now. */
async function planned(ids: readonly number[], note: string): Promise<ActionRequest> {
  const versions = await stored(ids)
  const records = ids.map((id, index) => ({ record: actionToken(id), version: String(versions[index]?.version ?? 1) }))
  return plannedSelection(actions, forms.orders, 'close-all', { records, answers: { note } })
}

async function until(read: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error(`never ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** How many requests of other sessions wait on a lock another session holds. */
async function blockedRequests(): Promise<number> {
  const [row] = await query<{ n: number }>('select count(*) as n from sys.dm_exec_requests where blocking_session_id <> 0 and session_id <> @@spid')
  return row?.n ?? 0
}

/** Holds `id`'s order row, X-locked, in a transaction of its own until `release` is called. */
async function hold(id: number): Promise<{ release: () => Promise<void> }> {
  const pool = await new mssql.ConnectionPool({ ...fixture.admin, pool: { min: 0, max: 1 } }).connect()
  const transaction = new mssql.Transaction(pool)
  await transaction.begin()
  await new mssql.Request(transaction).input('id', mssql.BigInt, id).query('update actions.[order] set note = note where id = @id')
  let released = false
  return {
    release: async () => {
      if (released) return
      released = true
      await transaction.rollback()
      await pool.close()
    },
  }
}

describe('a run over a selection', () => {
  // Every record chosen commits in one batch: each version moved by one,
  // the procedure called once for each with its own amount read from its
  // own locked row, and each answered by its key in the order sent -- sent
  // here out of key order, which the lock takes in key order and the
  // answer does not. A selection run over its first record alone, or the
  // procedure called once for all, would close one order of three.
  test('commits every record, each moved and called once, answered in the order sent', covers('sqlserver', actionCase('selection-done')), async () => {
    const [a, b, c] = (await orders(3)) as [number, number, number]
    const request = await planned([c, a, b], 'all')
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-done'))
    expect(outcome).toEqual({ ok: true, records: [{ id: String(c) }, { id: String(a) }, { id: String(b) }] })
    expect(called).toBe(3)
    expect(await stored([a, b, c])).toEqual([
      { status: 'closed', version: 2 },
      { status: 'closed', version: 2 },
      { status: 'closed', version: 2 },
    ])
    expect(await calls([a, b, c])).toEqual([`${String(a)}:all`, `${String(b)}:all`, `${String(c)}:all`])
  })

  // Two runs over the same two orders, sent in opposite orders, while a
  // third session holds the lower key's row: each batch runs its UPDATEs
  // in key order, so both wait on that row and neither holds the other's;
  // once it is let go one is done and the other finds both versions moved,
  // `stale`, naming both. Run in the order sent, the second would hold the
  // higher row while waiting on the lower, the first the lower while
  // waiting on the higher, and SQL Server would end one as a deadlock,
  // 1205, or at LOCK_TIMEOUT, 1222: `unavailable` either way.
  test(
    'of two overlapping selections sent in opposite orders, one is done and one stale, never a deadlock',
    covers('sqlserver', actionCase('selection-crossed')),
    async () => {
      const [a, b] = (await orders(2)) as [number, number]
      const first = await planned([a, b], 'first')
      const second = await planned([b, a], 'second')
      const held = await hold(a)
      const running: Array<Promise<ActionOutcome>> = []
      try {
        running.push(actions.run(first, DEADLINE))
        await until(async () => (await blockedRequests()) >= 1, 'seen the first run waiting on the held row')
        running.push(actions.run(second, DEADLINE))
        await until(async () => (await blockedRequests()) >= 2, 'seen both runs waiting')
      } finally {
        await held.release()
      }
      const outcomes = await Promise.all(running)
      expect(outcomes.map(actionAnswer).sort().join(', ')).toBe(expected('selection-crossed'))
      const stale = outcomes.find((outcome) => !outcome.ok)
      expect(stale !== undefined && !stale.ok && [...(stale.records ?? [])].sort()).toEqual([0, 1])
      expect((await stored([a, b])).map((order) => order.version)).toEqual([2, 2])
    },
  )

  // One order of three changed since it was read: nothing is called and
  // nothing kept of any, and the answer names that order by its position,
  // so a page reads it again. A batch that called the procedure over the
  // two that were current would close part of what the person chose.
  test('is stale when one record changed since it was read, naming it, and keeps nothing', covers('sqlserver', actionCase('selection-stale')), async () => {
    const [a, b, c] = (await orders(3)) as [number, number, number]
    const request = await planned([a, b, c], 'all')
    await query('update actions.[order] set version = version + 1 where id = @id', { id: b })
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-stale'))
    expect(!outcome.ok && outcome.records).toEqual([1])
    expect(called).toBe(0)
    expect(await stored([a, b, c])).toEqual([
      { status: 'open', version: 1 },
      { status: 'open', version: 2 },
      { status: 'open', version: 1 },
    ])
  })

  // The procedure refuses one order of three, its amount 66.60, the
  // second sent: the run is declined in its words, and every record is
  // rolled back -- its version, and what the procedure did to the first
  // before the second refused. The calls run in the order sent, so two
  // began and the third never did.
  test('rolls back every record when the procedure refuses one', covers('sqlserver', actionCase('selection-declined')), async () => {
    const [a, c] = (await orders(2)) as [number, number]
    const [b] = (await orders(1, '66.60')) as [number]
    const request = await planned([a, b, c], 'all')
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-declined'))
    expect(!outcome.ok && outcome.reason).toBe(ACTION_DECLINED_REASON)
    expect(called).toBe(2)
    expect((await stored([a, b, c])).map((order) => [order.status, order.version])).toEqual([
      ['open', 1],
      ['open', 1],
      ['open', 1],
    ])
    expect(await calls([a, b, c])).toEqual([])
  })

  // A selection is rows of the one page a list shows: exactly a page
  // commits in one batch, each record called once, and one more is refused
  // before any statement -- by the planner, and by the adapter, which
  // throws a request no planner makes before anything is sent. A batch of
  // a page is a page's UPDATEs and EXECs, its parameters bound once each:
  // past it the batch would grow with whatever a client sent.
  test('commits a page of records, and refuses one more before any statement', covers('sqlserver', actionCase('selection-page')), async () => {
    const ids = await orders(LIST_PAGE_SIZE + 1)
    const page = ids.slice(0, LIST_PAGE_SIZE)
    const request = await planned(page, 'page')
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-page'))
    expect(called).toBe(LIST_PAGE_SIZE)
    expect((await stored(page)).every((order) => order.version === 2)).toBe(true)
    const last = ids[LIST_PAGE_SIZE] as number
    await expect(planned(ids, 'one more')).rejects.toThrow(/invalid-request/)
    const key = request.records[0]?.key[0] as ActionRequest['records'][number]['key'][number]
    const tooMany: ActionRequest = { ...request, records: [...request.records, { key: [{ ...key, value: String(last) }], expectedVersion: '1' }] }
    const refused = await counted(() => actions.run(tooMany, DEADLINE).catch((error: unknown) => (error as Error).message))
    expect(refused.outcome).toContain(`from 1 to ${String(LIST_PAGE_SIZE)} records`)
    expect(refused.begun).toBe(0)
    expect(await stored([last])).toEqual([{ status: 'open', version: 1 }])
  })
})

describe('a run over a selection on SQL Server alone', () => {
  /** A tag, as the owner inserts it; the rowversion a person read it at, as a token's hex. */
  async function tag(code: string): Promise<string> {
    const [row] = await query<{ version: string }>(
      'insert into actions.tag (code) output lower(convert(nvarchar(16), convert(binary(8), inserted.row_version), 2)) as version values (@code)',
      { code },
    )
    return (row as { version: string }).version
  }

  async function tagVersion(code: string): Promise<string> {
    const [row] = await query<{ version: string }>(
      'select lower(convert(nvarchar(16), convert(binary(8), row_version), 2)) as version from actions.tag where code = @code',
      {
        code,
      },
    )
    return (row as { version: string }).version
  }

  // `alpha` and `ALPHA` are two tokens, two keys to the planner, and one
  // row under the key's case-insensitive collation: the first UPDATE in
  // key order moves it, the second finds its version moved, and the batch
  // finds the one row named twice before any call -- `duplicate-record`,
  // naming both, rolled back, nothing called. Read as the second record's
  // `stale`, a person would be sent to reload a record nobody changed; and
  // with both sent at versions that each match in turn, the procedure would
  // run twice over one row.
  test('is duplicate-record for two keys its collation makes one row, nothing called', async () => {
    const version = await tag('alpha')
    const request = await plannedSelection(actions, tagged, 'touch', {
      records: [
        { record: tagToken('alpha'), version },
        { record: tagToken('ALPHA'), version },
      ],
    })
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe('duplicate-record')
    expect(!outcome.ok && outcome.records).toEqual([0, 1])
    expect(called).toBe(0)
    expect(await tagVersion('alpha')).toBe(version)
  })

  // One spelling of a tag alone is one record, whatever case it is sent
  // in, and is answered by the row's own spelling: the duplicate check is
  // two keys of one row, not a key spelled otherwise than the row.
  test('runs over one spelling of a tag, answered by the row’s own', async () => {
    const version = await tag('beta')
    const request = await plannedSelection(actions, tagged, 'touch', { records: [{ record: tagToken('BETA'), version }] })
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(outcome).toEqual({ ok: true, records: [{ code: 'beta' }] })
    expect(called).toBe(1)
    expect(await tagVersion('beta')).not.toBe(version)
  })
})
