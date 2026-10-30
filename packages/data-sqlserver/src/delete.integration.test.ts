import { findObject, generateForm, planDelete, planUpdate } from '@formancy/data-core'
import type { DeleteOutcome, DeleteRequest, FormBindings, FormPolicy, MetadataSnapshot, PolicyContext, RecordAdapter, RecordColumn } from '@formancy/data-core'
import { covers, deleteAnswer, deleteCase, PARITY_SCOPE, startSqlServerFixture, UPDATE_RECREATED, UPDATE_RECREATED_CASE } from '@formancy/data-fixtures'
import type { DeleteAnswer, DeleteCase, SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/*
 * Deleting one record (0050) against REAL SQL Server loaded with the shared
 * fixture's parity schema (0028). Each case's answer is written once in
 * `@formancy/data-fixtures` (`DELETE_PARITY`) and the PostgreSQL suite runs
 * the same cases, each declared with `covers()` (0035).
 *
 * The requests are the planner's, from bindings generated over what
 * discovery reports as the owner, decided over the table as `describe`
 * reads it just before, as the server sends them; but `not-a-key`, whose
 * identity only a hand-made request can name. The owner inserts every row a
 * case deletes, and reads what is left.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
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
} as const satisfies Record<string, FormPolicy>
type Table = keyof typeof POLICIES

const forms = new Map<Table, FormBindings>()

function form(table: Table): FormBindings {
  const found = forms.get(table)
  if (found === undefined) throw new Error(`no form over parity.${table}`)
  return found
}

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  parity = await discoverSqlServer(owner, PARITY_SCOPE)
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
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
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

const expected = (name: DeleteCase): DeleteAnswer => deleteAnswer(name, 'sqlserver')

/** A row inserted as the owner, by its columns, returning its id. */
async function inserted(table: string, values: Record<string, string | number | null>): Promise<string> {
  const request = owner.request()
  const names = Object.keys(values)
  names.forEach((name) => request.input(name, values[name]))
  const result = await request.query<{ id: number }>(
    `insert into parity.${table} (${names.join(', ')}) output inserted.id values (${names.map((name) => `@${name}`).join(', ')})`,
  )
  const id = result.recordset[0]?.id
  if (id === undefined) throw new Error(`nothing inserted into parity.${table}`)
  return String(id)
}

/** The row's version as the owner reads it, or null when it is gone. */
async function versionOf(table: string, id: string): Promise<string | null> {
  const result = await owner.request().input('id', mssql.Int, Number(id)).query<{ version: number }>(`select version from parity.${table} where id = @id`)
  const row = result.recordset[0]
  return row === undefined ? null : String(row.version)
}

async function count(sql: string): Promise<number> {
  const result = await owner.request().query<{ n: number }>(sql)
  return result.recordset[0]?.n ?? -1
}

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
  throw new Error(`session ${String(session)} never waited on the held lock`)
}

/**
 * `pending`, through an adapter on a connection of its own, started while
 * another transaction has run `hold` and not committed, and answered after
 * that transaction commits: the commit waits until the server shows the
 * adapter's session blocked behind it.
 */
