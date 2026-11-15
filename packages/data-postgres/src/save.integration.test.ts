import type { RecordAdapter, SaveBody, SaveOutcome, SavePlan, SaveRequest } from '@formancy/data-core'
import {
  covers,
  PARITY_SCOPE,
  plannedSave,
  SAVE_RACE_LOCK,
  saveAnswer,
  saveCase,
  savedForms,
  savedToken,
  saveExpected,
  startPostgresFixture,
} from '@formancy/data-fixtures'
import type { PostgresFixture, SaveCase, SavedForms } from '@formancy/data-fixtures'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { countStatement } from './records/save-sql.js'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A save of a record with its rows (0155) against REAL PostgreSQL loaded
 * with the parity schema (0028). Each case's answer is written once in
 * `@formancy/data-fixtures` (`SAVE_PARITY`), and the SQL Server suite runs
 * the same cases, each declared with `covers()` (0035).
 *
 * Every request is the planner's, from the bundles `savedForms` builds over
 * what discovery reports as the owner, planned as the route will plan it
 * (`plannedSave`); where a case needs a request the planner would never
 * make -- a row of another record -- it says so and edits the plan's. The
 * owner inserts what a case starts from, and reads what is stored.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let forms: SavedForms

/** The deadline a case saves under, unless it is about the deadline: long enough for any step on a loaded runner. */
const DEADLINE = 10_000

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  forms = savedForms(await discoverPostgres(owner, PARITY_SCOPE))
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

const expected = (name: SaveCase): string => saveExpected(name, 'postgres')
/** A code no other case or run has typed, for a key the person types. */
const typed = (what: string): string => `${what}-${randomUUID().slice(0, 8)}`
const orderToken = (id: number): string => savedToken(['id'], { id })

/** An order of `tenant`, inserted as the owner, with its lines as `[line_no, quantity]` and its marks by number; its id. */
async function order(tenant: number, lines: ReadonlyArray<readonly [number, number]> = [], marks: readonly number[] = []): Promise<number> {
  const [row] = await owner<{ id: number }[]>`insert into parity.saved_order (tenant_id) values (${tenant}) returning id`
  const id = (row as { id: number }).id
  for (const [line, quantity] of lines) await owner`insert into parity.saved_line (order_id, line_no, quantity) values (${id}, ${line}, ${quantity})`
  for (const mark of marks) await owner`insert into parity.saved_mark (order_id, mark_no) values (${id}, ${mark})`
  return id
}

/** An order as the owner reads it once the save ended: its own columns, its lines and its marks, each in key order. */
async function stored(id: number): Promise<{ order: { note: string | null; total: number; version: number } | null; lines: string[]; marks: number[] }> {
  const [found] = await owner<{ note: string | null; total: number; version: number }[]>`select note, total, version from parity.saved_order where id = ${id}`
  const lines = await owner<{ line: string }[]>`select line_no || ':' || quantity as line from parity.saved_line where order_id = ${id} order by line_no`
  const marks = await owner<{ mark_no: number }[]>`select mark_no from parity.saved_mark where order_id = ${id} order by mark_no`
  return { order: found ?? null, lines: lines.map((row) => row.line), marks: marks.map((row) => row.mark_no) }
}

/** The order's version as the owner reads it: what a person read it at. */
async function versionOf(id: number): Promise<string> {
  const [row] = await owner<{ version: string }[]>`select version::text as version from parity.saved_order where id = ${id}`
  return (row as { version: string }).version
}

