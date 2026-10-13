import { generateForm, planDelete } from '@formancy/data-core'
import type { DeleteOutcome, DeleteRequest, FormBindings, FormPolicy, MetadataSnapshot, PolicyContext, RecordAdapter } from '@formancy/data-core'
import { cascadeAnswer, cascadeCase, covers, PARITY_CASCADES, PARITY_SCOPE, REACH_PRIVILEGE_LOSSES, startPostgresFixture } from '@formancy/data-fixtures'
import type { CascadeCase, DeleteAnswer, PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql, TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A delete that reaches past its record (0051) against REAL PostgreSQL
 * loaded with the shared fixture's parity schema (0028). Each case's answer
 * is written once in `@formancy/data-fixtures` (`CASCADE_PARITY`) and the
 * SQL Server suite runs the same cases, each declared with `covers()` (0035).
 *
 * A removable_parent row takes its removable_cascade rows with it, and their
 * removable_grandchild rows, and clears removable_null's reference: three
 * keys the policy names in `cascades` with their actions. The requests are
 * the planner's, over bindings generated from what discovery reports as the
 * owner, decided over the table as `describe` reads it just before. The
 * owner inserts every row a case deletes, and reads what is left.
 *
 * On PostgreSQL such a delete takes the locked path whatever the isolation:
 * it locks every table it reaches, ROW EXCLUSIVE, before its statement takes
 * a snapshot, so the statement's guard sees every key that could act on it.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let parity: MetadataSnapshot
let bindings: FormBindings

const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
const READS = { read: ['clerk'], write: [] }
const CLARA: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: '1' } }
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
  fields: { id: READS, tenant_id: READS, note: READS },
  rowFilters: TENANT,
  lookups: {},
  cascades: PARITY_CASCADES.map((entry) => ({ ...entry, table: { ...entry.table } })),
}

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  parity = await discoverPostgres(owner, PARITY_SCOPE)
  bindings = generateForm(parity, { connection: 'test', root: { schema: 'parity', name: 'removable_parent' }, formId: 'removable-parent', title: 'Parent', lookups: [], versionColumn: 'version' }).bindings
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

const expected = (name: CascadeCase): DeleteAnswer => cascadeAnswer(name, 'postgres')

function answer(outcome: DeleteOutcome): DeleteAnswer {
  return outcome.ok ? 'deleted' : outcome.code
}

/** A delete of the parent `id` planned as the server plans one: over the table as `describe` reads it now, through `via`. */
async function planned(id: string, via: RecordAdapter = records): Promise<DeleteRequest> {
  const described = await via.describe({ schema: 'parity', name: 'removable_parent' })
  if (!described.ok) throw new Error(`expected a description, got ${described.code}: ${described.message}`)
  const plan = planDelete(parity, bindings, POLICY, CLARA, `k1:${id}`, '1', described.described)
  if (!plan.ok) throw new Error(`expected a delete, got ${plan.code}: ${plan.message}`)
  return plan.request
}

async function inserted(table: string, values: Record<string, string | number | null>): Promise<string> {
  const names = Object.keys(values)
  const [row] = await owner.unsafe<Array<{ id: string }>>(
    `insert into parity.${table} (${names.join(', ')}) values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id::text as id`,
    Object.values(values),
  )
  if (row === undefined) throw new Error(`nothing inserted into parity.${table}`)
  return row.id
}

/** A parent of tenant 1, with `cascading` rows that each have a grandchild, and `cleared` rows that refer to it through SET NULL. */
async function family(note: string, cascading = 2, cleared = 1): Promise<string> {
  const parent = await inserted('removable_parent', { tenant_id: 1, note })
  for (let index = 0; index < cascading; index += 1) {
    const child = await inserted('removable_cascade', { parent_id: parent, note })
    await inserted('removable_grandchild', { cascade_id: child, note })
  }
  for (let index = 0; index < cleared; index += 1) await inserted('removable_null', { parent_id: parent, note })
  return parent
}

/** What is left of a family, by its note: the parent, its cascading rows, their grandchildren, and the rows that still refer to it. */
async function left(note: string): Promise<{ parent: number; cascade: number; grandchild: number; referring: number }> {
  const [row] = await owner.unsafe<Array<{ parent: number; cascade: number; grandchild: number; referring: number }>>(
    `select (select count(*)::int from parity.removable_parent where note = $1) as parent,
            (select count(*)::int from parity.removable_cascade where note = $1) as cascade,
            (select count(*)::int from parity.removable_grandchild where note = $1) as grandchild,
            (select count(*)::int from parity.removable_null where note = $1 and parent_id is not null) as referring`,
    [note],
  )
  return row as { parent: number; cascade: number; grandchild: number; referring: number }
}

