import { encodeRowversion, menuSaves, menuTogether, TOGETHER_MAX_ROWS } from '@formancy/data-core'
import type { RecordAdapter, SaveBody, SaveOutcome, SavePlan, SaveRequest } from '@formancy/data-core'
import {
  covers,
  FIXTURE_SCOPE,
  PARITY_SCOPE,
  plannedSave,
  SAVE_CLERK,
  SAVE_RACE_LOCK,
  saveAnswer,
  saveCase,
  savedForms,
  savedToken,
  saveExpected,
  sizedSaveForms,
  startSqlServerFixture,
} from '@formancy/data-fixtures'
import type { SaveCase, SavedForms, SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'
import { saveBatchOf } from './records/save.js'

/*
 * A save of a record with its rows (0155) against REAL SQL Server loaded
 * with the parity schema (0028). Each case's answer is written once in
 * `@formancy/data-fixtures` (`SAVE_PARITY`), and the PostgreSQL suite runs
 * the same cases, each declared with `covers()` (0035).
 *
 * Every request is the planner's, from the bundles `savedForms` builds over
 * what discovery reports as the owner, planned as the route will plan it
 * (`plannedSave`); where a case needs a request the planner would never
 * make -- a row of another record -- it says so and edits the plan's. The
 * owner inserts what a case starts from, and reads what is stored. The
 * save is one batch (save-batch.ts); what only SQL Server does with it --
 * a text its code page cannot hold, a trigger that commits, the parameters
 * one request may bind -- is held at the end.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let records: RecordAdapter
let forms: SavedForms

/** The deadline a case saves under, unless it is about the deadline: long enough for any step on a loaded runner. */
const DEADLINE = 10_000

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  forms = savedForms(await discoverSqlServer(owner, PARITY_SCOPE))
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

const expected = (name: SaveCase): string => saveExpected(name, 'sqlserver')
const orderToken = (id: number): string => savedToken(['id'], { id })
/** A code no other case or run has typed, for a key the person types. */
const typed = (what: string): string => `${what}-${randomUUID().slice(0, 8)}`

/** One statement as the owner, its values bound by name: its rows. */
async function q<Row>(text: string, values: Record<string, string | number | null> = {}): Promise<Row[]> {
  const request = owner.request()
  for (const [name, value] of Object.entries(values)) request.input(name, value)
  const result = await request.query<Row>(text)
  return [...(result.recordset ?? [])]
}

/** An order of `tenant`, inserted as the owner, with its lines as `[line_no, quantity]` and its marks by number; its id. */
async function order(tenant: number, lines: ReadonlyArray<readonly [number, number]> = [], marks: readonly number[] = []): Promise<number> {
  const [row] = await q<{ id: number }>('insert into parity.saved_order (tenant_id) output inserted.id values (@tenant)', { tenant })
  const id = (row as { id: number }).id
  for (const [line, quantity] of lines)
    await q('insert into parity.saved_line (order_id, line_no, quantity) values (@id, @line, @quantity)', { id, line, quantity })
  for (const mark of marks) await q('insert into parity.saved_mark (order_id, mark_no) values (@id, @mark)', { id, mark })
  return id
}

/** An order as the owner reads it once the save ended: its own columns, its lines and its marks, each in key order. */
async function stored(id: number): Promise<{ order: { note: string | null; total: number; version: number } | null; lines: string[]; marks: number[] }> {
  const [found] = await q<{ note: string | null; total: number; version: number }>('select note, total, version from parity.saved_order where id = @id', { id })
  const lines = await q<{ line: string }>("select concat(line_no, ':', quantity) as line from parity.saved_line where order_id = @id order by line_no", { id })
  const marks = await q<{ mark_no: number }>('select mark_no from parity.saved_mark where order_id = @id order by mark_no', { id })
  return { order: found ?? null, lines: lines.map((row) => row.line), marks: marks.map((row) => row.mark_no) }
}

/** The order's version as the owner reads it: what a person read it at. */
async function versionOf(id: number): Promise<string> {
  const [row] = await q<{ version: string }>('select convert(nvarchar(20), version) as version from parity.saved_order where id = @id', { id })
  return (row as { version: string }).version
}

/** An order's line by its number, as the owner reads it: its id, its token and its version. */
async function line(order: number, no: number): Promise<{ id: number; record: string; version: string }> {
  const [row] = await q<{ id: number; version: string }>(
    'select id, convert(nvarchar(20), version) as version from parity.saved_line where order_id = @order and line_no = @no',
    { order, no },
  )
  const { id, version } = row as { id: number; version: string }
  return { id, record: savedToken(['id'], { id }), version }
}

/** A save of an existing order through the line form, or the mark form. */
async function body(
  id: number,
  changes: SaveBody['rows'][number]['changes'],
  answers: Record<string, unknown> = {},
  rows: 'saved-line' | 'saved-mark' = 'saved-line',
): Promise<SaveBody> {
  return { record: { update: { record: orderToken(id), version: await versionOf(id), answers } }, rows: [{ form: rows, field: 'saved_order', changes }] }
}

/** `save` planned as the route will plan it. */
async function planned(save: SaveBody, deadlineMs: number = DEADLINE, via: RecordAdapter = records): Promise<SavePlan> {
  return plannedSave(via, forms.orders, [forms.lines, forms.marks], save, deadlineMs)
}

async function saved(save: SaveBody, deadlineMs: number = DEADLINE): Promise<SaveOutcome> {
  return records.save((await planned(save, deadlineMs)).request)
}

const create = (ref: string, answers: Record<string, unknown>) => ({ create: { ref, answers } })

/** `request` with `change` made to a copy: a request the planner would not make, for what only the adapter can hold. */
function edited(request: SaveRequest, change: (draft: { -readonly [K in keyof SaveRequest]: SaveRequest[K] }) => void): SaveRequest {
  const draft = structuredClone(request)
  change(draft)
  return draft
}

describe('a save that commits', () => {
  // The record's step returns the key the database numbered, captured from
  // OUTPUT as text and converted back for every line (`fromText`): a pin
  // bound from anything else would store the lines under no order, which NOT
  // NULL refuses, or another. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the numbered key read
  // back as NULL: "expected 'child 0 create 0: not-null-violation' to be
  // 'saved'".
  test('stores a new order the database numbers, and its lines under its new key', covers('sqlserver', saveCase('new-numbered')), async () => {
    const outcome = await saved({
      record: { create: { answers: { tenant_id: 1, note: 'new' } } },
      rows: [
        {
          form: 'saved-line',
          field: 'saved_order',
          changes: [create('a', { line_no: 1, quantity: 2 }), create('b', { line_no: 2, quantity: 3 }), create('c', { line_no: 3, quantity: 4 })],
        },
      ],
    })
    expect(saveAnswer(outcome)).toBe(expected('new-numbered'))
    if (!outcome.ok) return
    const id = Number(outcome.record.values.id)
    expect(await stored(id)).toMatchObject({ order: { note: 'new', total: 9 }, lines: ['1:2', '2:3', '3:4'] })
    expect(outcome.children[0]?.rows.map((row) => ('values' in row ? row.values.order_id : null))).toEqual([String(id), String(id), String(id)])
  })

  // A key the person types is bound where it is known, and each entry is
  // written under it; the child that requires rows of a new account (min 1)
  // is satisfied by them. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with a known key bound as
  // NULL: "expected 'child 0 create 0: not-null-violation' to be 'saved'".
  test('stores a new account under the code the person typed, and its entries', covers('sqlserver', saveCase('new-typed')), async () => {
    const code = typed('acc')
    const plan = await plannedSave(
      records,
      forms.accounts,
      [forms.entries],
      {
        record: { create: { answers: { code, note: 'typed' } } },
        rows: [{ form: 'saved-entry', field: 'saved_account', changes: [create('a', { entry_no: 1, amount: 10 }), create('b', { entry_no: 2, amount: 20 })] }],
      },
      DEADLINE,
    )
    expect(saveAnswer(await records.save(plan.request))).toBe(expected('new-typed'))
    const entries = await q<{ entry_no: number }>('select entry_no from parity.saved_entry where account_code = @code order by entry_no', { code })
    expect(entries.map((row) => row.entry_no)).toEqual([1, 2])
  })

  // Every kind of step over a saved order in one batch: the order's own note,
  // a line updated, one deleted and one created. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the deletes not run: "SQL
  // Server reported no row for a step the batch wrote."
  test('stores every change to a saved order and its lines', covers('sqlserver', saveCase('existing')), async () => {
    const id = await order(1, [
      [1, 1],
      [2, 1],
    ])
    const outcome = await saved(
      await body(
        id,
        [{ update: { ...(await line(id, 1)), answers: { quantity: 5 } } }, { delete: await line(id, 2) }, create('n', { line_no: 3, quantity: 7 })],
        {
          note: 'changed',
        },
      ),
    )
    expect(saveAnswer(outcome)).toBe(expected('existing'))
    expect(await stored(id)).toMatchObject({ order: { note: 'changed', total: 12 }, lines: ['1:5', '3:7'] })
  })

  // A save of rows alone still moves the order's version (0155's touch), so a
  // second save of its rows with the version first read is stale. Watched
  // failing on mcr.microsoft.com/mssql/server:2022-latest with the touch
  // taken out: "expected '1' to be '2'".
  test("moves the order's version when its own fields are left alone", covers('sqlserver', saveCase('touched')), async () => {
    const id = await order(1)
    const save = await body(id, [create('m', { mark_no: 1 })], {}, 'saved-mark')
    expect(saveAnswer(await saved(save))).toBe(expected('touched'))
    expect(await versionOf(id)).toBe(String(Number((save.record as { update: { version: string } }).update.version) + 1))
    expect(saveAnswer(await saved({ ...save, rows: [{ form: 'saved-mark', field: 'saved_order', changes: [create('m', { mark_no: 2 })] }] }))).toBe(
      expected('stale-record'),
    )
  })

  // The lines' trigger moves the order's total and version after the order's
  // own step, after OUTPUT saw it: the answer is the order read back by its
  // key last, so the total and the version answered are the ones stored, and
  // the next save is not stale. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the record read back
  // before its rows' steps, which left the last count's row count to the
  // checks after it: "expected 'child 0 count: refused' to be 'saved'".
  test("answers the order as the lines' trigger left it", covers('sqlserver', saveCase('read-back')), async () => {
    const id = await order(1, [[1, 2]])
    const outcome = await saved(
      await body(id, [{ update: { ...(await line(id, 1)), answers: { quantity: 5 } } }, create('n', { line_no: 2, quantity: 3 })], { note: 'totalled' }),
    )
    expect(saveAnswer(outcome)).toBe(expected('read-back'))
    if (!outcome.ok) return
    expect(outcome.record.values).toMatchObject({ note: 'totalled', total: '8' })
    expect(outcome.record.version).toBe(await versionOf(id))
  })

  // Deletes run before creates, so line 2 removed and a new line 2 added are
  // one save. Watched failing on mcr.microsoft.com/mssql/server:2022-latest
  // with the creates run before the deletes: "expected 'child 0 create 0:
  // unique-violation' to be 'saved'".
  test('deletes a line and creates another under its number', covers('sqlserver', saveCase('delete-then-create')), async () => {
    const id = await order(1, [
      [1, 1],
      [2, 1],
    ])
    const outcome = await saved(await body(id, [{ delete: await line(id, 2) }, create('n', { line_no: 2, quantity: 9 })]))
    expect(saveAnswer(outcome)).toBe(expected('delete-then-create'))
    expect((await stored(id)).lines).toEqual(['1:1', '2:9'])
  })
})

describe('a save that is refused stores nothing', () => {
  // The order's own check refuses its step, the first; CATCH records it at
  // the record's step, and nothing after it runs. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the record's refusal
  // answered as a step that changed nothing: "expected 'record: stale' to be
  // 'record: check-violation'".
  test("at the record's step", covers('sqlserver', saveCase('record-refused')), async () => {
    const id = await order(1)
    const before = await stored(id)
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 1, quantity: 1 })], { note: 'refused' })))).toBe(expected('record-refused'))
    expect(await stored(id)).toEqual(before)
  })

  // The order's own policy admits another tenant's order, the line lookup's
  // filter does not: `within` refuses the line, answered at the child, and
  // the order's touch is rolled back. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with `within` left out of the
  // batch: "expected 'saved' to be 'child 0 within: rejected'".
  test('at a child whose lookup does not admit the order', covers('sqlserver', saveCase('within-refused')), async () => {
    const id = await order(2)
    const before = await stored(id)
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 1, quantity: 1 })])))).toBe(expected('within-refused'))
    expect(await stored(id)).toEqual(before)
  })

  // A line refused by its check at the first, the middle and the last place:
  // the order's touch and every line before it are rolled back with the
  // batch's one transaction. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest at each place with every step
  // committed in a transaction of its own: "expected { order: { note: null,
  // …(2) }, …(2) } to deeply equal { order: { note: null, …(2) }, …(2) }",
  // the touch and the lines before it stored; and with a step's refusal
  // answered at the save: "expected 'save: check-violation' to be 'child 0
  // create 1: check-violation'".
  test.each([
    ['first-row-refused', 0],
    ['middle-row-refused', 1],
    ['last-row-refused', 2],
  ] as const)('at the %s', async (name, refused) => {
    const id = await order(1)
    const before = await stored(id)
    const changes = [0, 1, 2].map((at) => create(String(at), { line_no: at + 1, quantity: at === refused ? -1 : 1 }))
    expect(saveAnswer(await saved(await body(id, changes)))).toBe(expected(name))
    expect(await stored(id)).toEqual(before)
  })

  // The save's order is read when it is planned; one that moved since is
  // refused at its own step, and no line is written. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the record's version
  // guard taken out: "expected 'saved' to be 'record: stale'".
  test('when the order changed since it was read', covers('sqlserver', saveCase('stale-record')), async () => {
    const id = await order(1, [[1, 1]])
    const plan = await planned(await body(id, [create('n', { line_no: 2, quantity: 1 })]))
    await q('update parity.saved_order set version = version + 1 where id = @id', { id })
    expect(saveAnswer(await records.save(plan.request))).toBe(expected('stale-record'))
    expect((await stored(id)).lines).toEqual(['1:1'])
  })

  // A mark that moved since it was listed is refused at its step, and the
  // order's touch is rolled back. A mark, because a line's own trigger moves
  // the order too, which would answer the order stale first. Watched failing
  // on mcr.microsoft.com/mssql/server:2022-latest with the row's version
  // guard taken out: "expected 'saved' to be 'child 0 update 0: stale'".
  test('when a row changed since it was read', covers('sqlserver', saveCase('stale-row')), async () => {
    const id = await order(1, [], [1])
    const [row] = await q<{ id: number; version: string }>('select id, convert(nvarchar(20), version) as version from parity.saved_mark where order_id = @id', {
      id,
    })
    const { id: mark, version: read } = row as { id: number; version: string }
    const plan = await planned(
      await body(id, [{ update: { record: savedToken(['id'], { id: mark }), version: read, answers: { note: 'changed' } } }], {}, 'saved-mark'),
    )
    await q('update parity.saved_mark set version = version + 1 where id = @mark', { mark })
    const version = await versionOf(id)
    expect(saveAnswer(await records.save(plan.request))).toBe(expected('stale-row'))
    const [after] = await q<{ note: string | null }>('select note from parity.saved_mark where id = @mark', { mark })
    expect(after?.note).toBeNull()
    expect(await versionOf(id)).toBe(version)
  })

  // The pin, which no type can make an adapter apply (0155): another order's
  // line, sent at its own true version through this order's save -- a request
  // the planner never makes, so the plan's is edited -- is not found, by the
  // batch's update and by the read that explains it, and is not touched.
  // Watched failing on mcr.microsoft.com/mssql/server:2022-latest with the
  // pin left out of the update: "expected 'saved' to be 'child 0 update 0:
  // not-found'", and out of the explaining read alone: "expected 'child 0
  // update 0: stale' to be 'child 0 update 0: not-found'".
  test("when a line is another order's", covers('sqlserver', saveCase('other-record-row')), async () => {
    const id = await order(1, [[1, 1]])
    const other = await order(1, [[1, 1]])
    const theirs = await line(other, 1)
    const plan = await planned(await body(id, [{ update: { ...(await line(id, 1)), answers: { quantity: 6 } } }]))
    const request = edited(plan.request, (draft) => {
      const update = draft.children[0]?.updates[0] as SaveRequest['children'][number]['updates'][number]
      Object.assign(update, { key: update.key.map((value) => ({ ...value, value: String(theirs.id) })), expectedVersion: theirs.version })
    })
    expect(saveAnswer(await records.save(request))).toBe(expected('other-record-row'))
    expect((await stored(other)).lines).toEqual(['1:1'])
  })

  // The same for a delete, which its explaining read pins too (0155). Watched
  // failing on mcr.microsoft.com/mssql/server:2022-latest with the pin left
  // out of the delete: "expected 'saved' to be 'child 0 delete 0:
  // not-found'", and out of its explaining read alone: "expected 'child 0
  // delete 0: stale' to be 'child 0 delete 0: not-found'".
  test("when a deleted line is another order's", covers('sqlserver', saveCase('other-record-delete')), async () => {
    const id = await order(1, [[1, 1]])
    const other = await order(1, [[1, 1]])
    const theirs = await line(other, 1)
    const plan = await planned(await body(id, [{ delete: await line(id, 1) }]))
    const request = edited(plan.request, (draft) => {
      const removed = draft.children[0]?.deletes[0] as SaveRequest['children'][number]['deletes'][number]
      Object.assign(removed, { key: removed.key.map((value) => ({ ...value, value: String(theirs.id) })), expectedVersion: theirs.version })
    })
    expect(saveAnswer(await records.save(request))).toBe(expected('other-record-delete'))
    expect((await stored(other)).lines).toEqual(['1:1'])
    expect((await stored(id)).lines).toEqual(['1:1'])
  })

  // A line number the order holds already: refused at that line's step, by
  // SQL Server's own 2627 that CATCH recorded with the step, translated by
  // the rule a single write's is, with the constraint. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with a step's refusal answered
  // at the save: "expected 'save: unique-violation' to be 'child 0 create 0:
  // unique-violation'".
  test('at the step of a duplicate line, naming its constraint', covers('sqlserver', saveCase('unique-violation')), async () => {
    const id = await order(1, [[1, 1]])
    const outcome = await saved(await body(id, [create('n', { line_no: 1, quantity: 2 })]))
    expect(saveAnswer(outcome)).toBe(expected('unique-violation'))
    expect(outcome.ok ? undefined : 'failure' in outcome ? outcome.failure.constraint : undefined).toBe('uq_saved_line_no')
  })

  // The lines' table altered after it was described: the line's step's
  // definition guard refuses it, `schema-changed` at its step, with nothing
  // stored. Watched failing on mcr.microsoft.com/mssql/server:2022-latest
  // with the definition's guard taken out: "expected 'saved' to be 'child 0
  // create 0: schema-changed'".
  test("when a line's table moved since it was described", covers('sqlserver', saveCase('child-moved')), async () => {
    const id = await order(1)
    const plan = await planned(await body(id, [create('n', { line_no: 1, quantity: 1 })]))
    await q('alter table parity.saved_line alter column note varchar(60) null')
    try {
      expect(saveAnswer(await records.save(plan.request))).toBe(expected('child-moved'))
      expect((await stored(id)).lines).toEqual([])
    } finally {
      await q('alter table parity.saved_line alter column note varchar(50) null')
    }
  })
})