/** An order's line by its number, as the owner reads it: its id, its token and its version. */
async function line(order: number, no: number): Promise<{ id: number; record: string; version: string }> {
  const [row] = await owner<
    { id: number; version: string }[]
  >`select id, version::text as version from parity.saved_line where order_id = ${order} and line_no = ${no}`
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

/** `save` planned as the route will plan it, and sent through `via`. */
async function planned(save: SaveBody, deadlineMs: number = DEADLINE): Promise<SavePlan> {
  return plannedSave(records, forms.orders, [forms.lines, forms.marks], save, deadlineMs)
}

async function saved(save: SaveBody, deadlineMs: number = DEADLINE, via: RecordAdapter = records): Promise<SaveOutcome> {
  return via.save((await planned(save, deadlineMs)).request)
}

const create = (ref: string, answers: Record<string, unknown>) => ({ create: { ref, answers } })

describe('a save that commits', () => {
  // The record's step returns the key the database numbered, and every line
  // is written with it: a pin bound from anything else -- the planner's
  // placeholder, nothing -- would store the lines under no order, which
  // NOT NULL refuses, or another. Watched failing on postgres:17-alpine
  // with the returned key read from the next column of the RETURNING row,
  // the tenant's 1, which named an order of an earlier case: "expected
  // 'child 0 create 0: unique-violation' to be 'saved'".
  test('stores a new order the database numbers, and its lines under its new key', covers('postgres', saveCase('new-numbered')), async () => {
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

  // A key the person types is bound where it is known, from the insert's
  // own values, and each entry is written under it; the child that requires
  // rows of a new account (min 1) is satisfied by them. Watched failing on
  // postgres:17-alpine with a known key bound as NULL: "expected 'child 0
  // create 0: not-null-violation' to be 'saved'".
  test('stores a new account under the code the person typed, and its entries', covers('postgres', saveCase('new-typed')), async () => {
    const code = typed('acc')
    const outcome = await plannedSave(
      records,
      forms.accounts,
      [forms.entries],
      {
        record: { create: { answers: { code, note: 'typed' } } },
        rows: [{ form: 'saved-entry', field: 'saved_account', changes: [create('a', { entry_no: 1, amount: 10 }), create('b', { entry_no: 2, amount: 20 })] }],
      },
      DEADLINE,
    ).then((plan) => records.save(plan.request))
    expect(saveAnswer(outcome)).toBe(expected('new-typed'))
    const entries = await owner<{ entry_no: number }[]>`select entry_no from parity.saved_entry where account_code = ${code} order by entry_no`
    expect(entries.map((row) => row.entry_no)).toEqual([1, 2])
  })

  // Every kind of step over a saved order in one transaction: the order's
  // own note, a line updated, one deleted and one created. Watched failing
  // on postgres:17-alpine with the deletes left out of the steps run:
  // "expected { …(3) } to match object { …(2) }", line 2 still there.
  test('stores every change to a saved order and its lines', covers('postgres', saveCase('existing')), async () => {
    const id = await order(1, [
      [1, 1],
      [2, 1],
    ])
    const outcome = await saved(
      await body(
        id,
        [{ update: { ...(await line(id, 1)), answers: { quantity: 5 } } }, { delete: await line(id, 2) }, create('n', { line_no: 3, quantity: 7 })],
        { note: 'changed' },
      ),
    )
    expect(saveAnswer(outcome)).toBe(expected('existing'))
    expect(await stored(id)).toMatchObject({ order: { note: 'changed', total: 12 }, lines: ['1:5', '3:7'] })
  })

  // A save of rows alone still moves the order's version (0155's touch), so
  // a second save of its rows with the version first read is stale. Watched
  // failing on postgres:17-alpine with the touch statement sent as `select
  // true`: "expected '1' to be '2'".
  test("moves the order's version when its own fields are left alone", covers('postgres', saveCase('touched')), async () => {
    const id = await order(1)
    const save = await body(id, [create('m', { mark_no: 1 })], {}, 'saved-mark')
    expect(saveAnswer(await saved(save))).toBe(expected('touched'))
    expect(await versionOf(id)).toBe(String(Number((save.record as { update: { version: string } }).update.version) + 1))
    expect(saveAnswer(await saved({ ...save, rows: [{ form: 'saved-mark', field: 'saved_order', changes: [create('m', { mark_no: 2 })] }] }))).toBe(
      expected('stale-record'),
    )
  })

  // The lines' trigger moves the order's total and version after the
  // order's own step: the answer is the order read back by its key last,
  // never its step's RETURNING, so the version answered is the one stored
  // and the next save is not stale. Watched failing on postgres:17-alpine
  // with the record answered from its own step's row: "expected { id:
  // '195', tenant_id: '1', …(2) } to match object { note: 'totalled',
  // total: '8' }".
  test("answers the order as the lines' trigger left it", covers('postgres', saveCase('read-back')), async () => {
    const id = await order(1, [[1, 2]])
    const outcome = await saved(
      await body(id, [{ update: { ...(await line(id, 1)), answers: { quantity: 5 } } }, create('n', { line_no: 2, quantity: 3 })], { note: 'totalled' }),
    )
    expect(saveAnswer(outcome)).toBe(expected('read-back'))
    if (!outcome.ok) return
    expect(outcome.record.values).toMatchObject({ note: 'totalled', total: '8' })
    expect(outcome.record.version).toBe(await versionOf(id))
  })

  // Deletes run before creates, so line 2 removed and a new line 2 added
  // are one save. Watched failing on postgres:17-alpine with the creates
  // run before the deletes: "expected 'child 0 create 0: unique-violation'
  // to be 'saved'".
  test('deletes a line and creates another under its number', covers('postgres', saveCase('delete-then-create')), async () => {
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
  // The order's own check refuses its step, the first; nothing after it is
  // sent, and the order is as it was. Watched failing on postgres:17-alpine
  // with the record's refusal caught and dropped, its step read as one
  // that changed nothing: "expected 'record: refused' to be 'record:
  // check-violation'".
  test("at the record's step", covers('postgres', saveCase('record-refused')), async () => {
    const id = await order(1)
    const before = await stored(id)
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 1, quantity: 1 })], { note: 'refused' })))).toBe(expected('record-refused'))
    expect(await stored(id)).toEqual(before)
  })

  // The order's own policy admits another tenant's order, the line
  // lookup's filter does not: `within` refuses the line, answered at the
  // child, and the order's touch is rolled back. Watched failing on
  // postgres:17-alpine with `within` left out of the steps: "expected
  // 'saved' to be 'child 0 within: rejected'".
  test('at a child whose lookup does not admit the order', covers('postgres', saveCase('within-refused')), async () => {
    const id = await order(2)
    const before = await stored(id)
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 1, quantity: 1 })])))).toBe(expected('within-refused'))
    expect(await stored(id)).toEqual(before)
  })

  // A line refused by its check at the first, the middle and the last
  // place: the order's touch and every line before it are rolled back.
  // Watched failing on postgres:17-alpine, at each place, with every step
  // sent outside the transaction, each its own: "expected { order: { note:
  // null, …(2) }, …(2) } to deeply equal { order: { note: null, …(2) },
  // …(2) }", the touch and the lines before it stored.
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
  // postgres:17-alpine with the touch's version guard left out: "expected
  // 'saved' to be 'record: stale'".
  test('when the order changed since it was read', covers('postgres', saveCase('stale-record')), async () => {
    const id = await order(1, [[1, 1]])
    const plan = await planned(await body(id, [create('n', { line_no: 2, quantity: 1 })]))
    await owner`update parity.saved_order set version = version + 1 where id = ${id}`
    expect(saveAnswer(await records.save(plan.request))).toBe(expected('stale-record'))
    expect((await stored(id)).lines).toEqual(['1:1'])
  })

  // A mark that moved since it was listed is refused at its step, and the
  // order's touch is rolled back. A mark, because a line's own trigger
  // moves the order too, which would answer the order stale first. Watched
  // failing on postgres:17-alpine with the row's version guard left out of
  // the update (`versionIs`): "expected 'saved' to be 'child 0 update 0:
  // stale'".
  test('when a row changed since it was read', covers('postgres', saveCase('stale-row')), async () => {
    const id = await order(1, [], [1])
    const [row] = await owner<{ id: number; version: string }[]>`select id, version::text as version from parity.saved_mark where order_id = ${id}`
    const { id: mark, version: read } = row as { id: number; version: string }
    const plan = await planned(
      await body(id, [{ update: { record: savedToken(['id'], { id: mark }), version: read, answers: { note: 'changed' } } }], {}, 'saved-mark'),
    )
    await owner`update parity.saved_mark set version = version + 1 where id = ${mark}`
    const version = await versionOf(id)
    expect(saveAnswer(await records.save(plan.request))).toBe(expected('stale-row'))
    const [after] = await owner<{ note: string | null }[]>`select note from parity.saved_mark where id = ${mark}`
    expect(after?.note).toBeNull()
    expect(await versionOf(id)).toBe(version)
  })

  // The pin, which no type can make an adapter apply (0155): another
  // order's line, sent at its own true version through this order's save --
  // a request the planner never makes, so the plan's is edited -- is not
  // found, by the update and by the read that explains it, and is not
  // touched. Watched failing on postgres:17-alpine with the pin left out of
  // the update: "expected 'saved' to be 'child 0 update 0: not-found'", and
  // out of the explaining read alone: "expected 'child 0 update 0: refused'
  // to be 'child 0 update 0: not-found'".
  test("when a line is another order's", covers('postgres', saveCase('other-record-row')), async () => {
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

  // The same for a delete, which its explaining read pins too (0155).
  // Watched failing on postgres:17-alpine with the pin left out of the
  // delete: "expected 'saved' to be 'child 0 delete 0: not-found'", and out
  // of its explaining read alone: "expected 'child 0 delete 0: refused' to
  // be 'child 0 delete 0: not-found'".
  test("when a deleted line is another order's", covers('postgres', saveCase('other-record-delete')), async () => {
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

  // A line number the order holds already: refused at that line's step,
  // with the constraint that names the column. Watched failing on
  // postgres:17-alpine with a step's refusal answered at `save`: "expected
  // 'save: unique-violation' to be 'child 0 create 0: unique-violation'".
  test('at the step of a duplicate line, naming its constraint', covers('postgres', saveCase('unique-violation')), async () => {
    const id = await order(1, [[1, 1]])
    const outcome = await saved(await body(id, [create('n', { line_no: 1, quantity: 2 })]))
    expect(saveAnswer(outcome)).toBe(expected('unique-violation'))
    expect(outcome.ok ? undefined : 'failure' in outcome ? outcome.failure.constraint : undefined).toBe('uq_saved_line_no')
  })

  // The lines' table altered after it was described: the line's guard
  // refuses it, `schema-changed` at its step, with nothing stored. Watched
  // failing on postgres:17-alpine with the definition's guard taken out of
  // the insert: "expected 'saved' to be 'child 0 create 0: schema-changed'".
  test("when a line's table moved since it was described", covers('postgres', saveCase('child-moved')), async () => {
    const id = await order(1)
    const plan = await planned(await body(id, [create('n', { line_no: 1, quantity: 1 })]))
    await owner`alter table parity.saved_line alter column note type varchar(60)`
    try {
      expect(saveAnswer(await records.save(plan.request))).toBe(expected('child-moved'))
      expect((await stored(id)).lines).toEqual([])
    } finally {
      await owner`alter table parity.saved_line alter column note type varchar(50)`
    }
  })
})

/** `request` with `change` made to a copy: a request the planner would not make, for what only the adapter can hold. */
function edited(request: SaveRequest, change: (draft: { -readonly [K in keyof SaveRequest]: SaveRequest[K] }) => void): SaveRequest {
  const draft = structuredClone(request)
  change(draft)
  return draft
}

describe("a child's bounds, counted once every step ran", () => {
  // At `max` the save is stored, one past it is refused by the count, and
  // the line created is rolled back; the planner listed three, so only the
  // count can tell. Watched failing on postgres:17-alpine with the count
  // compared to `max + 1`: "expected 'saved' to be 'child 0 count: held
  // 4'".
  test('hold the most lines an order may have', covers('postgres', saveCase('at-max'), saveCase('past-max')), async () => {
    const id = await order(1, [
      [1, 1],
      [2, 1],
    ])
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 3, quantity: 1 })])))).toBe(expected('at-max'))
    expect(saveAnswer(await saved(await body(id, [create('n', { line_no: 4, quantity: 1 })])))).toBe(expected('past-max'))
    expect((await stored(id)).lines).toEqual(['1:1', '2:1', '3:1'])
  })

  // At `min` an entry is deleted, below it the last one is refused by the
  // count. Watched failing on postgres:17-alpine with `min` not compared:
  // "expected 'saved' to be 'child 0 count: held 0'".
  test('hold the fewest entries an account may have', covers('postgres', saveCase('at-min'), saveCase('past-min')), async () => {
    const code = typed('min')
    await owner`insert into parity.saved_account (code, tenant_id) values (${code}, 1)`
    await owner`insert into parity.saved_entry (account_code, entry_no, amount) values (${code}, 1, 1), (${code}, 2, 1)`
    const entry = async (no: number) => {
      const [row] = await owner<
        { id: number; version: string }[]
      >`select id, version::text as version from parity.saved_entry where account_code = ${code} and entry_no = ${no}`
      const { id, version } = row as { id: number; version: string }
      return { delete: { record: savedToken(['id'], { id }), version } }
    }
    const account = async (): Promise<SaveBody['record']> => {
      const [row] = await owner<{ version: string }[]>`select version::text as version from parity.saved_account where code = ${code}`
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
    const [left] = await owner<{ n: number }[]>`select count(*)::int as n from parity.saved_entry where account_code = ${code}`
    expect(left?.n).toBe(1)
  })

  // The bounds are compared by the adapter and the limit is bound: no
  // number from a bundle reaches the SQL text, and a bound that is not a
  // whole number is thrown before anything is sent. Watched failing on
  // postgres:17-alpine with the limit spliced into the text: "expected
  // 'select count(*)::pg_catalog.text\nfro…' not to contain '1234568'", and
  // with bounds that are not whole numbers let through: "promise resolved
  // \"{ ok: false, …(2) }\" instead of rejecting".
  test('are bound, and never written into the statement', async () => {
    const statement = countStatement({ schema: 'parity', name: 'saved_line' }, [], [], [], 1_234_567)
    expect(statement.text).not.toContain('1234568')
    expect(statement.params).toContain('1234568')
    const id = await order(1)
    const plan = await planned(await body(id, [create('n', { line_no: 1, quantity: 1 })]))
    const bad = edited(plan.request, (draft) => {
      Object.assign(draft.children[0]?.count ?? {}, { max: 2.5 })
    })
    await expect(records.save(bad)).rejects.toThrow(/whole numbers/)
    expect((await stored(id)).lines).toEqual([])
  })
})

