import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ColumnAccess, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { findObject } from '@formancy/data-core'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { accessDisagreements, FIXTURE_SCOPE, renamedColumn, startSqlServerFixture, WRITER, WRITER_ACCESS } from '@formancy/data-fixtures'
import { discoverSqlServer } from './index.js'

/**
 * What a snapshot says an account may do, and whether a security policy
 * filters what it sees (0027), against REAL SQL Server.
 *
 * Every expectation here was a probe first (B7 to B19 in 0027, 2026-10-09,
 * mcr.microsoft.com/mssql/server:2022-latest, 16.0.4295.3): the snapshot is
 * held to what the server then does with a real statement, not to what the
 * documentation says HAS_PERMS_BY_NAME does.
 *
 * The accounts are made per test, with this file's constant names and grants,
 * and the security policies a test adds are dropped by it: the fixture's own
 * policy on sales.customer is the only one the other tests expect.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
const opened: mssql.ConnectionPool[] = []

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
})

afterAll(async () => {
  for (const pool of opened) await pool.close()
  await owner?.close()
  await fixture?.stop()
})

const PASSWORD = 'Probe-Fixture-Password-1'

/** Batches the owner runs; this file's constants, never input. */
async function asOwner(...batches: string[]): Promise<void> {
  for (const batch of batches) await owner.request().batch(batch)
}

async function inMaster(...batches: string[]): Promise<void> {
  const master = await new mssql.ConnectionPool({ ...fixture.admin, database: 'master' }).connect()
  try {
    for (const batch of batches) await master.request().batch(batch)
  } finally {
    await master.close()
  }
}

async function connect(config: mssql.config): Promise<mssql.ConnectionPool> {
  const pool = await new mssql.ConnectionPool(config).connect()
  opened.push(pool)
  return pool
}

/**
 * A fresh login, mapped into the fixture database as `user` (its own name
 * unless given) with exactly the grants given, connected.
 */
async function connectAs(login: string, grants: readonly string[], user: string = login): Promise<mssql.ConnectionPool> {
  await inMaster(`create login ${login} with password = '${PASSWORD}', check_policy = off`)
  await asOwner(`create user ${user} for login ${login}`, ...grants)
  return connect({ ...fixture.admin, user: login, password: PASSWORD })
}

function object(snapshot: MetadataSnapshot, schema: string, name: string): ObjectMeta {
  const found = findObject(snapshot, { schema, name })
  if (found === undefined) throw new Error(`${schema}.${name} is not in the snapshot`)
  return found
}

function accessOf(meta: ObjectMeta): Record<string, ColumnAccess> {
  return Object.fromEntries(meta.columns.map((column) => [column.name, column.access]))
}

const quote = (name: string): string => `[${name.replaceAll(']', ']]')}]`

/** What the server did with every statement a snapshot's access predicts. */
interface Probed {
  disagreements: string[]
  allowed: number
  refused: number
}

/**
 * Whether the server allows one statement: true, false on 229 or 230 (the
 * object and column permission errors), and any other error is thrown, since
 * it would mean the statement failed for a reason that is not a privilege.
 * In a transaction rolled back whatever happens; `where 1 = 0` changes no row
 * anyway.
 */
async function allows(pool: mssql.ConnectionPool, sql: string): Promise<boolean> {
  const transaction = pool.transaction()
  await transaction.begin()
  try {
    await transaction.request().query(sql)
    return true
  } catch (error) {
    const number = (error as { number?: unknown }).number
    if (number === 229 || number === 230) return false
    throw new Error(`${sql} failed with ${String(number)}: ${(error as Error).message}`)
  } finally {
    await transaction.rollback()
  }
}

/**
 * Every capability the snapshot reports, put to the server as the statement
 * it predicts (B12): a read of the column, an UPDATE that sets it and an
 * INSERT that names it, each matching no row. A write sets a NULL cast to the
 * column's type and never `c = c`, which reads the column and so needs SELECT
 * as well. Writes skip views, which are not written to here, and columns the
 * database writes itself -- identity, computed and period columns and
 * rowversion -- for which the server refuses the statement before it asks
 * about privileges.
 */