const whole = (cascading = 2, cleared = 1) => ({ parent: 1, cascade: cascading, grandchild: cascading, referring: cleared })
const gone = { parent: 0, cascade: 0, grandchild: 0, referring: 0 }

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
    const outcome = pending()
    await waitUntilBlocked()
    return { outcome }
  })
  return held.outcome
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

/** What a deleting role is granted: SELECT and DELETE on the parent, and DELETE on every table the delete reaches -- what 0051 holds a delete to. */
const DELETER = (role: string) => [
  `grant select, delete on parity.removable_parent to ${role}`,
  `grant delete on parity.removable_cascade, parity.removable_grandchild, parity.removable_null to ${role}`,
]

describe('a delete that cascades and clears through keys the policy names', () => {
  // Named with their actions, the keys are followed: the parent's rows go
  // with it and nobody else's (watched failing with 0050's guard, which
  // accepts no key: schema-changed, and every row still there).
  test('cascade: the rows a cascade reaches go with the record, and no other', covers('postgres', cascadeCase('cascade')), async () => {
    const parent = await family('cascade', 2, 0)
    await family('cascade, another parent', 2, 0)
    expect(answer(await records.delete(await planned(parent)))).toBe(expected('cascade'))
    expect(await left('cascade')).toEqual(gone)
    expect(await left('cascade, another parent')).toEqual(whole(2, 0))
  })

  // SET NULL keeps the row and writes its reference alone: its version
  // column stays where it was, so a person editing it is not told (0051).
  // Writing the reference it had back is refused by the key, whose target
  // is gone: 23503.
  test('clears: a row that referred to the record keeps its place, with no reference and its version unchanged', covers('postgres', cascadeCase('clears')), async () => {
    const parent = await family('clears', 0, 1)
    expect(answer(await records.delete(await planned(parent)))).toBe(expected('clears'))
    expect([...(await owner.unsafe("select parent_id, version::text as version from parity.removable_null where note = 'clears'"))]).toEqual([{ parent_id: null, version: '1' }])
    await expect(owner.unsafe("update parity.removable_null set parent_id = $1 where note = 'clears'", [parent])).rejects.toMatchObject({ code: '23503', constraint_name: 'fk_removable_null_parent' })
  })

  // The cascading rows' own cascade is followed too, two levels below.
  test('grandchild: a cascade two levels below the record is followed', covers('postgres', cascadeCase('grandchild')), async () => {
    const parent = await family('grandchild', 1, 0)
    expect(answer(await records.delete(await planned(parent)))).toBe(expected('grandchild'))
    expect(await left('grandchild')).toEqual(gone)
  })
})