/** Waits until `n` backends wait on another's lock: polled, never a fixed delay, so a race is a race and not a sequence. */
async function blocked(n: number): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`
    if ((row?.n ?? 0) >= n) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${String(n)} saves never queued behind the held lock`)
}

describe("a save's deadline (0155)", () => {
  // No lock is waited for longer than the deadline: another transaction
  // holds the order's row, and the save's touch gives up at its
  // lock_timeout -- 55P03, `unavailable`, nothing written -- rather than
  // wait until the holder lets go. Watched failing on postgres:17-alpine
  // with neither timeout set: the save waited the 3 s the holder held the
  // row, and its next statement stopped at the deadline -- "expected 'save:
  // unavailable' to be 'record: unavailable'".
  test('stops a lock wait at the deadline', covers('postgres', saveCase('lock-timeout')), async () => {
    const id = await order(1)
    const plan = await planned(await body(id, [create('m', { mark_no: 1 })], {}, 'saved-mark'), 300)
    // The holder lets go once the save answered, or after 3 s, so a save
    // that waits on is answered once it lets go, and the case says what.
    const held = await owner.begin(async (tx) => {
      await tx`select from parity.saved_order where id = ${id} for update`
      const save = records.save(plan.request)
      const first = await Promise.race([save, new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 3000))])
      return { save, first }
    })
    const answer = held.first === 'waited' ? await held.save : held.first
    expect(saveAnswer(answer)).toBe(expected('lock-timeout'))
    expect((await stored(id)).marks).toEqual([])
  })

  // Three marks, each 0.2 s in its trigger and each under the deadline,
  // together past it: the save stops before its next statement and rolls
  // back, `unavailable`, though no statement ran longer than allowed.
  // Watched failing on postgres:17-alpine with the deadline's checks taken
  // out, before each statement and before COMMIT: "expected 'saved' to be
  // 'save: unavailable'".
  test('stops between statements once the deadline has passed', covers('postgres', saveCase('past-deadline')), async () => {
    const id = await order(1)
    const marks = [1, 2, 3].map((no) => create(String(no), { mark_no: no, note: 'slow' }))
    expect(saveAnswer(await saved(await body(id, marks, {}, 'saved-mark'), 500))).toBe(expected('past-deadline'))
    expect(await stored(id)).toMatchObject({ marks: [] })
  })
})