async function probe(pool: mssql.ConnectionPool, snapshot: MetadataSnapshot): Promise<Probed> {
  const out: Probed = { disagreements: [], allowed: 0, refused: 0 }
  const check = async (said: boolean, sql: string, what: string): Promise<void> => {
    const did = await allows(pool, sql)
    if (did) out.allowed += 1
    else out.refused += 1
    if (did !== said) out.disagreements.push(`${what}: the snapshot says ${String(said)}, the server ${did ? 'allowed' : 'refused'} it`)
  }
  for (const meta of snapshot.objects) {
    const table = `${quote(meta.ref.schema)}.${quote(meta.ref.name)}`
    for (const column of meta.columns) {
      const name = quote(column.name)
      const where = `${meta.ref.schema}.${meta.ref.name}.${column.name}`
      await check(column.access.select, `select ${name} from ${table} where 1 = 0`, `${where} select`)
      if (meta.kind === 'view' || column.generated === 'identity-always' || column.generated === 'computed' || column.generated === 'rowversion') continue
      const value = `cast(null as ${column.databaseType})`
      await check(column.access.update, `update ${table} set ${name} = ${value} where 1 = 0`, `${where} update`)
      await check(column.access.insert, `insert into ${table} (${name}) select ${value} where 1 = 0`, `${where} insert`)
    }
  }
  return out
}

