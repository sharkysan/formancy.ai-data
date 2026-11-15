import {
  generateForm,
  planBrowse,
  planCreate,
  planDelete,
  planRead,
  planSupersede,
  planUpdate,
  recordToken,
  REFUSAL_PREFIX,
  toFormAnswers,
} from '@formancy/data-core'
import type {
  DeleteOutcome,
  DescribedTable,
  FormBindings,
  FormPolicy,
  FormRecord,
  MetadataSnapshot,
  PolicyContext,
  RecordAdapter,
  RecordOutcome,
} from '@formancy/data-core'
import {
  covers,
  DECLINE_PARITY,
  declineCase,
  DECLINING_MESSAGES,
  DECLINING_REMOVABLE,
  DECLINING_TABLE,
  defined,
  startPostgresFixture,
} from '@formancy/data-fixtures'
import type { DeclineAnswer, DeclineCase, PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A refusal the deployment words for the person (0156), and the class-42
 * error a trigger function raises, against REAL PostgreSQL.
 *
 * `declining.declining` is the table DECLINE_PARITY's cases are about, in
 * this engine's DDL: a BEFORE trigger raises, with RAISE EXCEPTION USING
 * MESSAGE (P0001), the message `declining.said` holds for the note a row is
 * written or deleted with. The SQL Server suite runs the same cases, each
 * declared with `covers()` (0035). Each request is the planner's, over
 * forms generated from what discovery reports as the owner, as the server
 * sends it, and the owner reads the table after: nothing is ever written.
 *
 * The rows the update, change and delete cases address are inserted before
 * the messages are, so the trigger let the owner insert a row noted `kept`
 * whose delete it then refuses.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let snapshot: MetadataSnapshot

const TABLE = DECLINING_TABLE
const CLARA: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: {} }
const RW = { read: ['clerk'], write: ['clerk'] }
const READS = { read: ['clerk'], write: [] }
const FIELDS = { item_no: RW, valid_from: RW, valid_to: READS, note: RW }
/** The table as a form of records, which a clerk creates and updates. */
const RECORDS_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: FIELDS,
  rowFilters: [],
  lookups: {},
}
/** The table as a form over versions (0113), which a clerk changes from a date. */
const VERSIONS_POLICY: FormPolicy = RECORDS_POLICY
/** The removable table's records, which a clerk deletes. */
const REMOVABLE_POLICY: FormPolicy = {
  ...RECORDS_POLICY,
  operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
  fields: { id: READS, note: READS },
}
let recordsForm: FormBindings
let versionsForm: FormBindings

