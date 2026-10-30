import { findObject, generateForm, planDelete, planUpdate } from '@formancy/data-core'
import type { DeleteOutcome, DeleteRequest, FormBindings, FormPolicy, MetadataSnapshot, PolicyContext, RecordAdapter, RecordColumn } from '@formancy/data-core'
import {
  covers,
  deleteAnswer,
  deleteCase,
  PARITY_SCOPE,
  startPostgresFixture,
  UPDATE_RECREATED,
  UPDATE_RECREATED_CASE,
  versionFact,
} from '@formancy/data-fixtures'
import type { DeleteAnswer, DeleteCase, PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql, TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * Deleting one record (0050) against REAL PostgreSQL loaded with the shared
 * fixture's parity schema (0028). Each case's answer is written once in
 * `@formancy/data-fixtures` (`DELETE_PARITY`) and the SQL Server suite runs
 * the same cases, each declared with `covers()` (0035).
 *
 * The requests are the planner's, from bindings generated over what
 * discovery reports as the owner, decided over the table as `describe`
 * reads it just before, as the server sends them; but `not-a-key`, whose
 * identity only a hand-made request can name. The owner inserts every row a
 * case deletes, and reads what is left.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let parity: MetadataSnapshot

const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
const READS = { read: ['clerk'], write: [] }
const clerk = (attributes: Record<string, string>): PolicyContext => ({ actor: { id: 'u-1', roles: ['clerk'] }, attributes })
const CLARA = clerk({ tenant: '1' })

/** Clerks read and delete, within their tenant where the table has one. */
function deleting(fields: readonly string[], extra: Partial<FormPolicy> = {}): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
    fields: Object.fromEntries(fields.map((field) => [field, READS])),
    rowFilters: [],
    lookups: {},
    ...extra,
  }
}

const POLICIES = {
  removable: deleting(['id', 'tenant_id', 'note'], { rowFilters: TENANT }),
  removable_child: deleting(['id', 'removable', 'note'], { lookups: { removable: TENANT }, through: ['removable'] }),
  removable_self: deleting(['id', 'parent_id']),
  removable_triggered: deleting(['id', 'note']),
  removable_declined: deleting(['id', 'note']),
  removable_ruled: deleting(['id', 'note']),
} as const satisfies Record<string, FormPolicy>
type Table = keyof typeof POLICIES

const forms = new Map<Table, FormBindings>()

function form(table: Table): FormBindings {
  const found = forms.get(table)
  if (found === undefined) throw new Error(`no form over parity.${table}`)
  return found
}

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  parity = await discoverPostgres(owner, PARITY_SCOPE)
  for (const table of Object.keys(POLICIES) as Table[]) {
    const lookups = table === 'removable_child' ? [{ foreignKey: 'fk_removable_child_removable', display: ['note'] }] : []
    forms.set(
      table,
      generateForm(parity, {
        connection: 'test',
        root: { schema: 'parity', name: table },
        formId: table.replaceAll('_', '-'),
        title: table,
        lookups,
        versionColumn: 'version',
      }).bindings,
    )
  }
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

/** A delete planned as the server plans one: over the table as `describe` reads it now, through `via`. */
async function planned(table: Table, actor: PolicyContext, token: string, version: string, via: RecordAdapter = records): Promise<DeleteRequest> {
  const described = await via.describe({ schema: 'parity', name: table })
  if (!described.ok) throw new Error(`expected a description, got ${described.code}: ${described.message}`)
  const plan = planDelete(parity, form(table), POLICIES[table], actor, token, version, described.described)
  if (!plan.ok) throw new Error(`expected a delete, got ${plan.code}: ${plan.message}`)
  return plan.request
}

/** What a delete answered, as DELETE_PARITY names it. */
function answer(outcome: DeleteOutcome): DeleteAnswer {
  return outcome.ok ? 'deleted' : outcome.code
}

const expected = (name: DeleteCase): DeleteAnswer => deleteAnswer(name, 'postgres')

