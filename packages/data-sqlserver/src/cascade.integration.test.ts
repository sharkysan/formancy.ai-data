import { generateForm, planDelete } from '@formancy/data-core'
import type { DeleteOutcome, DeleteRequest, FormBindings, FormPolicy, MetadataSnapshot, PolicyContext, RecordAdapter } from '@formancy/data-core'
import { cascadeAnswer, cascadeCase, covers, PARITY_CASCADES, PARITY_SCOPE, REACH_PRIVILEGE_LOSSES, startSqlServerFixture } from '@formancy/data-fixtures'
import type { CascadeCase, DeleteAnswer, SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/*
 * A delete that reaches past its record (0051) against REAL SQL Server
 * loaded with the shared fixture's parity schema (0028). Each case's answer
 * is written once in `@formancy/data-fixtures` (`CASCADE_PARITY`) and the
 * PostgreSQL suite runs the same cases, each declared with `covers()` (0035).
 *
 * A removable_parent row takes its removable_cascade rows with it, and their
 * removable_grandchild rows, and clears removable_null's reference: three
 * keys the policy names in `cascades` with their actions. The requests are
 * the planner's, over bindings generated from what discovery reports as the
 * owner, decided over the table as `describe` reads it just before. The
 * owner inserts every row a case deletes, and reads what is left.
 *
 * On SQL Server the write batch checks the reach after the statement, under
 * its locks and inside its transaction, so whatever a cascade did through a
 * key it was not decided over is rolled back with the refusal.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
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
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  parity = await discoverSqlServer(owner, PARITY_SCOPE)
  bindings = generateForm(parity, { connection: 'test', root: { schema: 'parity', name: 'removable_parent' }, formId: 'removable-parent', title: 'Parent', lookups: [], versionColumn: 'version' }).bindings
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

const expected = (name: CascadeCase): DeleteAnswer => cascadeAnswer(name, 'sqlserver')

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
  const request = owner.request()
  const names = Object.keys(values)
  names.forEach((name) => request.input(name, values[name]))
  const result = await request.query<{ id: number }>(`insert into parity.${table} (${names.join(', ')}) output inserted.id values (${names.map((name) => `@${name}`).join(', ')})`)
  const id = result.recordset[0]?.id
  if (id === undefined) throw new Error(`nothing inserted into parity.${table}`)
  return String(id)
}

/** A parent of tenant 1, with `cascading` rows that each have a grandchild, and `cleared` rows that refer to it through SET NULL. */
async function family(note: string, cascading = 2, cleared = 1): Promise<string> {
  const parent = await inserted('removable_parent', { tenant_id: 1, note })
  for (let index = 0; index < cascading; index += 1) {
    const child = await inserted('removable_cascade', { parent_id: Number(parent), note })
    await inserted('removable_grandchild', { cascade_id: Number(child), note })
  }
  for (let index = 0; index < cleared; index += 1) await inserted('removable_null', { parent_id: Number(parent), note })
  return parent
}

/** What is left of a family, by its note: the parent, its cascading rows, their grandchildren, and the rows that still refer to it. */
async function left(note: string): Promise<{ parent: number; cascade: number; grandchild: number; referring: number }> {
  const result = await owner
    .request()
    .input('note', mssql.NVarChar(50), note)
    .query<{ parent: number; cascade: number; grandchild: number; referring: number }>(
      `select (select count(*) from parity.removable_parent where note = @note) as parent,
              (select count(*) from parity.removable_cascade where note = @note) as [cascade],
              (select count(*) from parity.removable_grandchild where note = @note) as grandchild,
              (select count(*) from parity.removable_null where note = @note and parent_id is not null) as referring`,
    )
  return result.recordset[0] as { parent: number; cascade: number; grandchild: number; referring: number }
}

const whole = (cascading = 2, cleared = 1) => ({ parent: 1, cascade: cascading, grandchild: cascading, referring: cleared })
const gone = { parent: 0, cascade: 0, grandchild: 0, referring: 0 }

async function count(sql: string): Promise<number> {
  const result = await owner.request().query<{ n: number }>(sql)
  return result.recordset[0]?.n ?? -1
}

/** Waits until the server shows `session` waiting on another's lock: polled, never a fixed delay. */
async function blocked(session: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = await owner.request().input('session', mssql.Int, session).query<{ blocker: number }>('select blocking_session_id as blocker from sys.dm_exec_requests where session_id = @session')
    if ((found.recordset[0]?.blocker ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`session ${String(session)} never waited on the held lock`)
}

/** `pending`, through an adapter on a connection of its own, started while another transaction has run `hold` and not committed, and answered after it commits. */
async function racedWith(hold: string, pending: (via: RecordAdapter) => Promise<DeleteOutcome>): Promise<DeleteOutcome> {
  const adapterPool = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
  const holder = new mssql.Transaction(owner)
  let open = false
  try {
    const session = (await adapterPool.request().query<{ id: number }>('select @@spid as id')).recordset[0]?.id ?? 0
    await holder.begin()
    open = true
    await new mssql.Request(holder).batch(hold)
    const outcome = pending(createSqlServerRecords(adapterPool))
    await blocked(session)
    await holder.commit()
    open = false
    return await outcome
  } finally {
    if (open) await holder.rollback()
    await adapterPool.close()
  }
}

/** A pool as a user of its own, made by the owner for one case. */
async function asUser(user: string, grants: readonly string[]): Promise<mssql.ConnectionPool> {
  const password = 'User-Fixture-Password-1'
  await owner.request().batch(`create login ${user} with password = '${password}', check_policy = off`)
  await owner.request().batch(`create user ${user} for login ${user}`)
  for (const grant of grants) await owner.request().batch(grant)
  return new mssql.ConnectionPool({ ...fixture.admin, user, password }).connect()
}

/**
 * What a deleting user is granted: SELECT and DELETE on the parent, DELETE
 * on every table the delete reaches -- what 0051 holds a delete to -- and
 * VIEW DEFINITION on the database, without which the batch refuses any
 * delete it cannot be sure sees every key (0050).
 */
const DELETER = (user: string) => [
  `grant select, delete on parity.removable_parent to ${user}`,
  `grant delete on parity.removable_cascade to ${user}`,
  `grant delete on parity.removable_grandchild to ${user}`,
  `grant delete on parity.removable_null to ${user}`,
  `grant view definition to ${user}`,
]

describe('a delete that cascades and clears through keys the policy names', () => {
  // Named with their actions, the keys are followed: the parent's rows go
  // with it and nobody else's (watched failing with 0050's guard, which
  // accepts no key: schema-changed, and every row still there).
  test('cascade: the rows a cascade reaches go with the record, and no other', covers('sqlserver', cascadeCase('cascade')), async () => {
    const parent = await family('cascade', 2, 0)
    await family('cascade, another parent', 2, 0)
    expect(answer(await records.delete(await planned(parent)))).toBe(expected('cascade'))
    expect(await left('cascade')).toEqual(gone)
    expect(await left('cascade, another parent')).toEqual(whole(2, 0))
  })

  // SET NULL keeps the row and writes its reference alone: its version
  // column stays where it was, as on PostgreSQL. A rowversion moves: SQL
  // Server stamps every update of a row, the referential action's included,
  // so a save guarded by one is stale. Writing the reference the row had
  // back is refused by the key, whose target is gone: 547.
  test('clears: a row that referred to the record keeps its place, with no reference and its version unchanged', covers('sqlserver', cascadeCase('clears')), async () => {
    await owner.request().batch('alter table parity.removable_null add stamped rowversion')
    try {
      const stamp = async () => (await owner.request().query<{ stamped: Buffer }>("select stamped from parity.removable_null where note = N'clears'")).recordset[0]?.stamped.toString('hex')
      const parent = await family('clears', 0, 1)
      const before = await stamp()
      expect(before).toMatch(/^[0-9a-f]{16}$/)
      expect(answer(await records.delete(await planned(parent)))).toBe(expected('clears'))
      const result = await owner.request().query<{ parent_id: number | null; version: number }>("select parent_id, version from parity.removable_null where note = N'clears'")
      expect(result.recordset).toEqual([{ parent_id: null, version: 1 }])
      expect(await stamp()).not.toBe(before)
      await expect(owner.request().input('parent', mssql.Int, Number(parent)).query("update parity.removable_null set parent_id = @parent where note = N'clears'")).rejects.toMatchObject({ number: 547 })
    } finally {
      await owner.request().batch('alter table parity.removable_null drop column stamped')
    }
  })

  // The cascading rows' own cascade is followed too, two levels below.
  test('grandchild: a cascade two levels below the record is followed', covers('sqlserver', cascadeCase('grandchild')), async () => {
    const parent = await family('grandchild', 1, 0)
    expect(answer(await records.delete(await planned(parent)))).toBe(expected('grandchild'))
    expect(await left('grandchild')).toEqual(gone)
  })
})

describe('what moved since the delete was decided', () => {
  const addCopyKey = 'alter table parity.removable_copy add constraint fk_removable_copy_cascade foreign key (cascade_id) references parity.removable_cascade (id) on delete cascade'

  async function copied(note: string): Promise<void> {
    await owner.request().input('note', mssql.NVarChar(50), note).query('insert into parity.removable_copy (cascade_id) select id from parity.removable_cascade where note = @note')
  }

  // A key onto a table past the root, committed after the delete was
  // decided, would delete rows nobody named. The batch's guard reads every
  // key onto every table the delete removes rows of, after the statement,
  // and rolls back what the cascade did (watched failing with the guard over
  // the root alone: the record, its rows and their copies were deleted).
  test('reach-moved: a cascading key onto a table the delete reaches, added before it ran, deletes nothing', covers('sqlserver', cascadeCase('reach-moved')), async () => {
    await owner.request().batch('create table parity.removable_copy (cascade_id int not null)')
    try {
      const parent = await family('reach-moved')
      const request = await planned(parent)
      await copied('reach-moved')
      await owner.request().batch(addCopyKey)
      expect(await records.delete(request)).toMatchObject({ ok: false, code: expected('reach-moved'), message: expect.stringMatching(/foreign key now acts/) })
      expect(await left('reach-moved')).toEqual(whole())
      expect(await count('select count(*) as n from parity.removable_copy')).toBe(2)
    } finally {
      await owner.request().batch('drop table parity.removable_copy')
    }
  })

  // The same key, committed while the delete waits for it: the guard runs
  // after the statement, under its locks, so it reads the key either way.
  test('reach-moved-waiting: the same key committed while the delete waits deletes nothing', covers('sqlserver', cascadeCase('reach-moved-waiting')), async () => {
    await owner.request().batch('create table parity.removable_copy (cascade_id int not null)')
    try {
      const request = await planned(await family('reach-moved-waiting'))
      await copied('reach-moved-waiting')
      const outcome = await racedWith(addCopyKey, (via) => via.delete(request))
      expect(answer(outcome)).toBe(expected('reach-moved-waiting'))
      expect(await left('reach-moved-waiting')).toEqual(whole())
      expect(await count('select count(*) as n from parity.removable_copy')).toBe(2)
    } finally {
      await owner.request().batch('drop table parity.removable_copy')
    }
  })

  // A key accepted as SET NULL that now cascades deletes rows the policy
  // accepted it would keep: the guard matches each key by its action as
  // well as its name (watched failing with the action left out of the
  // match: the referring row was deleted).
  test('action-changed: an accepted key whose action changed deletes nothing', covers('sqlserver', cascadeCase('action-changed')), async () => {
    const parent = await family('action-changed')
    const request = await planned(parent)
    const set = (action: string) =>
      `alter table parity.removable_null drop constraint fk_removable_null_parent;
       alter table parity.removable_null add constraint fk_removable_null_parent foreign key (parent_id) references parity.removable_parent (id) on delete ${action};`
    await owner.request().batch(set('cascade'))
    try {
      expect(answer(await records.delete(request))).toBe(expected('action-changed'))
      expect(await left('action-changed')).toEqual(whole())
    } finally {
      await owner.request().batch(set('set null'))
    }
  })

  // A reference set NULL is a change another key can follow ON UPDATE into
  // a table nobody named. One added after the delete was decided is refused
  // by the guard, and the clearing is rolled back (watched failing with the
  // cleared columns unguarded: the reference was cleared and the copy's
  // with it).
  test('clears-moved: a key that follows a cleared reference on update, added after the delete was decided, deletes nothing', covers('sqlserver', cascadeCase('clears-moved')), async () => {
    await owner.request().batch('create table parity.removable_null_copy (parent_id int null, null_id int not null)')
    try {
      const parent = await family('clears-moved', 0, 1)
      const request = await planned(parent)
      await owner.request().batch("insert into parity.removable_null_copy select parent_id, id from parity.removable_null where note = N'clears-moved'")
      await owner
        .request()
        .batch('alter table parity.removable_null_copy add constraint fk_removable_null_copy foreign key (parent_id, null_id) references parity.removable_null (parent_id, id) on update cascade')
      expect(answer(await records.delete(request))).toBe(expected('clears-moved'))
      expect(await left('clears-moved')).toEqual(whole(0, 1))
      expect(await count(`select count(*) as n from parity.removable_null_copy where parent_id = ${Number(parent)}`)).toBe(1)
    } finally {
      await owner.request().batch('drop table parity.removable_null_copy')
    }
  })
})

describe("the account's grants and row security on the tables a delete reaches", () => {
  // SQL Server asks the deleting account nothing of the tables a cascade
  // reaches: no grant, and a DENY there does not stop it (measured, 0051
  // P5). 0051 holds a delete to the account's DELETE on every table it
  // reaches, so the batch asks: one revoked after the delete was decided is
  // refused as the account's grants, whatever grant to write that table the
  // account kept, and the cascade is rolled back (watched failing without
  // that check: the delete was answered done, and the grandchildren
  // deleted). The same losses as on PostgreSQL, where the lock is taken with
  // the grants kept.
  test('reach-privilege: an account that lost DELETE on a table the delete reaches is refused, and nothing is deleted', covers('sqlserver', cascadeCase('reach-privilege')), async () => {
    for (const { table, keeps } of REACH_PRIVILEGE_LOSSES) {
      const user = `reach_deleter_${table}_${keeps ?? 'nothing'}`
      const note = `reach-privilege: ${table.replace('removable_', '')}, ${keeps ?? 'nothing'}`
      const pool = await asUser(user, [...DELETER(user), ...(keeps === null ? [] : [`grant ${keeps} on parity.${table} to ${user}`])])
      try {
        const via = createSqlServerRecords(pool)
        const request = await planned(await family(note), via)
        await owner.request().batch(`revoke delete on parity.${table} from ${user}`)
        expect.soft(answer(await via.delete(request)), note).toBe(expected('reach-privilege'))
        expect.soft(await left(note), note).toEqual(whole())
      } finally {
        await pool.close()
      }
    }
  })

  // A security policy on a table a cascade reaches is not asked: a filter
  // that hides every row of it from the account, and a block predicate
  // before delete, and the rows go with the record (measured, 0051 P5).
  // Characterised: the rows a cascade reaches are the database's, not any
  // form's.
  test("cascade-security: rows the account's security policy hides go with the record", covers('sqlserver', cascadeCase('cascade-security')), async () => {
    const pool = await asUser('policed_cascader', [...DELETER('policed_cascader'), 'grant select on parity.removable_cascade to policed_cascader'])
    await owner.request().batch('create schema cascade_security')
    await owner.request().batch("create function cascade_security.nobody(@note nvarchar(50)) returns table with schemabinding as return select 1 as visible where @note = N'never'")
    await owner
      .request()
      .batch(
        'create security policy cascade_security.hidden add filter predicate cascade_security.nobody(note) on parity.removable_cascade, add block predicate cascade_security.nobody(note) on parity.removable_cascade before delete with (state = on)',
      )
    try {
      const via = createSqlServerRecords(pool)
      const parent = await family('cascade-security')
      const seen = await pool.request().query<{ n: number }>("select count(*) as n from parity.removable_cascade where note = N'cascade-security'")
      expect(seen.recordset).toEqual([{ n: 0 }])
      expect(answer(await via.delete(await planned(parent, via)))).toBe(expected('cascade-security'))
      expect(await left('cascade-security')).toEqual(gone)
    } finally {
      await pool.close()
      await owner.request().batch('drop security policy cascade_security.hidden; drop function cascade_security.nobody;')
      await owner.request().batch('drop schema cascade_security')
    }
  })
})