/** The rows the cases that address a stored record address: each item's one open version. */
const STORED = { update: 2, supersede: 3 } as const
const REMOVABLE = DECLINING_REMOVABLE
let removableForm: FormBindings
/** The message the trigger with an ERRCODE of its own raises: a reason, prefixed, as a create noted `closed` meets it. */
const CLOSED_MESSAGE = `${REFUSAL_PREFIX}${DECLINE_PARITY.insert.answer.reason}`

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  // The DDL is this file's, and CLOSED_MESSAGE, from DECLINE_PARITY and
  // data-core's prefix, is spliced into it as a literal: refused here when it
  // holds a quote, which would end the literal early.
  if (CLOSED_MESSAGE.includes("'")) throw new Error(`a message spliced into the DDL holds a quote: ${CLOSED_MESSAGE}`)
  await owner.unsafe(`
    create schema declining;
    create table declining.said (note varchar(20) not null constraint pk_said primary key, message text not null);
    create table declining.declining (
      item_no int not null,
      valid_from date not null,
      valid_to date null,
      note varchar(20) null,
      version int not null default 1,
      constraint pk_declining primary key (item_no, valid_from)
    );
    create function declining.decline() returns trigger language plpgsql as $$
    declare
      said text;
    begin
      if tg_op = 'DELETE' then
        select s.message into said from declining.said as s where s.note = old.note;
      else
        select s.message into said from declining.said as s where s.note = new.note;
      end if;
      if said is not null then
        raise exception using message = said;
      end if;
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end
    $$;
    create trigger tr_declining before insert or update or delete on declining.declining for each row execute function declining.decline();
    create table declining.removable (
      id int generated always as identity constraint pk_removable primary key,
      note varchar(20) null,
      version int not null default 1
    );
    create trigger tr_removable before delete on declining.removable for each row execute function declining.decline();

    -- A view that raises a refusal worded for the person as it is read: a read's RAISE is never a person's reason.
    create function declining.peek(n varchar) returns varchar language plpgsql as $$
    declare
      said text;
    begin
      select s.message into said from declining.said as s where s.note = n;
      if said is not null then
        raise exception using message = said;
      end if;
      return n;
    end
    $$;
    create view declining.peeked as select item_no, valid_from, declining.peek(note) as note from declining.declining;

    -- Trigger functions whose own SQL is at fault: an ambiguous column (42702), which has no entry of its own, and a missing one (42703), which has.
    create table declining.ambiguous (id int not null constraint pk_ambiguous primary key, note varchar(20) null);
    create function declining.ambiguous_check() returns trigger language plpgsql as $$
    begin
      if new.note = 'ambiguous' then
        perform id from declining.ambiguous as a cross join declining.ambiguous as b;
      elsif new.note = 'missing' then
        perform no_such_column from declining.ambiguous;
      end if;
      return new;
    end
    $$;
    create trigger tr_ambiguous before insert on declining.ambiguous for each row execute function declining.ambiguous_check();

    -- A RAISE with an ERRCODE of its own and the prefix: a check violation (23514), whatever its message says.
    create table declining.coded (id int not null constraint pk_coded primary key, note varchar(20) null);
    create function declining.coded_check() returns trigger language plpgsql as $$
    begin
      raise exception using errcode = 'check_violation', message = '${CLOSED_MESSAGE}';
    end
    $$;
    create trigger tr_coded before insert on declining.coded for each row execute function declining.coded_check();`)
  for (const item of Object.values(STORED)) await owner`insert into declining.declining (item_no, valid_from, note) values (${item}, '2026-01-01', 'open')`
  await owner`insert into declining.removable (note) values (${DECLINE_PARITY.delete.note})`
  // A row of the view too, whose note's message it raises as it is read.
  await owner`insert into declining.declining (item_no, valid_from, note) values (4, '2026-01-01', 'kept')`
  for (const [note, message] of Object.entries(DECLINING_MESSAGES)) await owner`insert into declining.said (note, message) values (${note}, ${message})`
  snapshot = await discoverPostgres(owner, { schemas: ['declining'] })
  const request = { connection: 'test', root: TABLE, formId: 'declining', title: 'Declining', lookups: [], versionColumn: 'version' }
  recordsForm = generateForm(snapshot, request).bindings
  versionsForm = generateForm(snapshot, { ...request, formId: 'declining-versions', validity: { from: 'valid_from', to: 'valid_to' } }).bindings
  removableForm = generateForm(snapshot, { ...request, root: REMOVABLE, formId: 'removable' }).bindings
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

async function described(table: { schema: string; name: string } = TABLE): Promise<DescribedTable> {
  const found = await records.describe(table)
  if (!found.ok) throw new Error(`expected a description, got ${found.code}`)
  return found.described
}

function tokenOf(item: number): string {
  const token = recordToken(['item_no', 'valid_from'], { item_no: String(item), valid_from: '2026-01-01' })
  if (!token.ok) throw new Error(token.message)
  return token.token
}

/** The record as Clara reads it through the adapter, as the server reads it before a change. */
async function asRead(bindings: FormBindings, item: number): Promise<FormRecord> {
  const plan = planRead(snapshot, bindings, RECORDS_POLICY, CLARA, tokenOf(item))
  if (!plan.ok) throw new Error(`expected a read, got ${plan.code}`)
  const read = await records.read(plan.request)
  if (!read.ok || read.record === null) throw new Error('expected the record')
  return toFormAnswers(bindings, plan.fields, { ok: true, ...read.record })
}

/** One item's versions as the owner reads them, by start. */
const rowsOf = async (item: number) => [
  ...(await owner`select valid_from::text as "from", valid_to::text as "to", note, version from declining.declining where item_no = ${item} order by valid_from`),
]

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

/** A create of item `item` noted as `name`'s case is, as the server plans one; its answer, and what the table then holds of the item. */
async function created(name: DeclineCase, item: number) {
  const plan = planCreate(
    snapshot,
    recordsForm,
    RECORDS_POLICY,
    CLARA,
    { item_no: String(item), valid_from: '2026-01-01', note: DECLINE_PARITY[name].note },
    await described(),
  )
  if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
  return { answer: answerOf(await records.insert(plan.request)), rows: await rowsOf(item) }
}