describe('what moved since the delete was decided', () => {
  const addCopyKey = 'alter table parity.removable_copy add constraint fk_removable_copy_cascade foreign key (cascade_id) references parity.removable_cascade (id) on delete cascade'

  /** A copy of a family's cascading rows, which a key added in the case would delete with them. */
  async function copied(note: string): Promise<void> {
    await owner.unsafe('insert into parity.removable_copy (cascade_id) select id from parity.removable_cascade where note = $1', [note])
  }
  const copies = async () => [...(await owner.unsafe('select count(*)::int as n from parity.removable_copy'))]

  // A key onto a table past the root, committed after the delete was
  // decided, would delete rows nobody named. The guard reads every key onto
  // every table the delete removes rows of, and refuses it; nothing is
  // deleted, the record's own cascade included (watched failing with the
  // guard over the root alone: the record, its rows and their copies were
  // deleted).
  test('reach-moved: a cascading key onto a table the delete reaches, added before it ran, deletes nothing', covers('postgres', cascadeCase('reach-moved')), async () => {
    await owner.unsafe('create table parity.removable_copy (cascade_id int not null)')
    try {
      const parent = await family('reach-moved')
      const request = await planned(parent)
      await copied('reach-moved')
      await owner.unsafe(addCopyKey)
      expect(await records.delete(request)).toMatchObject({ ok: false, code: expected('reach-moved'), message: expect.stringMatching(/foreign key now acts/) })
      expect(await left('reach-moved')).toEqual(whole())
      expect(await copies()).toEqual([{ n: 2 }])
    } finally {
      await owner.unsafe('drop table parity.removable_copy')
    }
  })

  // The same key, committed while the delete waits. A statement locks only
  // the table it names before its snapshot: the cascade opens the lines'
  // table after it, and a key committed in between acts unseen. So a delete
  // that reaches past its root locks every table it reaches first, under any
  // isolation, in a mode ADD FOREIGN KEY waits for (watched failing with the
  // guard in the statement and no locks: the delete was answered done and
  // the copies deleted; and with the locks taken ACCESS SHARE, which ADD
  // FOREIGN KEY does not wait for: the same).
  test('reach-moved-waiting: the same key committed while the delete waits, under either isolation, deletes nothing', covers('postgres', cascadeCase('reach-moved-waiting')), async () => {
    await owner.unsafe('create table parity.removable_copy (cascade_id int not null)')
    try {
      for (const isolation of ['read committed', 'repeatable read'] as const) {
        const sql = postgres(fixture.admin, { onnotice: () => {}, connection: { default_transaction_isolation: isolation } })
        const note = `reach-moved-waiting, ${isolation}`
        try {
          const via = createPostgresRecords(sql)
          const request = await planned(await family(note), via)
          await copied(note)
          const outcome = await racedWith((tx) => tx.unsafe(addCopyKey), () => via.delete(request))
          expect(answer(outcome), isolation).toBe(expected('reach-moved-waiting'))
          expect(await left(note), isolation).toEqual(whole())
          expect([...(await owner.unsafe('select count(*)::int as n from parity.removable_copy c join parity.removable_cascade r on r.id = c.cascade_id where r.note = $1', [note]))]).toEqual([{ n: 2 }])
        } finally {
          await sql.end()
          await owner.unsafe('alter table parity.removable_copy drop constraint if exists fk_removable_copy_cascade')
        }
      }
    } finally {
      await owner.unsafe('drop table parity.removable_copy')
    }
  })

  // A key accepted as SET NULL that now cascades deletes rows the policy
  // accepted it would keep: the guard matches each key by its action as
  // well as its name (watched failing with the action left out of the
  // match: the referring row was deleted).
  test('action-changed: an accepted key whose action changed deletes nothing', covers('postgres', cascadeCase('action-changed')), async () => {
    const parent = await family('action-changed')
    const request = await planned(parent)
    await owner.unsafe(`alter table parity.removable_null drop constraint fk_removable_null_parent;
      alter table parity.removable_null add constraint fk_removable_null_parent foreign key (parent_id) references parity.removable_parent (id) on delete cascade`)
    try {
      expect(answer(await records.delete(request))).toBe(expected('action-changed'))
      expect(await left('action-changed')).toEqual(whole())
    } finally {
      await owner.unsafe(`alter table parity.removable_null drop constraint fk_removable_null_parent;
        alter table parity.removable_null add constraint fk_removable_null_parent foreign key (parent_id) references parity.removable_parent (id) on delete set null`)
    }
  })

  // A reference set NULL is a change another key can follow ON UPDATE into
  // a table nobody named. One added after the delete was decided is refused
  // by the guard, and nothing is cleared (watched failing with the cleared
  // columns unguarded: the reference was cleared and the copy's with it).
  test('clears-moved: a key that follows a cleared reference on update, added after the delete was decided, deletes nothing', covers('postgres', cascadeCase('clears-moved')), async () => {
    await owner.unsafe('create table parity.removable_null_copy (parent_id int, null_id int not null)')
    try {
      const parent = await family('clears-moved', 0, 1)
      const request = await planned(parent)
      await owner.unsafe("insert into parity.removable_null_copy select parent_id, id from parity.removable_null where note = 'clears-moved'")
      await owner.unsafe(
        'alter table parity.removable_null_copy add constraint fk_removable_null_copy foreign key (parent_id, null_id) references parity.removable_null (parent_id, id) on update cascade',
      )
      expect(answer(await records.delete(request))).toBe(expected('clears-moved'))
      expect(await left('clears-moved')).toEqual(whole(0, 1))
      expect([...(await owner.unsafe('select count(*)::int as n from parity.removable_null_copy where parent_id = $1', [parent]))]).toEqual([{ n: 1 }])
    } finally {
      await owner.unsafe('drop table parity.removable_null_copy')
    }
  })
})