async function racedWith(hold: string, pending: (via: RecordAdapter) => Promise<DeleteOutcome>): Promise<DeleteOutcome> {
  const adapterPool = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
  const holder = new mssql.Transaction(owner)
  let open = false
  try {
    const session = (await adapterPool.request().query<{ id: number }>('select @@spid as id')).recordset[0]?.id ?? 0
    await holder.begin()
    open = true
    await new mssql.Request(holder).batch(hold)
    const answer = pending(createSqlServerRecords(adapterPool))
    await blocked(session)
    await holder.commit()
    open = false
    return await answer
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

describe('a delete of one record', () => {
  // The record named by its token, at the version its person read, is
  // deleted -- and the answer is its key as the statement deleted it, and
  // the version it had, never another column.
  test('deleted: the row at the version read is deleted, and the answer is its key and version', covers('sqlserver', deleteCase('deleted')), async () => {
    const id = await inserted('removable', { tenant_id: 1, note: 'deleted' })
    const outcome = await records.delete(await planned('removable', CLARA, `k1:${id}`, '1'))
    expect(answer(outcome)).toBe(expected('deleted'))
    expect(outcome).toEqual({ ok: true, deleted: { values: { id }, version: '1' } })
    expect(await versionOf('removable', id)).toBeNull()
  })

  // A person deletes the record they saw (watched failing with the version
  // left out of the WHERE: the changed row was deleted).
  test('stale: a row changed since it was read is not deleted', covers('sqlserver', deleteCase('stale')), async () => {
    const id = await inserted('removable', { tenant_id: 1, note: 'stale' })
    const request = await planned('removable', CLARA, `k1:${id}`, '1')
    await owner.request().input('id', mssql.Int, Number(id)).query('update parity.removable set version = version + 1 where id = @id')
    expect(answer(await records.delete(request))).toBe(expected('stale'))
    expect(await versionOf('removable', id)).toBe('2')
  })

  // A key no row has is not found, never stale: a follow-up that did not
  // ask whether the row exists would send the person to reload a record
  // that is not there.
  test('not-found: a key no row has', covers('sqlserver', deleteCase('not-found')), async () => {
    expect(answer(await records.delete(await planned('removable', CLARA, 'k1:2147483000', '1')))).toBe(expected('not-found'))
  })

  // Watched failing with the filters left out: tenant 2's row was deleted.
  test("other-tenant: another tenant's row is not found, and stays", covers('sqlserver', deleteCase('other-tenant')), async () => {
    const id = await inserted('removable', { tenant_id: 2, note: 'theirs' })
    expect(answer(await records.delete(await planned('removable', CLARA, `k1:${id}`, '1')))).toBe(expected('other-tenant'))
    expect(await versionOf('removable', id)).toBe('1')
  })

  // A child has no tenant of its own: it exists for a delete only through a
  // parent the tenant may reference (0043). Without the through in the
  // delete's WHERE, another tenant's child would be deleted.
  test("through: a child of another tenant's parent is not found and stays; one of ours is deleted", covers('sqlserver', deleteCase('through')), async () => {
    const theirs = await inserted('removable_child', { removable_id: await inserted('removable', { tenant_id: 2, note: 'parent' }), note: 'theirs' })
    expect(answer(await records.delete(await planned('removable_child', CLARA, `k1:${theirs}`, '1')))).toBe(expected('through'))
    expect(await versionOf('removable_child', theirs)).toBe('1')
    const ours = await inserted('removable_child', { removable_id: await inserted('removable', { tenant_id: 1, note: 'parent' }), note: 'ours' })
    expect(answer(await records.delete(await planned('removable_child', CLARA, `k1:${ours}`, '1')))).toBe('deleted')
  })

  // SQL Server reads the parent after the wait, under the delete's locks,
  // and the child is not found: nothing deleted. PostgreSQL deletes it (0043).
  test('moved-parent: a child whose parent moves to another tenant while the delete waits', covers('sqlserver', deleteCase('moved-parent')), async () => {
    const parent = await inserted('removable', { tenant_id: 1, note: 'moving' })
    const child = await inserted('removable_child', { removable_id: parent, note: 'waits' })
    const request = await planned('removable_child', CLARA, `k1:${child}`, '1')
    const outcome = await racedWith(
      `select 1 from parity.removable_child with (updlock, holdlock) where id = ${child};
       update parity.removable set tenant_id = 2 where id = ${parent}`,
      (via) => via.delete(request),
    )
    expect(answer(outcome)).toBe(expected('moved-parent'))
    expect(await versionOf('removable_child', child)).toBe('1')
  })

  // A key the database numbers is never handed out again, so a stale token
  // names the row that is gone and never the one created since: a delete
  // located by anything but the key would remove the new row.
  test('recreated: the token of a row deleted is not found, though another row was created since', covers('sqlserver', deleteCase('recreated')), async () => {
    const id = await inserted('removable', { tenant_id: 1, note: 'first' })
    const request = await planned('removable', CLARA, `k1:${id}`, '1')
    await owner.request().input('id', mssql.Int, Number(id)).query('delete from parity.removable where id = @id')
    const again = await inserted('removable', { tenant_id: 1, note: 'first' })
    expect(again).not.toBe(id)
    expect(answer(await records.delete(request))).toBe(expected('recreated'))
    expect(await versionOf('removable', again)).toBe('1')
  })
})

describe('what the database keeps', () => {
  // 547, REFERENCE: the key's row still refers to it, and the batch rolled back.
  test('referenced: a row a NO ACTION key still refers to stays', covers('sqlserver', deleteCase('referenced')), async () => {
    const parent = await inserted('removable', { tenant_id: 1, note: 'referred to' })
    await inserted('removable_child', { removable_id: parent, note: 'refers' })
    const outcome = await records.delete(await planned('removable', CLARA, `k1:${parent}`, '1'))
    expect(answer(outcome)).toBe(expected('referenced'))
    expect(outcome).toMatchObject({ constraint: 'fk_removable_child_removable' })
    expect(await versionOf('removable', parent)).toBe('1')
  })

  // SQL Server has no RESTRICT: the fixture's key is NO ACTION, refused as one.
  test('restrict: a row the RESTRICT case refers to stays, refused as NO ACTION is', covers('sqlserver', deleteCase('restrict')), async () => {
    const parent = await inserted('removable', { tenant_id: 1, note: 'restricted' })
    await owner.request().input('id', mssql.Int, Number(parent)).query('insert into parity.removable_restrict (removable_id) values (@id)')
    const outcome = await records.delete(await planned('removable', CLARA, `k1:${parent}`, '1'))
    expect(answer(outcome)).toBe(expected('restrict'))
    expect(outcome).toMatchObject({ constraint: 'fk_removable_restrict_removable' })
    expect(await versionOf('removable', parent)).toBe('1')
  })

  // 547, SAME TABLE REFERENCE: the delete's own spelling of a key onto its
  // table, which the update's FOREIGN KEY SAME TABLE is not (watched failing
  // with the SAME TABLE spelling lost: no constraint named).
  test('self-reference: a row another row of its table refers to stays', covers('sqlserver', deleteCase('self-reference')), async () => {
    const parent = await inserted('removable_self', { parent_id: null })
    await inserted('removable_self', { parent_id: Number(parent) })
    const outcome = await records.delete(await planned('removable_self', CLARA, `k1:${parent}`, '1'))
    expect(answer(outcome)).toBe(expected('self-reference'))
    expect(outcome).toMatchObject({ constraint: 'fk_removable_self_parent' })
    expect(await versionOf('removable_self', parent)).toBe('1')
  })
})

describe('what the database runs on a delete', () => {
  // An INSTEAD OF DELETE trigger: OUTPUT reports the row deleted and it is
  // still there (measured, P4), so the batch refuses it and rolls back.
  test('declined: an INSTEAD OF trigger keeps the row, and is refused', covers('sqlserver', deleteCase('declined')), async () => {
    const id = await inserted('removable_declined', { note: 'declined' })
    expect(answer(await records.delete(await planned('removable_declined', CLARA, `k1:${id}`, '1')))).toBe(expected('declined'))
    expect(await versionOf('removable_declined', id)).toBe('1')
  })

  // A trigger's THROW rolls the batch back: the row stays, and the answer
  // is a refusal, never a deletion reported done or a retry invited.
  test("trigger-refuses: a trigger's error rolls the delete back", covers('sqlserver', deleteCase('trigger-refuses')), async () => {
    const id = await inserted('removable_triggered', { note: 'refuse' })
    expect(answer(await records.delete(await planned('removable_triggered', CLARA, `k1:${id}`, '1')))).toBe(expected('trigger-refuses'))
    expect(await versionOf('removable_triggered', id)).toBe('1')
  })

  // Triggers are the database's (0050): OUTPUT INTO captured the row the
  // statement deleted before the trigger inserted it again, so the delete
  // is reported done and the row is there -- said, not refused, on both
  // engines alike.
  test('restoring: a row an AFTER DELETE trigger inserts again is reported deleted, and is there', covers('sqlserver', deleteCase('restoring')), async () => {
    const id = await inserted('removable_triggered', { note: 'restore' })
    expect(answer(await records.delete(await planned('removable_triggered', CLARA, `k1:${id}`, '1')))).toBe(expected('restoring'))
    expect(await versionOf('removable_triggered', id)).toBe('1')
  })

  // A trigger that writes another table runs with the delete, and the
  // delete is answered done: a guard that refused every table with a DELETE
  // trigger would refuse the audit triggers a deployment keeps (0050).
  test(
    'after-trigger-elsewhere: a row an AFTER DELETE trigger writes elsewhere is there',
    covers('sqlserver', deleteCase('after-trigger-elsewhere')),
    async () => {
      const id = await inserted('removable_triggered', { note: 'log' })
      expect(answer(await records.delete(await planned('removable_triggered', CLARA, `k1:${id}`, '1')))).toBe(expected('after-trigger-elsewhere'))
      expect(await versionOf('removable_triggered', id)).toBeNull()
      expect(await count(`select count(*) as n from parity.removable_log where id = ${id} and note = N'log'`)).toBe(1)
    },
  )
})

describe("the account's grants and row security", () => {
  // VIEW DEFINITION on the table too: without it the version column's
  // default reads as changed to this account, against the owner's snapshot
  // the form is planned from, and drift stops the delete first.
  test('permission: an account without DELETE is refused, and the row stays', covers('sqlserver', deleteCase('permission')), async () => {
    const pool = await asUser('no_deleter', ['grant select, view definition on parity.removable to no_deleter'])
    try {
      const id = await inserted('removable', { tenant_id: 1, note: 'kept' })
      const via = createSqlServerRecords(pool)
      expect(answer(await via.delete(await planned('removable', CLARA, `k1:${id}`, '1', via)))).toBe(expected('permission'))
      expect(await versionOf('removable', id)).toBe('1')
    } finally {
      await pool.close()
    }
  })

  // A BEFORE DELETE block predicate binds every principal, dbo included,
  // and refuses with 33504: permission-denied, where PostgreSQL's DELETE
  // policy declines without an error and is refused (0016's difference).
  test('row-security: a row a block predicate keeps from deleting stays', covers('sqlserver', deleteCase('row-security')), async () => {
    await owner
      .request()
      .batch(
        'create function parity.removable_self_kept(@parent_id int) returns table with schemabinding as return select 1 as kept where @parent_id is not null',
      )
    await owner
      .request()
      .batch(
        'create security policy parity.removable_self_policy add block predicate parity.removable_self_kept(parent_id) on parity.removable_self before delete with (state = on)',
      )
    try {
      const id = await inserted('removable_self', { parent_id: null })
      expect(answer(await records.delete(await planned('removable_self', CLARA, `k1:${id}`, '1')))).toBe(expected('row-security'))
      expect(await versionOf('removable_self', id)).toBe('1')
    } finally {
      await owner.request().batch('drop security policy parity.removable_self_policy')
      await owner.request().batch('drop function parity.removable_self_kept')
    }
  })
})

describe('what moved since the delete was decided', () => {
  // A delete decided over the table as it was runs only while it still is
  // (0041): without the definition guard in the batch, it would run against
  // a table that changed under it.
  test('definition-moved: a delete decided before an ALTER deletes nothing', covers('sqlserver', deleteCase('definition-moved')), async () => {
    const id = await inserted('removable_triggered', { note: 'altered' })
    const request = await planned('removable_triggered', CLARA, `k1:${id}`, '1')
    await owner.request().batch('alter table parity.removable_triggered add extra int null')
    try {
      expect(answer(await records.delete(request))).toBe(expected('definition-moved'))
      expect(await versionOf('removable_triggered', id)).toBe('1')
    } finally {
      await owner.request().batch('alter table parity.removable_triggered drop column extra')
    }
  })

  // A key that cascades onto the table, added after the delete was decided:
  // the statement's cascade runs, the guard after it refuses, and the batch
  // rolls both back -- before the delete, and while it waits for the
  // ALTER's lock (watched failing with the reach guard removed: the row and
  // its copy were both deleted).
  test('reach-moved: a cascading key added before the delete, or while it waits, deletes nothing', covers('sqlserver', deleteCase('reach-moved')), async () => {
    await owner.request().batch('create table parity.removable_copy (removable_id int not null)')
    try {
      const before = await inserted('removable', { tenant_id: 1, note: 'reached' })
      const request = await planned('removable', CLARA, `k1:${before}`, '1')
      await owner.request().batch(`insert into parity.removable_copy values (${before})`)
      await owner
        .request()
        .batch(
          'alter table parity.removable_copy add constraint fk_removable_copy foreign key (removable_id) references parity.removable (id) on delete cascade',
        )
      expect(answer(await records.delete(request))).toBe(expected('reach-moved'))
      expect(await versionOf('removable', before)).toBe('1')
      await owner.request().batch('alter table parity.removable_copy drop constraint fk_removable_copy')

      const waiting = await inserted('removable', { tenant_id: 1, note: 'reached while waiting' })
      await owner.request().batch(`insert into parity.removable_copy values (${waiting})`)
      const late = await planned('removable', CLARA, `k1:${waiting}`, '1')
      const outcome = await racedWith(
        'alter table parity.removable_copy add constraint fk_removable_copy foreign key (removable_id) references parity.removable (id) on delete cascade',
        (via) => via.delete(late),
      )
      expect(answer(outcome)).toBe(expected('reach-moved'))
      expect(await versionOf('removable', waiting)).toBe('1')
      expect(await count('select count(*) as n from parity.removable_copy')).toBe(2)
    } finally {
      await owner.request().batch('drop table parity.removable_copy')
    }
  })

  // An edge constraint is not a foreign key, and one that cascades removes
  // the edges a delete of a node connects (0049, P2b). One added after the
  // delete was decided is refused as a cascading key is, and the batch rolls
  // the cascade back (watched failing with the guard reading foreign keys
  // alone: the node and its edge were deleted).
  test('a cascading edge constraint added before the delete deletes nothing', async () => {
    await owner
      .request()
      .batch(
        'create table parity.noded (id int identity(1, 1) not null constraint pk_noded primary key, note nvarchar(50) null, version int not null constraint df_noded_version default 1) as node',
      )
    await owner.request().batch('create table parity.linked as edge')
    try {
      const snapshot = await discoverSqlServer(owner, PARITY_SCOPE)
      const bindings = generateForm(snapshot, {
        connection: 'test',
        root: { schema: 'parity', name: 'noded' },
        formId: 'noded',
        title: 'Noded',
        lookups: [],
        versionColumn: 'version',
      }).bindings
      expect(bindings.operations.delete).toBe(true)
      const id = await inserted('noded', { note: 'node' })
      const described = await records.describe({ schema: 'parity', name: 'noded' })
      if (!described.ok) throw new Error(described.message)
      const plan = planDelete(snapshot, bindings, deleting(['id', 'note']), CLARA, `k1:${id}`, '1', described.described)
      if (!plan.ok) throw new Error(plan.message)
      await owner.request().batch(`insert into parity.linked ($from_id, $to_id) select n.$node_id, n.$node_id from parity.noded as n where n.id = ${id}`)
      await owner.request().batch('alter table parity.linked add constraint ec_linked connection (parity.noded to parity.noded) on delete cascade')
      expect(await records.delete(plan.request)).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringMatching(/foreign key now acts/) })
      expect(await count('select (select count(*) from parity.noded) + (select count(*) from parity.linked) as n')).toBe(2)
    } finally {
      await owner.request().batch('drop table parity.linked')
      await owner.request().batch('drop table parity.noded')
    }
  })

  // SQL Server lists a key only to an account that may see its table
  // (0049, P2). An account that lost database VIEW DEFINITION after the
  // delete was decided cannot see a cascading key from a schema it holds
  // nothing in; the guard refuses it for the lost grant itself, before any
  // key. It keeps VIEW DEFINITION on the table, so the table's own
  // definition still reads as it did and the reach is what refuses: without
  // that grant the definition moved first, and the case passed with the
  // visibility conditions removed. Watched failing with them removed, so
  // held: the key was not seen, and the row and its copy were deleted.
  test('visibility-narrowed: an account that lost VIEW DEFINITION deletes nothing', covers('sqlserver', deleteCase('visibility-narrowed')), async () => {
    const pool = await asUser('narrowed_deleter', [
      'grant select, delete, view definition on parity.removable to narrowed_deleter',
      'grant view definition to narrowed_deleter',
    ])
    try {
      const id = await inserted('removable', { tenant_id: 1, note: 'out of sight' })
      const via = createSqlServerRecords(pool)
      const request = await planned('removable', CLARA, `k1:${id}`, '1', via)
      await owner.request().batch('revoke view definition to narrowed_deleter')
      await owner.request().batch('create schema hidden')
      await owner
        .request()
        .batch('create table hidden.copy (removable_id int not null constraint fk_hidden_copy references parity.removable (id) on delete cascade)')
      await owner.request().batch(`insert into hidden.copy values (${id})`)
      const outcome = await via.delete(request)
      expect(answer(outcome)).toBe(expected('visibility-narrowed'))
      expect(outcome).toMatchObject({ message: expect.stringMatching(/can no longer see every key/) })
      expect(await versionOf('removable', id)).toBe('1')
      expect(await count('select count(*) as n from hidden.copy')).toBe(1)
    } finally {
      await pool.close()
      await owner.request().batch('drop table if exists hidden.copy')
      await owner.request().batch('drop schema if exists hidden')
    }
  })

  // An account that keeps VIEW DEFINITION on the database still loses sight
  // of a key on a table it is denied VIEW DEFINITION on, or on a table in a
  // schema it is denied it on (0049, P2), and so of what a delete would
  // cascade through it. The guard refuses the deny itself, as discovery's
  // `referenced-by` gap reads it: first a deny on the table the key is on,
  // then one on its schema, each made after the delete was decided.
  for (const [on, user, deny] of [
    ['the table', 'object_denied', 'deny view definition on hidden.copy to object_denied'],
    ['its schema', 'schema_denied', 'deny view definition on schema::hidden to schema_denied'],
  ] as const) {
    test(`a VIEW DEFINITION deny on ${on} a cascading key is on deletes nothing`, async () => {
      const pool = await asUser(user, [`grant select, delete, view definition on parity.removable to ${user}`, `grant view definition to ${user}`])
      try {
        const id = await inserted('removable', { tenant_id: 1, note: 'denied' })
        const via = createSqlServerRecords(pool)
        const request = await planned('removable', CLARA, `k1:${id}`, '1', via)
        await owner.request().batch('create schema hidden')
        await owner
          .request()
          .batch('create table hidden.copy (removable_id int not null constraint fk_hidden_copy references parity.removable (id) on delete cascade)')
        await owner.request().batch(`insert into hidden.copy values (${id})`)
        await owner.request().batch(deny)
        expect(await via.delete(request)).toMatchObject({ ok: false, code: 'schema-changed', message: expect.stringMatching(/can no longer see every key/) })
        expect(await versionOf('removable', id)).toBe('1')
        expect(await count('select count(*) as n from hidden.copy')).toBe(1)
      } finally {
        await pool.close()
        await owner.request().batch('drop table if exists hidden.copy')
        await owner.request().batch('drop schema if exists hidden')
      }
    })
  }

  // Only a hand-made request names an identity two rows share: the batch
  // counts what it deleted and rolls back past one, and both are still
  // there (watched failing with `@rows > 1` removed: both were deleted).
  test('not-a-key: an identity two rows share deletes nothing, and is thrown', covers('sqlserver', deleteCase('not-a-key')), async () => {
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
    expect(await count('select count(*) as n from parity.removable where tenant_id = 9')).toBe(2)
  })
})