describe("a child's bounds, counted once every step ran", () => {
  // At `max` the save is stored, one past it is refused by the count, and the
  // line created is rolled back; the planner listed three, so only the count
  // can tell. Watched failing on mcr.microsoft.com/mssql/server:2022-latest
  // with the count compared to `max + 1`: "expected 'saved' to be 'child 0
  // count: held 4'".
  test('hold the most lines an order may have', covers('sqlserver', saveCase('at-max'), saveCase('past-max')), async () => {
    const id = await order(1, [
      [1, 1],
      [2, 1],
    ])
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 3, quantity: 1 })])))).toBe(expected('at-max'))
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 4, quantity: 1 })])))).toBe(expected('past-max'))
    expect((await stored(id)).lines).toEqual(['1:1', '2:1', '3:1'])
  })

  // At `min` an entry is deleted, below it the last one is refused by the
  // count. Watched failing on mcr.microsoft.com/mssql/server:2022-latest with
  // `min` not compared: "expected 'saved' to be 'child 0 count: held 0'".
  test('hold the fewest entries an account may have', covers('sqlserver', saveCase('at-min'), saveCase('past-min')), async () => {
    const code = typed('min')
    await q('insert into parity.saved_account (code, tenant_id) values (@code, 1)', { code })
    await q('insert into parity.saved_entry (account_code, entry_no, amount) values (@code, 1, 1), (@code, 2, 1)', { code })
    const entry = async (no: number) => {
      const [row] = await q<{ id: number; version: string }>(
        'select id, convert(nvarchar(20), version) as version from parity.saved_entry where account_code = @code and entry_no = @no',
        { code, no },
      )
      const { id, version } = row as { id: number; version: string }
      return { delete: { record: savedToken(['id'], { id }), version } }
    }
    const account = async (): Promise<SaveBody['record']> => {
      const [row] = await q<{ version: string }>('select convert(nvarchar(20), version) as version from parity.saved_account where code = @code', { code })
      return { update: { record: savedToken(['code'], { code }), version: (row as { version: string }).version, answers: {} } }
    }
    const save = async (no: number) =>
      records.save(
        (
          await plannedSave(
            records,
            forms.accounts,
            [forms.entries],
            { record: await account(), rows: [{ form: 'saved-entry', field: 'saved_account', changes: [await entry(no)] }] },
            DEADLINE,
          )
        ).request,
      )
    expect(saveAnswer(await save(2))).toBe(expected('at-min'))
    expect(saveAnswer(await save(1))).toBe(expected('past-min'))
    const [left] = await q<{ n: number }>('select count(*) as n from parity.saved_entry where account_code = @code', { code })
    expect(left?.n).toBe(1)
  })

  // The bounds and the count's limit are bound, never written into the batch,
  // and a bound that is not a whole number is thrown before anything is sent.
  // Watched failing on mcr.microsoft.com/mssql/server:2022-latest with the
  // count's limit spliced into the batch: "expected 'set nocount on;\nset
  // xact_abort on;\n…' not to match /1234567|1234568/", and with bounds that
  // are not whole numbers let through: "promise resolved \"{ ok: true,
  // record: { …(2) }, …(1) }\" instead of rejecting".
  test('are bound, and never written into the batch', async () => {
    const id = await order(1)
    const plan = await planned(await body(id, [create('n', { line_no: 1, quantity: 1 })]))
    const large = edited(plan.request, (draft) => {
      Object.assign(draft.children[0]?.count ?? {}, { min: 0, max: 1_234_567 })
    })
    const batch = saveBatchOf(large)
    expect(batch.statement.sql).not.toMatch(/1234567|1234568/)
    expect(batch.statement.parameters.map((parameter) => parameter.value)).toEqual(expect.arrayContaining([1_234_567, 1_234_568]))
    const bad = edited(plan.request, (draft) => {
      Object.assign(draft.children[0]?.count ?? {}, { max: 2.5 })
    })
    await expect(records.save(bad)).rejects.toThrow(/whole numbers/)
    expect((await stored(id)).lines).toEqual([])
  })
})