describe("the account's grants and row security on the tables a delete reaches", () => {
  // A cascade runs as the referring table's owner, whatever the deleting
  // account may do there (measured, 0051 P5), so 0051 holds a delete to the
  // account's DELETE on every table it reaches itself. The ROW EXCLUSIVE
  // lock the delete takes first is refused only to an account with no grant
  // to write the table -- INSERT or UPDATE is enough for it -- so the
  // statement asks DELETE of every table past the root under that lock: one
  // revoked after the delete was decided refuses it, whatever the account
  // kept, and nothing is deleted (watched failing with the root alone
  // locked: the delete was answered done, and the cascade deleted the
  // grandchildren as their owner; and with DELETE left to the lock: where
  // the account kept INSERT on the grandchildren or UPDATE on the cleared
  // table, answered done).
  test('reach-privilege: an account that lost DELETE on a table the delete reaches is refused, and nothing is deleted', covers('postgres', cascadeCase('reach-privilege')), async () => {
    for (const { table, keeps } of REACH_PRIVILEGE_LOSSES) {
      const role = `reach_deleter_${table}_${keeps ?? 'nothing'}`
      const note = `reach-privilege: ${table.replace('removable_', '')}, ${keeps ?? 'nothing'}`
      const sql = await asRole(role, [...DELETER(role), ...(keeps === null ? [] : [`grant ${keeps} on parity.${table} to ${role}`])])
      try {
        const via = createPostgresRecords(sql)
        const request = await planned(await family(note), via)
        await owner.unsafe(`revoke delete on parity.${table} from ${role}`)
        expect.soft(answer(await via.delete(request)), note).toBe(expected('reach-privilege'))
        expect.soft(await left(note), note).toEqual(whole())
      } finally {
        await sql.end()
      }
    }
  })

  // Row security on a table a cascade reaches is not asked: the account
  // sees none of the cascading rows, FORCE included, and they go with the
  // record (measured, 0051 P5). Characterised: the rows a cascade reaches
  // are the database's, not any form's.
  test("cascade-security: rows the account's row security hides go with the record", covers('postgres', cascadeCase('cascade-security')), async () => {
    const sql = await asRole('policed_cascader', [...DELETER('policed_cascader'), 'grant select on parity.removable_cascade to policed_cascader'])
    await owner.unsafe('alter table parity.removable_cascade enable row level security; alter table parity.removable_cascade force row level security')
    try {
      const via = createPostgresRecords(sql)
      const parent = await family('cascade-security')
      expect([...(await sql.unsafe("select count(*)::int as n from parity.removable_cascade where note = 'cascade-security'"))]).toEqual([{ n: 0 }])
      expect(answer(await via.delete(await planned(parent, via)))).toBe(expected('cascade-security'))
      expect(await left('cascade-security')).toEqual(gone)
    } finally {
      await sql.end()
      await owner.unsafe('alter table parity.removable_cascade no force row level security; alter table parity.removable_cascade disable row level security')
    }
  })

  // What runs on a table a cascade reaches is PostgreSQL's, and not under
  // one identity. The referential action's delete runs as the referring
  // table's owner, so that table's BEFORE DELETE trigger and the rule that
  // rewrites the action run as the owner, with the owner's grants; its
  // AFTER DELETE trigger, queued to the end of the deleting statement, runs
  // as the deleting account. Characterised (0051 P5), and never seen or
  // governed here.
  test("a cascaded table's BEFORE trigger and rule run as its owner, its AFTER trigger as the deleting account", async () => {
    const sql = await asRole('triggered_cascader', [...DELETER('triggered_cascader')])
    await owner.unsafe(`create table parity.cascade_log (fired text not null, by_whom text not null);
      grant insert on parity.cascade_log to triggered_cascader;
      create function parity.cascade_logged() returns trigger language plpgsql as $$
        begin insert into parity.cascade_log values (tg_when, current_user); return old; end $$;
      create trigger tr_cascade_before before delete on parity.removable_cascade for each row execute function parity.cascade_logged();
      create trigger tr_cascade_after after delete on parity.removable_cascade for each row execute function parity.cascade_logged();
      create rule rl_cascade_logged as on delete to parity.removable_cascade do also insert into parity.cascade_log values ('RULE', current_user)`)
    try {
      const [{ owned } = { owned: '' }] = await owner<{ owned: string }[]>`select pg_catalog.pg_get_userbyid(relowner)::text as owned from pg_catalog.pg_class where oid = 'parity.removable_cascade'::regclass`
      const parent = await family('cascade-triggers', 1, 0)
      const via = createPostgresRecords(sql)
      expect(answer(await via.delete(await planned(parent, via)))).toBe('deleted')
      expect([...(await owner.unsafe('select fired, by_whom from parity.cascade_log order by fired'))]).toEqual([
        { fired: 'AFTER', by_whom: 'triggered_cascader' },
        { fired: 'BEFORE', by_whom: owned },
        { fired: 'RULE', by_whom: owned },
      ])
    } finally {
      await sql.end()
      await owner.unsafe(`drop rule rl_cascade_logged on parity.removable_cascade;
        drop trigger tr_cascade_before on parity.removable_cascade;
        drop trigger tr_cascade_after on parity.removable_cascade;
        drop function parity.cascade_logged();
        drop table parity.cascade_log`)
    }
  })
})