describe('what a snapshot says an account may do', () => {
  // The snapshot against the server, statement by statement, for every
  // principal the fixture has and one that may view every definition and
  // touch nothing. A snapshot that said yes where the server says 229 would
  // generate a field that fails on its first save; one that said no where the
  // server allows it would hide a field a person needs. Both outcomes are
  // asserted to occur, so a probe that ran nothing cannot pass.
  test.each([
    ['the owner', 'owner', { refused: false }],
    ['the writer, through its role', 'writer', { refused: true }],
    ['the reader', 'reader', { refused: true }],
    ['an account with VIEW DEFINITION on the schema and nothing else', 'viewer', { refused: true, allowed: false }],
  ] as const)('%s: every capability is the answer the server gives', async (_title, who, outcomes) => {
    const pool =
      who === 'owner'
        ? owner
        : who === 'viewer'
          ? await connectAs('probe_viewer', ['grant view definition on schema::sales to probe_viewer'])
          : await connect(fixture[who])
    const snapshot = await discoverSqlServer(pool, FIXTURE_SCOPE)
    const probed = await probe(pool, snapshot)
    expect(probed.disagreements).toEqual([])
    expect(probed.refused > 0).toBe(outcomes.refused)
    expect(probed.allowed > 0).toBe('allowed' in outcomes ? outcomes.allowed : true)
  })

  // The order form's account holds its grants through the role formancy_forms,
  // database VIEW DEFINITION included (B19). Exactly the fixture's grants, no
  // UPDATE of row_version -- SQL Server writes a rowversion itself -- and no
  // gap: the role-held database grant lists every policy, so customer's
  // APPLIES and the rest are established as none. A privilege that counted
  // only grants made to the user itself would report nothing here.
  test('the writer agrees with WRITER_ACCESS, with no gap, through a role', async () => {
    const writer = await connect(fixture.writer)
    const snapshot = await discoverSqlServer(writer, FIXTURE_SCOPE)
    expect(accessDisagreements(snapshot, WRITER_ACCESS)).toEqual([])
    expect(snapshot.gaps).toEqual([])
    expect(snapshot.account).toEqual({ user: WRITER.user, login: WRITER.user })
    expect(accessOf(object(snapshot, 'sales', 'order'))['row_version']).toEqual({ select: true, insert: true, update: false })
  })

  // The studio's drift gate stands a snapshot renamed in place for a
  // database whose column was renamed; if discovery reported a rename
  // differently -- a new ordinal, lost column grants -- the gate would walk
  // a state no database reaches. As the writer, whose UPDATE of notes is a
  // column grant: what a column added in its place would not have. Renamed
  // back before the next test, which expects the fixture.
  test('a column renamed in the database is discovered as renamedColumn says: the same column, ordinal and grants included, under its new name', async () => {
    const writer = await connect(fixture.writer)
    const order = { schema: 'sales', name: 'order' }
    const before = await discoverSqlServer(writer, FIXTURE_SCOPE)
    expect(accessOf(object(before, 'sales', 'order'))['notes']).toEqual({ select: true, insert: true, update: true })
    await asOwner("exec sp_rename 'sales.[order].notes', 'memo', 'COLUMN'")
    try {
      expect(await discoverSqlServer(writer, FIXTURE_SCOPE)).toEqual(renamedColumn(before, order, 'notes', 'memo'))
    } finally {
      await asOwner("exec sp_rename 'sales.[order].memo', 'notes', 'COLUMN'")
    }
    expect(await discoverSqlServer(writer, FIXTURE_SCOPE)).toEqual(before)
  })

  // HAS_PERMS_BY_NAME parses the column it is asked about as an identifier
  // (B7). `group` is a reserved word that happens to answer either way;
  // `it's [odd]` raw answers NULL, which this adapter refuses as a defect, so
  // an unquoted name fails this test by throwing. Column UPDATE grants mark
  // exactly those columns, and INSERT, which SQL Server grants on objects
  // only, marks every column. With no SELECT, the UPDATE the snapshot allows
  // succeeds -- with a NULL cast; `set c = c` would read c (B12).
  test('column UPDATE grants mark exactly those columns, INSERT marks every one, and odd names are answered', async () => {
    await asOwner('create schema quoting', "create table quoting.[it's [odd]]] (id int not null constraint pk_odd primary key, [group] int null, [it's [odd]]] int null, amount int null)")
    const pool = await connectAs('probe_quoting', [
      "grant insert on quoting.[it's [odd]]] to probe_quoting",
      "grant update ([group], [it's [odd]]]) on quoting.[it's [odd]]] to probe_quoting",
    ])
    const snapshot = await discoverSqlServer(pool, { schemas: ['quoting'] })
    const no = { select: false, insert: true, update: false }
    const yes = { select: false, insert: true, update: true }
    expect(accessOf(object(snapshot, 'quoting', "it's [odd]"))).toEqual({ id: no, group: yes, "it's [odd]": yes, amount: no })
    expect((await probe(pool, snapshot)).disagreements).toEqual([])
    // SQL Server refuses a column list on an INSERT grant, which is why INSERT is the object's.
    await expect(owner.request().batch("grant insert ([group]) on quoting.[it's [odd]]] to probe_quoting")).rejects.toMatchObject({ number: 1020 })
  })

  // Column and object permissions combine by the server's precedence, and the
  // snapshot must report the precedence the server applies, not one a reader
  // of the documentation would guess (B8): a column GRANT under a table DENY
  // is a yes, a column DENY under a table GRANT a no, and a table GRANT made
  // after a column DENY removes the DENY. Each is confirmed with a real read.
  test.each([
    ['a table DENY with a column GRANT', 'probe_b8a', ['deny select on precedence.t to probe_b8a', 'grant select on precedence.t (c) to probe_b8a'], { c: true, d: false }],
    ['a table GRANT with a column DENY', 'probe_b8b', ['grant select on precedence.t to probe_b8b', 'deny select on precedence.t (d) to probe_b8b'], { c: true, d: false }],
    ['a column DENY, then a table GRANT', 'probe_b8c', ['deny select on precedence.t (d) to probe_b8c', 'grant select on precedence.t to probe_b8c'], { c: true, d: true }],
  ] as const)('%s: the snapshot reports what a read then does', async (_title, login, grants, expected) => {
    await asOwner("if schema_id('precedence') is null exec ('create schema precedence')")
    await asOwner("if object_id('precedence.t') is null create table precedence.t (c int null, d int null)")
    const pool = await connectAs(login, grants)
    const t = object(await discoverSqlServer(pool, { schemas: ['precedence'] }), 'precedence', 't')
    expect(Object.fromEntries(t.columns.map((column) => [column.name, column.access.select]))).toEqual(expected)
    for (const [column, readable] of Object.entries(expected)) {
      const read = pool.request().query(`select ${column} from precedence.t`)
      if (readable) await expect(read).resolves.toBeDefined()
      else await expect(read).rejects.toMatchObject({ number: 230 })
    }
  })

  // Whose snapshot it is (B13). A login mapped to a user of another name
  // reports both, and the user is what privileges and policies are evaluated
  // for: two users with identical grants fingerprint differently, so an
  // account change is never hidden behind drift's fast path. A second
  // sysadmin login is dbo in the database, as sa is, and fingerprints as the
  // owner does: a login is not a principal, and renaming one is not drift.
  test('a snapshot names its user and its login, and only the user moves the fingerprint', async () => {
    const forms = await connectAs('app_login_2026', ['grant view definition to forms_user'], 'forms_user')
    const other = await connectAs('other_login_2026', ['grant view definition to other_user'], 'other_user')
    const asForms = await discoverSqlServer(forms, FIXTURE_SCOPE)
    const asOther = await discoverSqlServer(other, FIXTURE_SCOPE)
    expect(asForms.account).toEqual({ user: 'forms_user', login: 'app_login_2026' })
    expect(asOther.objects).toEqual(asForms.objects)
    expect(asOther.gaps).toEqual(asForms.gaps)
    expect(asOther.fingerprint).not.toBe(asForms.fingerprint)

    await inMaster(`create login second_sa with password = '${PASSWORD}', check_policy = off`, 'alter server role sysadmin add member second_sa')
    const second = await connect({ ...fixture.admin, user: 'second_sa', password: PASSWORD })
    const asSecond = await discoverSqlServer(second, FIXTURE_SCOPE)
    const asOwnerSnapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
    expect(asSecond.account).toEqual({ user: 'dbo', login: 'second_sa' })
    expect(asSecond.fingerprint).toBe(asOwnerSnapshot.fingerprint)
  })

  // An account with INSERT on sales.shipment and nothing else creates a row
  // numbered by the sequence default, though it holds no permission on the
  // sequence: SQL Server does not check one that shares the table's owner
  // (B15). PostgreSQL refuses the same for a serial column (B14), which is the
  // engine difference 0027's costs write down; this pins SQL Server's side,
  // so a server that began to check it would be noticed.
  test('INSERT alone creates a row numbered by a sequence default', async () => {
    const pool = await connectAs('probe_shipper', ['grant insert on sales.shipment to probe_shipper'])
    const shipment = object(await discoverSqlServer(pool, FIXTURE_SCOPE), 'sales', 'shipment')
    // Without VIEW DEFINITION the default's text is hidden, so the column
    // reads as an ordinary default, with a defaults gap (0026); its access is
    // the point here.
    expect(shipment.columns.find((column) => column.name === 'id')).toMatchObject({
      hasDefault: true,
      access: { select: false, insert: true, update: false },
    })
    const sequence = await pool.request().query<{ granted: number }>("select has_perms_by_name(N'[sales].[shipment_id]', N'OBJECT', N'UPDATE') as granted")
    expect(sequence.recordset).toEqual([{ granted: 0 }])
    try {
      await pool
        .request()
        .batch("insert into sales.shipment (tenant_id, tracking_no, carrier_code, reference, pickup_time) values (9, 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 1, 'B15', '08:00')")
      const stored = await owner.request().query<{ numbered: number }>('select count(*) as numbered from sales.shipment where tenant_id = 9 and id is not null')
      expect(stored.recordset).toEqual([{ numbered: 1 }])
    } finally {
      await asOwner('delete from sales.shipment where tenant_id = 9')
    }
  })
})