/** A row inserted as the owner, by its columns, returning its id. */
async function inserted(table: string, values: Record<string, string | number | null>): Promise<string> {
  const names = Object.keys(values)
  const [row] = await owner.unsafe<Array<{ id: string }>>(
    `insert into parity.${table} (${names.join(', ')}) values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id::text as id`,
    Object.values(values),
  )
  if (row === undefined) throw new Error(`nothing inserted into parity.${table}`)
  return row.id
}

/** The row's version as the owner reads it, or null when it is gone. */
async function versionOf(table: string, id: string): Promise<string | null> {
  const [row] = await owner.unsafe<Array<{ version: string }>>(`select version::text as version from parity.${table} where id = $1`, [id])
  return row?.version ?? null
}

/** Waits until another backend waits for a lock, so a race is a race and not a sequence. */
async function waitUntilBlocked(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`
    if ((row?.n ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('the delete never queued behind the held lock')
}

/** `pending`, started while another transaction has done `hold` and not committed, answered after it commits. */
async function racedWith(hold: (tx: TransactionSql) => Promise<unknown>, pending: () => Promise<DeleteOutcome>): Promise<DeleteOutcome> {
  const held = await owner.begin(async (tx) => {
    await hold(tx)
    const answer = pending()
    await waitUntilBlocked()
    return { answer }
  })
  return held.answer
}

/** A connection as a role of its own, made by the owner for one case. */
async function asRole(role: string, grants: readonly string[]): Promise<Sql> {
  await owner.unsafe(`create role ${role} login password 'role-fixture-password'`)
  for (const grant of [`grant usage on schema parity to ${role}`, ...grants]) await owner.unsafe(grant)
  const url = new URL(fixture.admin)
  url.username = role
  url.password = 'role-fixture-password'
  return postgres(url.toString(), { onnotice: () => {} })
}

describe('a delete of one record', () => {
  // The record named by its token, at the version its person read, is
  // deleted -- and the answer is its key as the statement deleted it, and
  // the version it had, never another column.
  test('deleted: the row at the version read is deleted, and the answer is its key and version', covers('postgres', deleteCase('deleted')), async () => {
    const id = await inserted('removable', { tenant_id: 1, note: 'deleted' })
    const outcome = await records.delete(await planned('removable', CLARA, `k1:${id}`, '1'))
    expect(answer(outcome)).toBe(expected('deleted'))
    expect(outcome).toEqual({ ok: true, deleted: { values: { id }, version: '1' } })
    expect(await versionOf('removable', id)).toBeNull()
  })

  // A person deletes the record they saw. Changed since, it is not that
  // record any more, and nothing is deleted (watched failing with the
  // version left out of the WHERE: the changed row was deleted).
  test('stale: a row changed since it was read is not deleted', covers('postgres', deleteCase('stale')), async () => {
    const id = await inserted('removable', { tenant_id: 1, note: 'stale' })
    const request = await planned('removable', CLARA, `k1:${id}`, '1')
    await owner.unsafe('update parity.removable set version = version + 1 where id = $1', [id])
    expect(answer(await records.delete(request))).toBe(expected('stale'))
    expect(await versionOf('removable', id)).toBe('2')
  })

  // A key no row has is not found, never stale: a follow-up that did not
  // ask whether the row exists would send the person to reload a record
  // that is not there.
  test('not-found: a key no row has', covers('postgres', deleteCase('not-found')), async () => {
    expect(answer(await records.delete(await planned('removable', CLARA, 'k1:2147483000', '1')))).toBe(expected('not-found'))
  })

  // Another tenant's row is not found, with its true version in hand, and
  // stays: the filter is in the delete's WHERE (watched failing with the
  // filters left out: tenant 2's row was deleted).
  test("other-tenant: another tenant's row is not found, and stays", covers('postgres', deleteCase('other-tenant')), async () => {
    const id = await inserted('removable', { tenant_id: 2, note: 'theirs' })
    expect(answer(await records.delete(await planned('removable', CLARA, `k1:${id}`, '1')))).toBe(expected('other-tenant'))
    expect(await versionOf('removable', id)).toBe('1')
  })

  // A child has no tenant of its own: it exists for a delete only through a
  // parent the tenant may reference (0043).
  test("through: a child of another tenant's parent is not found and stays; one of ours is deleted", covers('postgres', deleteCase('through')), async () => {
    const theirs = await inserted('removable_child', { removable_id: await inserted('removable', { tenant_id: 2, note: 'parent' }), note: 'theirs' })
    expect(answer(await records.delete(await planned('removable_child', CLARA, `k1:${theirs}`, '1')))).toBe(expected('through'))
    expect(await versionOf('removable_child', theirs)).toBe('1')
    const ours = await inserted('removable_child', { removable_id: await inserted('removable', { tenant_id: 1, note: 'parent' }), note: 'ours' })
    expect(answer(await records.delete(await planned('removable_child', CLARA, `k1:${ours}`, '1')))).toBe('deleted')
  })

  // The engines differ here as they do for an update (0043): the parent is
  // read from the statement's snapshot, so a delete that waited for the
  // child's row lands after its parent left the tenant.
  test('moved-parent: a child whose parent moves to another tenant while the delete waits', covers('postgres', deleteCase('moved-parent')), async () => {
    const parent = await inserted('removable', { tenant_id: 1, note: 'moving' })
    const child = await inserted('removable_child', { removable_id: parent, note: 'waits' })
    const request = await planned('removable_child', CLARA, `k1:${child}`, '1')
    const outcome = await racedWith(
      async (tx) => {
        await tx.unsafe('select from parity.removable_child where id = $1 for update', [child])
        await tx.unsafe('update parity.removable set tenant_id = 2 where id = $1', [parent])
      },
      () => records.delete(request),
    )
    expect(answer(outcome)).toBe(expected('moved-parent'))
  })

  // Under REPEATABLE READ, on the locked path, PostgreSQL answers a delete
  // that waited for a row another transaction updated with 40001, not with
  // no row (0006): nothing was deleted, and it is a race whatever the
  // version reads now, so stale -- never `unavailable`, which class 40 is
  // elsewhere. A version no write could have made is answered as any
  // mismatch, and never sent.
  test('a delete that lost a race under repeatable read is stale, and a version that is no number is not sent', async () => {
    const sql = postgres(fixture.admin, { onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    try {
      const via = createPostgresRecords(sql)
      const id = await inserted('removable', { tenant_id: 1, note: 'raced' })
      const request = await planned('removable', CLARA, `k1:${id}`, '1', via)
      const outcome = await racedWith(
        (tx) => tx.unsafe('update parity.removable set version = version + 1 where id = $1', [id]),
        () => via.delete(request),
      )
      expect(outcome).toMatchObject({ ok: false, code: 'stale' })
      expect(await via.delete({ ...request, expectedVersion: 'not a number' })).toMatchObject({ ok: false, code: 'stale' })
      expect(await versionOf('removable', id)).toBe('2')
    } finally {
      await sql.end()
    }
  })

  // A key the database numbers is never handed out again, so a row created
  // after the delete is never the deleted one's: its old token is not found.
  test('recreated: the token of a row deleted is not found, though another row was created since', covers('postgres', deleteCase('recreated')), async () => {
    const id = await inserted('removable', { tenant_id: 1, note: 'first' })
    const request = await planned('removable', CLARA, `k1:${id}`, '1')
    await owner.unsafe('delete from parity.removable where id = $1', [id])
    const again = await inserted('removable', { tenant_id: 1, note: 'first' })
    expect(again).not.toBe(id)
    expect(answer(await records.delete(request))).toBe(expected('recreated'))
    expect(await versionOf('removable', again)).toBe('1')
  })
})

describe('what the database keeps', () => {
  // A NO ACTION key's row still refers to it: the database keeps it, and
  // says which key (watched failing with 23503 unmapped: check-violation,
  // class 23's default, which sends a person to the wrong rule).
  test('referenced: a row a NO ACTION key still refers to stays', covers('postgres', deleteCase('referenced')), async () => {
    const parent = await inserted('removable', { tenant_id: 1, note: 'referred to' })
    await inserted('removable_child', { removable_id: parent, note: 'refers' })
    const outcome = await records.delete(await planned('removable', CLARA, `k1:${parent}`, '1'))
    expect(answer(outcome)).toBe(expected('referenced'))
    expect(outcome).toMatchObject({ constraint: 'fk_removable_child_removable' })
    expect(await versionOf('removable', parent)).toBe('1')
  })

  // ON DELETE RESTRICT is refused as NO ACTION is: foreign-key-violation,
  // the key named, which the server answers `referenced`. Its SQLSTATE is
  // 23503 on 15 to 17, as NO ACTION's (measured, P3), and 23001,
  // restrict_violation, on 18 (VERSION_FACTS.restrictViolation; watched
  // failing on 18 while this asserted 23503 there, and with 23001 left out
  // of the adapter's map: check-violation, class 23's default, which the
  // server answers `refused`).
  test('restrict: a row a RESTRICT key refers to stays, refused as NO ACTION is', covers('postgres', deleteCase('restrict')), async () => {
    const parent = await inserted('removable', { tenant_id: 1, note: 'restricted' })
    await owner.unsafe('insert into parity.removable_restrict (removable_id) values ($1)', [parent])
    const outcome = await records.delete(await planned('removable', CLARA, `k1:${parent}`, '1'))
    expect(answer(outcome)).toBe(expected('restrict'))
    const state = versionFact('restrictViolation', fixture.server) ? '23001' : '23503'
    expect(outcome).toMatchObject({
      constraint: 'fk_removable_restrict_removable',
      message: `PostgreSQL refused the statement with SQLSTATE ${state} on constraint fk_removable_restrict_removable.`,
    })
    expect(await versionOf('removable', parent)).toBe('1')
  })

  // A key onto the row's own table refuses as any other key does, 23503
  // with the key named: unmapped, it would be check-violation, class 23's
  // default, as for `referenced`.
  test('self-reference: a row another row of its table refers to stays', covers('postgres', deleteCase('self-reference')), async () => {
    const parent = await inserted('removable_self', { parent_id: null })
    await inserted('removable_self', { parent_id: parent })
    expect(answer(await records.delete(await planned('removable_self', CLARA, `k1:${parent}`, '1')))).toBe(expected('self-reference'))
    expect(await versionOf('removable_self', parent)).toBe('1')
  })
})

describe('what the database runs on a delete', () => {
  // A BEFORE DELETE trigger that returns NULL deletes nothing and says
  // nothing; found at the version sent, the row was declined, not changed
  // (watched failing with the follow-up's version left out: answered stale).
  test('declined: a trigger that declines the delete keeps the row, and is refused', covers('postgres', deleteCase('declined')), async () => {
    const id = await inserted('removable_declined', { note: 'declined' })
    expect(answer(await records.delete(await planned('removable_declined', CLARA, `k1:${id}`, '1')))).toBe(expected('declined'))
    expect(await versionOf('removable_declined', id)).toBe('1')
  })

  // A trigger's RAISE fails the statement: the row stays, and the answer is
  // a refusal, never a deletion reported done or a retry invited.
  test("trigger-refuses: a trigger's error keeps the row", covers('postgres', deleteCase('trigger-refuses')), async () => {
    const id = await inserted('removable_triggered', { note: 'refuse' })
    expect(answer(await records.delete(await planned('removable_triggered', CLARA, `k1:${id}`, '1')))).toBe(expected('trigger-refuses'))
    expect(await versionOf('removable_triggered', id)).toBe('1')
  })

  // Triggers are the database's (0050): one that inserts the row again is
  // run, and the delete is reported done -- the statement deleted the row.
  test('restoring: a row an AFTER DELETE trigger inserts again is reported deleted, and is there', covers('postgres', deleteCase('restoring')), async () => {
    const id = await inserted('removable_triggered', { note: 'restore' })
    expect(answer(await records.delete(await planned('removable_triggered', CLARA, `k1:${id}`, '1')))).toBe(expected('restoring'))
    expect(await versionOf('removable_triggered', id)).toBe('1')
  })

  // A trigger that writes another table runs with the delete, and the
  // delete is answered done: a guard that refused every table with a DELETE
  // trigger would refuse the audit triggers a deployment keeps (0050).
  test(
    'after-trigger-elsewhere: a row an AFTER DELETE trigger writes elsewhere is there',
    covers('postgres', deleteCase('after-trigger-elsewhere')),
    async () => {
      const id = await inserted('removable_triggered', { note: 'log' })
      expect(answer(await records.delete(await planned('removable_triggered', CLARA, `k1:${id}`, '1')))).toBe(expected('after-trigger-elsewhere'))
      expect(await versionOf('removable_triggered', id)).toBeNull()
      expect([...(await owner.unsafe('select note from parity.removable_log where id = $1', [id]))]).toEqual([{ note: 'log' }])
    },
  )

  // PostgreSQL only: SQL Server has no rules. A data-modifying statement in
  // WITH is refused on a table a DO ALSO rule acts on (0A000, measured,
  // P4), so the delete is refused and the rule never runs: not the
  // characterisation 0050's design expected, which was the rule run unseen.
  test('a DO ALSO rule refuses the delete, and nothing is deleted or logged', async () => {
    const id = await inserted('removable_ruled', { note: 'ruled' })
    const outcome = await records.delete(await planned('removable_ruled', CLARA, `k1:${id}`, '1'))
    expect(outcome).toMatchObject({ ok: false, code: 'refused', message: expect.stringMatching(/0A000/) })
    expect(await versionOf('removable_ruled', id)).toBe('1')
    expect([...(await owner.unsafe('select note from parity.removable_log where id = $1', [id]))]).toEqual([])
  })

  // The one rule PostgreSQL runs inside the delete's CTE: an unconditional
  // DO INSTEAD rule with RETURNING, here a soft delete. Its action runs in
  // the delete's place, under the delete's WHERE, and what it returns is
  // read as the row deleted: answered done, the row still there. So the
  // statement refuses a table any rule acts on a delete of, as SQL Server's
  // batch refuses an INSTEAD OF trigger, and the follow-up says why.
  test('a DO INSTEAD rule that returns a row is refused, and nothing is deleted or changed', async () => {
    await owner.unsafe(`create table parity.removable_soft (id int generated always as identity constraint pk_removable_soft primary key, note varchar(50), version int not null default 1, gone boolean not null default false);
      create rule removable_soft_delete as on delete to parity.removable_soft do instead
        update parity.removable_soft set gone = true where id = old.id
        returning removable_soft.id, removable_soft.note, removable_soft.version, removable_soft.gone`)
    try {
      const snapshot = await discoverPostgres(owner, PARITY_SCOPE)
      const bindings = generateForm(snapshot, {
        connection: 'test',
        root: { schema: 'parity', name: 'removable_soft' },
        formId: 'removable-soft',
        title: 'Soft',
        lookups: [],
        versionColumn: 'version',
      }).bindings
      expect(bindings.operations.delete).toBe(true)
      const id = await inserted('removable_soft', { note: 'soft' })
      const described = await records.describe({ schema: 'parity', name: 'removable_soft' })
      if (!described.ok) throw new Error(described.message)
      const plan = planDelete(snapshot, bindings, deleting(['id', 'note', 'gone']), CLARA, `k1:${id}`, '1', described.described)
      if (!plan.ok) throw new Error(plan.message)
      expect(await records.delete(plan.request)).toMatchObject({ ok: false, code: 'refused', message: expect.stringMatching(/rule/) })
      expect([...(await owner.unsafe('select gone, version::text as version from parity.removable_soft where id = $1', [id]))]).toEqual([
        { gone: false, version: '1' },
      ])
    } finally {
      await owner.unsafe('drop table parity.removable_soft')
    }
  })
})

describe("the account's grants and row security", () => {
  // The account's own grants are the database's to refuse: without DELETE
  // the statement is 42501, permission-denied, and nothing is deleted -- a
  // delete sent as another account than the connection's would pass.
  test('permission: an account without DELETE is refused, and the row stays', covers('postgres', deleteCase('permission')), async () => {
    const sql = await asRole('no_deleter', ['grant select on parity.removable to no_deleter'])
    try {
      const id = await inserted('removable', { tenant_id: 1, note: 'kept' })
      const via = createPostgresRecords(sql)
      expect(answer(await via.delete(await planned('removable', CLARA, `k1:${id}`, '1', via)))).toBe(expected('permission'))
      expect(await versionOf('removable', id)).toBe('1')
    } finally {
      await sql.end()
    }
  })

  // A DELETE policy stricter than the SELECT one: the row is read, and the
  // delete deletes nothing without an error; found at the version sent, it
  // was declined -- refused. SQL Server's block predicate refuses with 33504
  // instead, permission-denied: 0016's difference, written down in each adapter.
  test('row-security: a row a policy lets the account read and not delete stays', covers('postgres', deleteCase('row-security')), async () => {
    await owner.unsafe('alter table parity.removable_self enable row level security')
    await owner.unsafe('create policy removable_self_read on parity.removable_self for select using (true)')
    await owner.unsafe('create policy removable_self_delete on parity.removable_self for delete using (parent_id is not null)')
    const sql = await asRole('policed_deleter', ['grant select, delete on parity.removable_self to policed_deleter'])
    try {
      const id = await inserted('removable_self', { parent_id: null })
      const via = createPostgresRecords(sql)
      expect(answer(await via.delete(await planned('removable_self', CLARA, `k1:${id}`, '1', via)))).toBe(expected('row-security'))
      expect(await versionOf('removable_self', id)).toBe('1')
    } finally {
      await sql.end()
      await owner.unsafe('alter table parity.removable_self disable row level security')
    }
  })
})

describe('what moved since the delete was decided', () => {
  // A delete decided over the table as it was runs only while it still is (0041).
  test('definition-moved: a delete decided before an ALTER deletes nothing', covers('postgres', deleteCase('definition-moved')), async () => {
    const id = await inserted('removable_triggered', { note: 'altered' })
    const request = await planned('removable_triggered', CLARA, `k1:${id}`, '1')
    await owner.unsafe('alter table parity.removable_triggered add column extra integer')
    try {
      expect(answer(await records.delete(request))).toBe(expected('definition-moved'))
      expect(await versionOf('removable_triggered', id)).toBe('1')
    } finally {
      await owner.unsafe('alter table parity.removable_triggered drop column extra')
    }
  })

  // A key that cascades onto the table, added after the delete was decided
  // -- committed before it ran, and while it waited for its lock -- would
  // delete rows no form governs. The statement's guard refuses it and
  // nothing is deleted, the referring row included (watched failing with
  // the reach guard removed: the row and its copy were both deleted).
  test('reach-moved: a cascading key added before the delete, or while it waits, deletes nothing', covers('postgres', deleteCase('reach-moved')), async () => {
    await owner.unsafe('create table parity.removable_copy (removable_id int not null)')
    try {
      const before = await inserted('removable', { tenant_id: 1, note: 'reached' })
      const request = await planned('removable', CLARA, `k1:${before}`, '1')
      await owner.unsafe('insert into parity.removable_copy values ($1)', [before])
      await owner.unsafe(
        'alter table parity.removable_copy add constraint fk_removable_copy foreign key (removable_id) references parity.removable (id) on delete cascade',
      )
      expect(answer(await records.delete(request))).toBe(expected('reach-moved'))
      expect(await versionOf('removable', before)).toBe('1')
      await owner.unsafe('alter table parity.removable_copy drop constraint fk_removable_copy')

      const waiting = await inserted('removable', { tenant_id: 1, note: 'reached while waiting' })
      await owner.unsafe('insert into parity.removable_copy values ($1)', [waiting])
      const late = await planned('removable', CLARA, `k1:${waiting}`, '1')
      const outcome = await racedWith(
        (tx) =>
          tx.unsafe(
            'alter table parity.removable_copy add constraint fk_removable_copy foreign key (removable_id) references parity.removable (id) on delete cascade',
          ),
        () => records.delete(late),
      )
      expect(answer(outcome)).toBe(expected('reach-moved'))
      expect(await versionOf('removable', waiting)).toBe('1')
      expect([...(await owner.unsafe('select count(*)::int as n from parity.removable_copy'))]).toEqual([{ n: 2 }])
    } finally {
      await owner.unsafe('drop table parity.removable_copy')
    }
  })

  // What a delete from a partitioned table removes is in its partitions, and
  // a key declared onto one partition acts on the rows a delete from the
  // parent removes there (0049, P2b). Such a key added after the delete was
  // decided is refused as one onto the table itself, and nothing is deleted
  // (watched failing with the guard reading the table alone: the row and its
  // copy were deleted). Added while the delete waits, on both of 0041's
  // paths: an ALTER onto a partition locks the partition, not the table, and
  // under REPEATABLE READ the statement takes its snapshot before it locks
  // the partitions it plans, so the locked path locks the table with every
  // relation below it first (watched failing with the table locked alone:
  // under repeatable read the delete was answered done, and the cascade
  // deleted the copy through a key the guard's snapshot did not hold).
  test('a cascading key onto a partition of the table, added before the delete or while it waits on either path, deletes nothing', async () => {
    await owner.unsafe(`create table parity.parted (id int generated always as identity, tenant_id int not null, note varchar(50), version int not null default 1, constraint pk_parted primary key (id, tenant_id)) partition by list (tenant_id);
      create table parity.parted_one partition of parity.parted for values in (1);
      create table parity.parted_copy (id int not null, tenant_id int not null)`)
    const counts = async () => [
      ...(await owner.unsafe('select (select count(*)::int from parity.parted) as rows, (select count(*)::int from parity.parted_copy) as copies')),
    ]
    const addKey =
      'alter table parity.parted_copy add constraint fk_parted_copy foreign key (id, tenant_id) references parity.parted_one (id, tenant_id) on delete cascade'
    try {
      const snapshot = await discoverPostgres(owner, PARITY_SCOPE)
      const bindings = generateForm(snapshot, {
        connection: 'test',
        root: { schema: 'parity', name: 'parted' },
        formId: 'parted',
        title: 'Parted',
        lookups: [],
        versionColumn: 'version',
      }).bindings
      expect(bindings.operations.delete).toBe(true)
      /** A row and the copy that refers to it, and a delete of the row planned through `via`. */
      const staged = async (via: RecordAdapter): Promise<DeleteRequest> => {
        const [row] = await owner<Array<{ id: string }>>`insert into parity.parted (tenant_id, note) values (1, 'parted') returning id::text as id`
        const id = row?.id ?? ''
        await owner.unsafe('insert into parity.parted_copy values ($1, 1)', [id])
        const described = await via.describe({ schema: 'parity', name: 'parted' })
        if (!described.ok) throw new Error(described.message)
        const plan = planDelete(
          snapshot,
          bindings,
          deleting(['id', 'tenant_id', 'note'], { rowFilters: TENANT }),
          CLARA,
          `k1:${id},1`,
          '1',
          described.described,
        )
        if (!plan.ok) throw new Error(plan.message)
        return plan.request
      }
      const before = await staged(records)
      await owner.unsafe(addKey)
      expect(await records.delete(before)).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringMatching(/foreign key now acts/) })
      expect(await counts()).toEqual([{ rows: 1, copies: 1 }])
      await owner.unsafe('alter table parity.parted_copy drop constraint fk_parted_copy')

      for (const isolation of ['read committed', 'repeatable read'] as const) {
        const sql = postgres(fixture.admin, { onnotice: () => {}, connection: { default_transaction_isolation: isolation } })
        try {
          const via = createPostgresRecords(sql)
          const late = await staged(via)
          const staging = await counts()
          const outcome = await racedWith(
            (tx) => tx.unsafe(addKey),
            () => via.delete(late),
          )
          expect(outcome, isolation).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringMatching(/foreign key now acts/) })
          expect(await counts(), isolation).toEqual(staging)
        } finally {
          await sql.end()
          await owner.unsafe('alter table parity.parted_copy drop constraint if exists fk_parted_copy')
        }
      }
    } finally {
      await owner.unsafe('drop table parity.parted_copy; drop table parity.parted')
    }
  })

  // PostgreSQL's catalog hides no key from any role (0049, P2): an account
  // with no USAGE on the schema a cascading key is declared in still sees
  // it, and the guard refuses the delete. SQL Server's account that lost
  // VIEW DEFINITION is refused for that alone; either way nothing is deleted.
  test(
    'visibility-narrowed: a cascading key from a schema the account cannot use is seen, and deletes nothing',
    covers('postgres', deleteCase('visibility-narrowed')),
    async () => {
      const sql = await asRole('narrowed_deleter', ['grant select, delete on parity.removable to narrowed_deleter'])
      await owner.unsafe('create schema hidden')
      try {
        const id = await inserted('removable', { tenant_id: 1, note: 'out of sight' })
        const via = createPostgresRecords(sql)
        const request = await planned('removable', CLARA, `k1:${id}`, '1', via)
        await owner.unsafe('create table hidden.copy (removable_id int not null constraint fk_hidden_copy references parity.removable (id) on delete cascade)')
        await owner.unsafe('insert into hidden.copy values ($1)', [id])
        expect(answer(await via.delete(request))).toBe(expected('visibility-narrowed'))
        expect(await versionOf('removable', id)).toBe('1')
      } finally {
        await sql.end()
        await owner.unsafe('drop schema hidden cascade')
      }
    },
  )

  // Only a hand-made request names an identity two rows share: the
  // statement refuses its second row, and both are still there (watched
  // failing with the CTE's scalar subquery removed: both were deleted).
  test('not-a-key: an identity two rows share deletes nothing, and is thrown', covers('postgres', deleteCase('not-a-key')), async () => {
    await inserted('removable', { tenant_id: 9, note: 'twin' })
    await inserted('removable', { tenant_id: 9, note: 'twin' })
    const described = await records.describe({ schema: 'parity', name: 'removable' })
    if (!described.ok) throw new Error(described.message)
    const tenant = findObject(parity, { schema: 'parity', name: 'removable' })?.columns.find((candidate) => candidate.name === 'tenant_id') as RecordColumn
    const request: DeleteRequest = {
      target: {
        table: { schema: 'parity', name: 'removable' },
        identity: [{ name: 'tenant_id', type: tenant.type }],
        concurrency: { kind: 'version-column', column: 'version' },
      },
      key: [{ name: 'tenant_id', type: tenant.type, value: '9' }],
      expectedVersion: '1',
      filters: { kind: 'unrestricted' },
      through: [],
      reach: { removed: [{ schema: 'parity', name: 'removable' }], cleared: [], accepted: [] },
      definition: described.described.definition,
    }
    expect(expected('not-a-key')).toBe('thrown')
    await expect(records.delete(request)).rejects.toThrow(/more than one row/)
    expect([...(await owner.unsafe('select count(*)::int as n from parity.removable where tenant_id = 9'))]).toEqual([{ n: 2 }])
  })
})

describe('a version that cannot tell two records apart', () => {
  // Why no delete is offered where a key is typed (0050): another session
  // deletes the row and inserts its key again, and its version column
  // starts at its default -- the version the deleted row had. An update
  // sent with that version lands on the new record. Characterised, not
  // refused: it is the limitation a delete would make this module's own.
  test(
    'update: recreated: an update with the old version lands on a record created again under the key',
    covers('postgres', UPDATE_RECREATED_CASE),
    async () => {
      const keyed = generateForm(parity, {
        connection: 'test',
        root: { schema: 'parity', name: 'keyed' },
        formId: 'keyed',
        title: 'Keyed',
        lookups: [],
        versionColumn: 'version',
      }).bindings
      expect(keyed.operations).toMatchObject({ update: true, delete: false })
      const policy: FormPolicy = {
        version: 1,
        operations: { read: ['clerk'], create: [], update: ['clerk'] },
        fields: { code: READS, note: { read: ['clerk'], write: ['clerk'] } },
        rowFilters: [],
        lookups: {},
      }
      await owner.unsafe("insert into parity.keyed (code, note) values ('k', 'first')")
      const described = await records.describe({ schema: 'parity', name: 'keyed' })
      if (!described.ok) throw new Error(described.message)
      const plan = planUpdate(parity, keyed, policy, CLARA, 'k1:k', '1', { note: 'changed' }, undefined, described.described)
      if (!plan.ok) throw new Error(plan.message)
      await owner.unsafe("delete from parity.keyed where code = 'k'")
      await owner.unsafe("insert into parity.keyed (code, note) values ('k', 'second')")
      const outcome = await records.update(plan.request)
      expect(outcome.ok ? 'updated' : outcome.code).toBe(UPDATE_RECREATED)
      expect([...(await owner.unsafe("select note, version::text as version from parity.keyed where code = 'k'"))]).toEqual([{ note: 'changed', version: '2' }])
    },
  )
})