describe('a version that cannot tell two records apart', () => {
  // keyed's version column starts at its default on every insert, on SQL
  // Server as on PostgreSQL: the generator offers no delete there on
  // either engine, and an update with the old version lands on a record
  // another session created again under the key. Characterised (0050).
  test(
    'update: recreated: an update with the old version lands on a record created again under the key',
    covers('sqlserver', UPDATE_RECREATED_CASE),
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
      await owner.request().batch("insert into parity.keyed (code, note) values (N'k', N'first')")
      const described = await records.describe({ schema: 'parity', name: 'keyed' })
      if (!described.ok) throw new Error(described.message)
      const plan = planUpdate(parity, keyed, policy, CLARA, 'k1:k', '1', { note: 'changed' }, undefined, described.described)
      if (!plan.ok) throw new Error(plan.message)
      await owner.request().batch("delete from parity.keyed where code = N'k'; insert into parity.keyed (code, note) values (N'k', N'second')")
      const outcome = await records.update(plan.request)
      expect(outcome.ok ? 'updated' : outcome.code).toBe(UPDATE_RECREATED)
      const stored = await owner.request().query<{ note: string; version: number }>("select note, version from parity.keyed where code = N'k'")
      expect(stored.recordset).toEqual([{ note: 'changed', version: 2 }])
    },
  )
})