describe('a refusal the deployment words for the person (DECLINE_PARITY)', () => {
  // The reason is the deployment's sentence, verbatim, for every write a
  // person makes: a create, an update, a change from a date and a delete.
  // Before 0156 each was `refused`, and the person read the server's
  // sentence; and a reason that was not exact -- trimmed, quoted, with the
  // prefix -- would be words the deployment did not write. Watched failing
  // with the P0001 reading taken out: refused, on every write.
  test(
    'a create, an update, a change from a date and a delete the trigger refuses are declined with its reason, and nothing is written',
    covers('postgres', declineCase('insert'), declineCase('update'), declineCase('supersede'), declineCase('delete')),
    async () => {
      expect(await created('insert', 1)).toEqual({ answer: DECLINE_PARITY.insert.answer, rows: [] })

      const update = planUpdate(
        snapshot,
        recordsForm,
        RECORDS_POLICY,
        CLARA,
        tokenOf(STORED.update),
        '1',
        { note: DECLINE_PARITY.update.note },
        await asRead(recordsForm, STORED.update),
        await described(),
      )
      if (!update.ok) throw new Error(`expected an update, got ${update.code}`)
      expect(answerOf(await records.update(update.request))).toEqual(DECLINE_PARITY.update.answer)
      expect(await rowsOf(STORED.update)).toEqual([{ from: '2026-01-01', to: null, note: 'open', version: 1 }])

      const change = planSupersede(
        snapshot,
        versionsForm,
        VERSIONS_POLICY,
        CLARA,
        tokenOf(STORED.supersede),
        '1',
        { valid_from: '2026-07-01', note: DECLINE_PARITY.supersede.note },
        await asRead(versionsForm, STORED.supersede),
        await described(),
      )
      if (!change.ok) throw new Error(`expected a change, got ${change.code}: ${change.message}`)
      expect(answerOf(await records.supersede(change.request))).toEqual(DECLINE_PARITY.supersede.answer)
      // The version it would have ended is still open: the statement ended nothing.
      expect(await rowsOf(STORED.supersede)).toEqual([{ from: '2026-01-01', to: null, note: 'open', version: 1 }])

      const removal = planDelete(snapshot, removableForm, REMOVABLE_POLICY, CLARA, 'k1:1', '1', await described(REMOVABLE))
      if (!removal.ok) throw new Error(`expected a delete, got ${removal.code}: ${removal.message}`)
      expect(answerOf(await records.delete(removal.request))).toEqual(DECLINE_PARITY.delete.answer)
      expect([...(await owner`select id, note, version from declining.removable`)]).toEqual([{ id: 1, note: 'kept', version: 1 }])
    },
  )

  // `formancy: refused [note]: ` names the column, so the server can put the
  // reason beside the field bound to it. Watched failing with the bracket
  // left unread: the whole message after the prefix was none, refused.
  test('a refusal that names a column is declined with the column and the reason after it', covers('postgres', declineCase('column')), async () => {
    expect(await created('column', 5)).toEqual({ answer: DECLINE_PARITY.column.answer, rows: [] })
  })

  // Nothing changes for a trigger written before 0156: its RAISE, whatever
  // it says, is the server's sentence, as REFUSAL_PARITY's guardedInsert
  // is. Watched failing with every P0001 message passed on: declined.
  test('the same reason without the prefix is refused, as every RAISE was', covers('postgres', declineCase('unprefixed')), async () => {
    expect(await created('unprefixed', 6)).toEqual({ answer: DECLINE_PARITY.unprefixed.answer, rows: [] })
  })

  // Fail closed on shape (0156): a line break would break the line it is
  // shown on, and a message longer than SQL Server carries uncut is
  // refused on both engines alike, so a deployment's sentence reaches a
  // person the same way whichever engine it runs on. The longest one passed
  // on arrives whole. PostgreSQL carries all three whole; the bound is the
  // module's. Watched failing with the length left unchecked: overlong and
  // cut declined; and with the control check taken out: control declined.
  test(
    'a reason with a control character, or longer than SQL Server carries uncut, is refused; the longest is declined whole',
    covers('postgres', declineCase('control'), declineCase('longest'), declineCase('overlong'), declineCase('cut')),
    async () => {
      expect(await created('control', 7)).toEqual({ answer: DECLINE_PARITY.control.answer, rows: [] })
      expect(await created('longest', 8)).toEqual({ answer: DECLINE_PARITY.longest.answer, rows: [] })
      expect(await created('overlong', 9)).toEqual({ answer: DECLINE_PARITY.overlong.answer, rows: [] })
      expect(await created('cut', 10)).toEqual({ answer: DECLINE_PARITY.cut.answer, rows: [] })
    },
  )
})