/** Waits until `n` sessions wait on another's lock: polled, never a fixed delay, so a race is a race and not a sequence. */
async function blocked(n: number): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const [row] = await q<{ n: number }>('select count(*) as n from sys.dm_exec_requests where blocking_session_id > 0')
    if ((row?.n ?? 0) >= n) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${String(n)} saves never queued behind the held lock`)
}

describe("a save's deadline (0155)", () => {
  // No lock is waited for longer than the deadline: another transaction holds
  // the order's row, and the save's touch gives up at the batch's
  // lock_timeout -- 1222, `unavailable`, recorded at the record's step --
  // rather than wait until the holder lets go. The holder lets go once the
  // save answered, or after 3 s. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with no lock timeout set: the
  // save waited the 3 s the holder held the row, and the batch's next step
  // stopped at the deadline -- "expected 'save: unavailable' to be 'record:
  // unavailable'".
  test('stops a lock wait at the deadline', covers('sqlserver', saveCase('lock-timeout')), async () => {
    const id = await order(1)
    const plan = await planned(await body(id, [create('m', { mark_no: 1 })], {}, 'saved-mark'), 300)
    const holder = await new mssql.ConnectionPool({ ...fixture.admin, pool: { min: 0, max: 1 } }).connect()
    try {
      const tx = new mssql.Transaction(holder)
      await tx.begin()
      await new mssql.Request(tx).input('id', mssql.Int, id).query('update parity.saved_order set note = note where id = @id')
      const save = records.save(plan.request)
      const first = await Promise.race([save, new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 3000))])
      await tx.commit()
      const answer = first === 'waited' ? await save : first
      expect(saveAnswer(answer)).toBe(expected('lock-timeout'))
      expect((await stored(id)).marks).toEqual([])
    } finally {
      await holder.close()
    }
  })

  // Three marks, each 0.2 s in its trigger and each under the deadline,
  // together past it: the batch's own check stops it before its next step and
  // CATCH rolls it back, `unavailable`, before COMMIT. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the batch's deadline
  // check taken out: "expected 'saved' to be 'save: unavailable'".
  test('stops between steps once the deadline has passed', covers('sqlserver', saveCase('past-deadline')), async () => {
    const id = await order(1)
    const marks = [1, 2, 3].map((no) => create(String(no), { mark_no: no, note: 'slow' }))
    expect(saveAnswer(await saved(await body(id, marks, {}, 'saved-mark'), 500))).toBe(expected('past-deadline'))
    expect(await stored(id)).toMatchObject({ marks: [] })
  })
})

/** Whether the fixture's database reads committed data from row versions. */
async function snapshotReads(): Promise<boolean> {
  const [row] = await q<{ on: boolean }>('select is_read_committed_snapshot_on as [on] from sys.databases where database_id = db_id()')
  return row?.on === true
}

/** Two saves of `id` that each add the last mark allowed, planned with the version the order has now. */
async function racing(id: number): Promise<[SaveRequest, SaveRequest]> {
  const first = await planned(await body(id, [create('a', { mark_no: 3, note: 'race' })], {}, 'saved-mark'))
  const second = await planned(await body(id, [create('b', { mark_no: 4, note: 'race' })], {}, 'saved-mark'))
  return [first.request, second.request]
}

/** `saves`, raced on pools of their own behind a holder of the order's row and the marks' lock; their answers. */
async function raced(id: number, saves: readonly [SaveRequest, SaveRequest]): Promise<SaveOutcome[]> {
  const pool = await new mssql.ConnectionPool(fixture.admin).connect()
  const adapter = createSqlServerRecords(pool)
  const holder = await new mssql.ConnectionPool({ ...fixture.admin, pool: { min: 0, max: 1 } }).connect()
  try {
    const tx = new mssql.Transaction(holder)
    await tx.begin()
    await new mssql.Request(tx)
      .input('resource', mssql.NVarChar(255), SAVE_RACE_LOCK.sqlserver)
      .query("exec sp_getapplock @Resource = @resource, @LockMode = N'Exclusive', @LockOwner = N'Transaction'")
    await new mssql.Request(tx).input('id', mssql.Int, id).query('update parity.saved_order set note = note where id = @id')
    const pending = saves.map((save) => adapter.save(save))
    await blocked(2)
    await tx.commit()
    return await Promise.all(pending)
  } finally {
    await holder.close()
    await pool.close()
  }
}

/** Sets READ_COMMITTED_SNAPSHOT, ending every other session in the database, on a connection of its own given the time that takes. */
async function snapshotReading(on: boolean): Promise<void> {
  const pool = await new mssql.ConnectionPool({ ...fixture.admin, requestTimeout: 60_000, pool: { min: 0, max: 1 } }).connect()
  try {
    await pool.request().batch(`alter database current set read_committed_snapshot ${on ? 'on' : 'off'} with rollback immediate`)
  } finally {
    await pool.close()
  }
}

describe('two saves of one order at once (0155)', () => {
  // Each save adds the last mark the order may hold, and a third transaction
  // holds the order's row -- and the marks' application lock -- until both
  // wait on it. The record's version moves on every save, so the second finds
  // it moved, `stale`, and the order holds `max` marks. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the touch taken out:
  // neither save waits on the order's row, and under locking READ COMMITTED
  // their two counts deadlock instead, one chosen to lose -- "expected 'child
  // 0 count: unavailable, saved' to be 'record: stale, saved'".
  test('stores one and answers the other stale', covers('sqlserver', saveCase('race')), async () => {
    expect(await snapshotReads()).toBe(false)
    const id = await order(1, [], [1, 2])
    const outcomes = await raced(id, await racing(id))
    expect(outcomes.map(saveAnswer).sort().join(', ')).toBe(expected('race'))
    expect((await stored(id)).marks).toHaveLength(3)
  })

  // Under READ_COMMITTED_SNAPSHOT the count reads row versions as of its own
  // statement, so only the touch serialises the two: the second's UPDATE
  // waits for the order's row, and finds its version moved. Watched failing
  // on mcr.microsoft.com/mssql/server:2022-latest with the touch taken out:
  // "expected 'saved, saved' to be 'record: stale, saved'", four marks where
  // three are the most.
  test('stores one and answers the other stale under READ_COMMITTED_SNAPSHOT', async () => {
    const id = await order(1, [], [1, 2])
    const saves = await racing(id)
    await snapshotReading(true)
    try {
      expect(await snapshotReads()).toBe(true)
      const outcomes = await raced(id, saves)
      expect(outcomes.map(saveAnswer).sort().join(', ')).toBe(expected('race'))
    } finally {
      await snapshotReading(false)
    }
    expect((await stored(id)).marks).toHaveLength(3)
  })
})

describe('what only SQL Server does with a save', () => {
  // A mark's note SQL Server's code page cannot hold -- 'Ł', whose best fit
  // is 'L' -- is stored as something else without an error; the batch's text
  // check refuses it at its step, and the whole save is rolled back with it
  // (0017). Watched failing on mcr.microsoft.com/mssql/server:2022-latest
  // with the text checks taken out: "expected 'saved' to be 'child 0 create
  // 1: out-of-range'".
  test('a text not stored as sent rolls the whole save back', async () => {
    const id = await order(1)
    const before = await stored(id)
    const outcome = await saved(await body(id, [create('a', { mark_no: 1 }), create('b', { mark_no: 2, note: 'Łine' })], {}, 'saved-mark'))
    expect(saveAnswer(outcome)).toBe('child 0 create 1: out-of-range')
    expect(outcome.ok ? undefined : 'failure' in outcome ? outcome.failure.column : undefined).toBe('note')
    expect(await stored(id)).toEqual(before)
  })

  // A trigger that commits the batch's transaction in a step: the record's
  // touch and the steps before it are committed, so the save may be stored in
  // part, and is answered `unknown-outcome` at that step -- never a refusal,
  // which would say nothing was stored (0031 P8). Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with 3609 answered as a
  // refusal: "expected 'child 0 create 1: refused' to be 'child 0 create 1:
  // unknown-outcome'".
  test('a trigger that commits in a step is unknown-outcome', async () => {
    await owner.request().batch(`create trigger parity.tr_saved_mark_commit on parity.saved_mark after insert as
      begin
        set nocount on;
        if exists (select 1 from inserted where note = 'commit') commit transaction;
      end`)
    try {
      const id = await order(1)
      const version = await versionOf(id)
      const outcome = await saved(
        await body(id, [create('a', { mark_no: 1 }), create('b', { mark_no: 2, note: 'commit' }), create('c', { mark_no: 3 })], {}, 'saved-mark'),
      )
      expect(saveAnswer(outcome)).toBe('child 0 create 1: unknown-outcome')
      // Stored in part: the touch and the marks up to the trigger's.
      expect((await stored(id)).marks).toEqual([1, 2])
      expect(await versionOf(id)).not.toBe(version)
    } finally {
      await owner.request().batch('drop trigger parity.tr_saved_mark_commit')
    }
  })

  // `saveParameters` is data-core's prediction of what this batch binds,
  // which the menu and the publish check hold to 2,100 (0155): every batch a
  // shared case's kind of save builds binds at most what the prediction says
  // -- the order's step, each changed row, and each child's count and
  // `within`. Watched failing on mcr.microsoft.com/mssql/server:2022-latest
  // with two values more bound for every step: "an update, a delete and a
  // create of a saved order: expected 46 to be less than or equal to 45".
  test('binds at most what saveParameters predicts', async () => {
    const id = await order(1, [
      [1, 1],
      [2, 1],
    ])
    const bundle = (form: SavedForms[keyof SavedForms]) => ({ ...form, title: form.id })
    const saves = menuSaves(bundle(forms.orders))
    const lines = menuTogether(bundle(forms.lines), SAVE_CLERK)
    if (saves === null || lines === null) throw new Error('the order form carries no save of its lines')
    const cases: Array<[string, SaveBody, number]> = [
      [
        'three creates of a new order',
        {
          record: { create: { answers: { tenant_id: 1, note: 'n' } } },
          rows: [{ form: 'saved-line', field: 'saved_order', changes: [1, 2, 3].map((no) => create(String(no), { line_no: no, quantity: 1 })) }],
        },
        3,
      ],
      [
        'an update, a delete and a create of a saved order',
        await body(
          id,
          [
            { update: { ...(await line(id, 1)), answers: { quantity: 2, note: 'x' } } },
            { delete: await line(id, 2) },
            create('n', { line_no: 3, quantity: 1 }),
          ],
          { note: 'p' },
        ),
        3,
      ],
      ['a touch and one create', await body(id, [create('n', { line_no: 4, quantity: 1 })]), 1],
    ]
    for (const [name, save, changes] of cases) {
      const batch = saveBatchOf((await planned(save)).request)
      expect(batch.statement.parameters.length, name).toBeLessThanOrEqual(saves.parameters + changes * lines.parameters.row + lines.parameters.child)
    }
  })

  // A batch past the 2,100 parameters one request takes is refused, and
  // nothing sent: the guard behind the menu's prediction. A line created
  // under a saved order binds three values -- its number, its quantity and
  // the order's key -- so 800 of them are past it. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the guard taken out, the
  // batch sent and refused by SQL Server itself: "expected 'SQL Server
  // refused the statement with…' to match /binds [0-9]+ parameters, more than
  // th…/".
  test('refuses a batch past 2,100 parameters without sending it', async () => {
    const id = await order(1)
    const plan = await planned(await body(id, [create('n', { line_no: 1, quantity: 1 })]))
    const created = plan.request.children[0]?.creates[0] as SaveRequest['children'][number]['creates'][number]
    const many = edited(plan.request, (draft) => {
      const child = draft.children[0] as (typeof draft.children)[number]
      Object.assign(child, {
        creates: Array.from({ length: 800 }, (_, index) => ({
          ...created,
          values: created.values.map((value) => (value.name === 'line_no' ? { ...value, value: String(index + 1) } : value)),
        })),
        count: { ...child.count, max: 800 },
      })
    })
    expect(saveBatchOf(many).statement.parameters.length).toBeGreaterThan(2100)
    const outcome = await records.save(many)
    expect(saveAnswer(outcome)).toBe('save: refused')
    expect(outcome.ok ? '' : 'failure' in outcome ? outcome.failure.message : '').toMatch(/binds [0-9]+ parameters, more than the 2100/)
    expect((await stored(id)).lines).toEqual([])
  })

  // A rowversion order, whose touch sets its confirmed touch column to
  // itself: the rowversion moves (save-facts.integration.test.ts), so a
  // second save of its lines with the version first read is stale. On the
  // fixture's sales.order, the one rowversion parent here. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the record's version
  // guard taken out: "expected 'child 0 create 0: unique-violation' to be
  // 'record: stale'".
  test("a rowversion order's touch moves its rowversion", async () => {
    const sales = sizedSaveForms(await discoverSqlServer(owner, FIXTURE_SCOPE), TOGETHER_MAX_ROWS)
    const [row] = await q<{ id: number; version: Buffer }>(
      "insert into sales.[order] (tenant_id, customer_no, order_date, amount) output inserted.id, inserted.row_version as version values (1, 1001, '2026-11-15', 1)",
    )
    const { id, version } = row as { id: number; version: Buffer }
    const save = {
      record: { update: { record: savedToken(['id'], { id }), version: encodeRowversion(version), answers: {} } },
      rows: [{ form: 'sales-order-line', field: 'order', changes: [create('a', { line_no: 1, quantity: 1, unit_price: '1.00' })] }],
    }
    const clerk = { actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } }
    const plan = await plannedSave(records, sales.orders, [sales.lines], save, DEADLINE, clerk)
    expect(saveAnswer(await records.save(plan.request))).toBe('saved')
    const [after] = await q<{ version: Buffer }>('select row_version as version from sales.[order] where id = @id', { id })
    expect(after?.version.equals(version)).toBe(false)
    expect(saveAnswer(await records.save(plan.request))).toBe('record: stale')
  })
})