describe('two saves of one order at once (0155)', () => {
  // Each save adds the last mark the order may hold, and a third
  // transaction holds the order's row -- and the marks' application lock --
  // until both wait on it. The record's version moves on every save, so
  // the second finds it moved, `stale`, and the order holds `max` marks.
  // Watched failing on postgres:17-alpine with the touch sent as `select
  // true`, so neither save
  // waits on the order's row: both wait on the marks' lock instead, both
  // count `max`, and both are saved -- "expected 'saved, saved' to be
  // 'record: stale, saved'", four marks.
  test('stores one and answers the other stale', covers('postgres', saveCase('race')), async () => {
    const id = await order(1, [], [1, 2])
    const first = await planned(await body(id, [create('a', { mark_no: 3, note: 'race' })], {}, 'saved-mark'))
    const second = await planned(await body(id, [create('b', { mark_no: 4, note: 'race' })], {}, 'saved-mark'))
    const holder = postgres(fixture.admin, { max: 1, onnotice: () => {} })
    try {
      const answers = await holder.begin(async (tx) => {
        await tx`select pg_catalog.pg_advisory_xact_lock(${SAVE_RACE_LOCK.postgres})`
        await tx`select from parity.saved_order where id = ${id} for update`
        const pending = [records.save(first.request), records.save(second.request)]
        await blocked(2)
        return { pending }
      })
      const outcomes = await Promise.all(answers.pending)
      expect(outcomes.map(saveAnswer).sort().join(', ')).toBe(expected('race'))
      expect((await stored(id)).marks).toHaveLength(3)
    } finally {
      await holder.end()
    }
  })
})