describe('whether a security policy filters what the account sees', () => {
  /**
   * A second policy, in a schema of its own, filtering sales.employee for
   * nobody -- its predicate passes every row; what matters is that it exists.
   * Made and dropped by each test that needs it, so the fixture's policy on
   * customer stays the only one elsewhere.
   */
  async function withGuard<T>(state: 'on' | 'off', run: () => Promise<T>): Promise<T> {
    await asOwner(
      'create schema guard',
      'create function guard.fn_every(@id int) returns table with schemabinding as return select 1 as visible',
      `create security policy guard.employee_guard add filter predicate guard.fn_every(id) on sales.employee with (state = ${state})`,
    )
    try {
      return await run()
    } finally {
      await asOwner('drop security policy guard.employee_guard', 'drop function guard.fn_every', 'drop schema guard')
    }
  }

  const rowSecurityOf = (snapshot: MetadataSnapshot, name: string) => object(snapshot, 'sales', name).rowSecurity
  const scopeGap = (detail: RegExp) => ({ subject: { kind: 'scope' }, aspect: 'row-security', detail: expect.stringMatching(detail) })

  // A policy lives in one schema and filters a table in another. VIEW
  // DEFINITION on the table's schema does not list it (B10b), so employee is
  // UNKNOWN there -- "none" would be the snapshot vouching for a table a
  // policy it cannot see is filtering. VIEW DEFINITION on the database lists
  // it, and employee APPLIES.
  test('a policy in another schema is unknown to a schema grant and applies under a database grant', async () => {
    const schemaViewer = await connectAs('probe_guard_schema', ['grant view definition on schema::sales to probe_guard_schema'])
    const databaseViewer = await connectAs('probe_guard_database', ['grant view definition to probe_guard_database'])
    await withGuard('on', async () => {
      const bySchema = await discoverSqlServer(schemaViewer, FIXTURE_SCOPE)
      expect(rowSecurityOf(bySchema, 'employee')).toBe('unknown')
      expect(bySchema.gaps).toEqual([scopeGap(/lacks VIEW DEFINITION on the database/)])
      const byDatabase = await discoverSqlServer(databaseViewer, FIXTURE_SCOPE)
      expect(rowSecurityOf(byDatabase, 'employee')).toBe('applies')
      expect(byDatabase.gaps).toEqual([])
    })
  })

  // A disabled policy filters nothing. Reported as applying, it would put an
  // access note on a form whose rows nothing hides.
  test('a disabled policy reads as none', async () => {
    const viewer = await connectAs('probe_disabled', ['grant view definition to probe_disabled'])
    await withGuard('off', async () => {
      expect(rowSecurityOf(await discoverSqlServer(viewer, FIXTURE_SCOPE), 'employee')).toBe('none')
    })
  })

  // VIEW SECURITY DEFINITION sounds like the grant that shows security
  // policies, and shows none (B10d). Accepted as proof, it would report the
  // fixture's policy on customer as "none" to an account it filters.
  test('VIEW SECURITY DEFINITION alone does not settle row security', async () => {
    const pool = await connectAs('probe_security_viewer', ['grant view security definition to probe_security_viewer', 'grant select on sales.customer to probe_security_viewer'])
    const held = await pool.request().query<{ held: number }>("select has_perms_by_name(quotename(db_name()), N'DATABASE', N'VIEW SECURITY DEFINITION') as held")
    expect(held.recordset).toEqual([{ held: 1 }])
    const snapshot = await discoverSqlServer(pool, FIXTURE_SCOPE)
    expect(rowSecurityOf(snapshot, 'customer')).toBe('unknown')
    expect(snapshot.gaps).toContainEqual(scopeGap(/lacks VIEW DEFINITION on the database/))
  })

  // The holes in the database grant (B10e, B10f). A deny on the policy itself
  // hides it and is counted as a denied object. A deny on the policy's SCHEMA
  // hides it too, while VIEW DEFINITION on the database still reads 1 and the
  // object count reads 0: without counting schema denies, employee would be
  // reported "none" under a policy that filters it.
  test.each([
    ['its schema', 'probe_deny_schema', 'deny view definition on schema::guard to probe_deny_schema', 'employee', /denied VIEW DEFINITION or CONTROL on 1 schema/],
    ['the policy', 'probe_deny_policy', 'deny view definition on object::guard.employee_guard to probe_deny_policy', 'employee', /denied VIEW DEFINITION or CONTROL on 1 object/],
  ] as const)('a deny on %s under a database grant leaves row security unknown, and says why', async (_title, login, deny, name, reason) => {
    const pool = await connectAs(login, [`grant view definition to ${login}`])
    await withGuard('on', async () => {
      await asOwner(deny)
      const snapshot = await discoverSqlServer(pool, FIXTURE_SCOPE)
      expect(rowSecurityOf(snapshot, name)).toBe('unknown')
      // The fixture's policy is still visible, and still applies.
      expect(rowSecurityOf(snapshot, 'customer')).toBe('applies')
      expect(snapshot.gaps.filter((gap) => gap.aspect === 'row-security')).toEqual([scopeGap(reason)])
    })
  })

  // A DENY never binds a sysadmin or dbo, though a deny made to `public`
  // names a role they are, by IS_MEMBER, members of. Counted for them, the
  // owner -- who sees every policy -- would carry a row-security gap saying
  // it is denied a schema, and every object without a policy would read
  // `unknown`. The same deny still binds an ordinary account with the
  // database grant, which must stay `unknown`.
  test('a schema deny to public leaves the owner none and gapless, and an ordinary viewer unknown', async () => {
    const viewer = await connectAs('probe_public_deny', ['grant view definition to probe_public_deny'])
    await withGuard('on', async () => {
      await asOwner('deny view definition on schema::guard to public')
      const asOwnerSnapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
      expect(asOwnerSnapshot.gaps).toEqual([])
      expect(rowSecurityOf(asOwnerSnapshot, 'employee')).toBe('applies')
      expect(rowSecurityOf(asOwnerSnapshot, 'order')).toBe('none')
      const asViewer = await discoverSqlServer(viewer, FIXTURE_SCOPE)
      expect(rowSecurityOf(asViewer, 'employee')).toBe('unknown')
      expect(asViewer.gaps.filter((gap) => gap.aspect === 'row-security')).toEqual([scopeGap(/denied VIEW DEFINITION or CONTROL on 1 schema/)])
    })
  })

  // HAS_PERMS_BY_NAME parses the database name too: in a database called
  // `it's [odd] db` the raw DB_NAME() answers NULL and QUOTENAME's answers 1
  // (B9). Unquoted, every account there would carry a row-security gap that
  // its grant should have settled.
  test("a database whose name needs quoting is checked by its quoted name", async () => {
    await inMaster("create database [it's [odd]] db]")
    await new mssql.ConnectionPool({ ...fixture.admin, database: "it's [odd] db" }).connect().then(async (pool) => {
      try {
        await pool.request().batch('create table dbo.t (id int not null constraint pk_t primary key)')
        await pool.request().batch(`create user probe_odd_db for login ${WRITER.user}`)
        await pool.request().batch('grant view definition to probe_odd_db')
      } finally {
        await pool.close()
      }
    })
    const pool = await connect({ ...fixture.writer, database: "it's [odd] db" })
    const snapshot = await discoverSqlServer(pool, { schemas: ['dbo'] })
    expect(snapshot.account).toEqual({ user: 'probe_odd_db', login: WRITER.user })
    expect(object(snapshot, 'dbo', 't').rowSecurity).toBe('none')
    expect(snapshot.gaps).toEqual([])
  })
})