describe('a refusal worded for the person is only ever a write’s', () => {
  // A view whose function RAISEs the prefix as it is read: a read refused
  // in words for the person would put them in front of whoever browses, and
  // a browse answers no `declined` (admin-browse.ts throws on one, a 500).
  // Watched failing with the phase left unasked: declined.
  test('a read whose function raises the prefix is refused', async () => {
    const plan = planBrowse(snapshot, { object: { schema: 'declining', name: 'peeked' }, equal: [], filter: [], search: '', sort: [], offset: 0, limit: 50 })
    if (!plan.ok) throw new Error(`expected a browse, got ${plan.code}: ${plan.message}`)
    const outcome = await records.list(plan.request)
    expect(outcome).toMatchObject({ ok: false, code: 'refused' })
    expect(outcome).not.toHaveProperty('reason')
  })
})

describe('only RAISE EXCEPTION’s own SQLSTATE carries a reason (0156)', () => {
  // A RAISE that names an ERRCODE of its own says what was refused in that
  // code: a check violation is `check-violation`, prefix or not, as it was
  // before 0156, and no reason is read from its message. Read under any
  // SQLSTATE, the prefix would turn a constraint's answer into words the
  // person reads, and a check named in class 23 into no check at all.
  // Watched failing with the P0001 condition taken out of `raised`:
  // declined, with the reason.
  test('a RAISE with an ERRCODE of its own and the prefix keeps that code’s meaning', async () => {
    const outcome = await defined(records).insert({
      target: { table: { schema: 'declining', name: 'coded' }, identity: [{ name: 'id', type: columnType('coded', 'id') }], concurrency: null },
      values: [
        { name: 'id', type: columnType('coded', 'id'), value: '1' },
        { name: 'note', type: columnType('coded', 'note'), value: 'closed' },
      ],
      returning: [],
    })
    expect(outcome).toMatchObject({ ok: false, code: 'check-violation', message: expect.stringMatching(/23514/) })
    expect(outcome).not.toHaveProperty('reason')
    expect([...(await owner`select id from declining.coded`)]).toEqual([])
  })
})

describe('a class-42 error a trigger function raises (0156)', () => {
  const insert = (id: string, note: string) =>
    defined(records).insert({
      target: { table: { schema: 'declining', name: 'ambiguous' }, identity: [{ name: 'id', type: columnType('ambiguous', 'id') }], concurrency: null },
      values: [
        { name: 'id', type: columnType('ambiguous', 'id'), value: id },
        { name: 'note', type: columnType('ambiguous', 'note'), value: note },
      ],
      returning: [],
    })

  // A trigger function's ambiguous column was thrown as this adapter's own
  // SQL at fault: a 500, which data-client reads as "it may have been
  // saved" over a write PostgreSQL certainly rolled back. It is the
  // deployment's SQL, refused. A class-42 code with an entry of its own
  // keeps it inside a trigger too, so no other trigger's answer changes.
  // Watched failing with the context left unread: the insert threw 42702.
  test('an ambiguous column inside a trigger is refused, never thrown; a missing one is still schema-changed', async () => {
    const ambiguous = await insert('1', 'ambiguous')
    expect(ambiguous).toMatchObject({ ok: false, code: 'refused', message: expect.stringMatching(/42702/) })
    expect(await insert('2', 'missing')).toMatchObject({ ok: false, code: 'schema-changed' })
    expect([...(await owner`select id from declining.ambiguous`)]).toEqual([])
  })
})

/** A column's type in a table of the declining schema, as discovery read it. */
function columnType(table: string, name: string) {
  const found = snapshot.objects
    .find((object) => object.ref.schema === 'declining' && object.ref.name === table)
    ?.columns.find((column) => column.name === name)
  if (found === undefined) throw new Error(`declining.${table} has no ${name}`)
  return found.type
}