describe('REPEATABLE READ (0155)', () => {
  // On the locked path the LOCK comes before anything that reads, so the
  // snapshot is the record's step's, taken once every table is held: a mark
  // another transaction committed while the save waited for its LOCK is
  // counted, and the bound refuses the save. Watched failing on
  // postgres:17-alpine with the timeouts set by `select set_config(…)`,
  // which takes the snapshot before the LOCK: "expected 'saved' to be
  // 'child 0 count: held 4'".
  test("takes its snapshot after the save's LOCK", async () => {
    const repeatable = postgres(fixture.admin, { onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    try {
      const adapter = createPostgresRecords(repeatable)
      const id = await order(1, [], [1, 2])
      const plan = await plannedSave(adapter, forms.orders, [forms.marks], await body(id, [create('b', { mark_no: 4 })], {}, 'saved-mark'), DEADLINE)
      const outcome = await owner.begin(async (tx) => {
        await tx`lock table parity.saved_mark in share mode`
        await tx`insert into parity.saved_mark (order_id, mark_no) values (${id}, 3)`
        const pending = adapter.save(plan.request)
        await blocked(1)
        return { pending }
      })
      expect(saveAnswer(await outcome.pending)).toBe('child 0 count: held 4')
      expect((await stored(id)).marks).toEqual([1, 2, 3])
    } finally {
      await repeatable.end()
    }
  })
})
