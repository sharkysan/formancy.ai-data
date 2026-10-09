import { findObject } from '@formancy/data-core'
import type { MetadataSnapshot, ObjectMeta, RecordColumn, RecordOutcome, RecordTarget, RowFilters } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { accessDisagreements, covers, FIXTURE_SCOPE, MODEL_CASES, renamedColumn, startPostgresFixture, WRITER, WRITER_ACCESS } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/**
 * What an account may do, and whether row-level security applies to it, as
 * discovery reports it (0027) -- against REAL PostgreSQL, loaded with the
 * shared fixture, as its superuser owner, `formancy_reader` and
 * `formancy_writer`, and as roles this file creates for one question each.
 *
 * Schema `probe` holds what the fixture does not: a column-by-column grant
 * with an UPDATE that has no SELECT, a generated column, a view, a serial and
 * an identity, a policed table the writer may write. Schema `sealed` grants
 * a table to an account with no USAGE on the schema. Neither touches `sales`,
 * which stays exactly what the model describes.
 */
let fixture: PostgresFixture
let owner: Sql
let reader: Sql
let writer: Sql

/** A connection URI for another login of the same database. */
function as(user: string, password: string): string {
  const url = new URL(fixture.admin)
  url.username = user
  url.password = password
  return url.toString()
}

/** Every connection a test opens, closed once at the end. */
const opened: Sql[] = []
function connect(url: string, options: postgres.Options<Record<string, postgres.PostgresType>> = {}): Sql {
  const sql = postgres(url, { onnotice: () => {}, ...options })
  opened.push(sql)
  return sql
}

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = connect(fixture.admin)
  reader = connect(fixture.reader)
  writer = connect(fixture.writer)
  await owner.unsafe(`
    create schema probe;
    grant usage on schema probe to formancy_reader, formancy_forms;
    create table probe.colgrant (
      id integer primary key,
      visible text,
      hidden text,
      blind text,
      total integer generated always as (id * 2) stored
    );
    grant select (id, visible, total) on probe.colgrant to formancy_reader;
    grant insert (visible) on probe.colgrant to formancy_reader;
    -- UPDATE without SELECT: SET c = NULL is allowed, SET c = c is not (B6).
    grant update (blind) on probe.colgrant to formancy_reader;
    create view probe.colview as select id, visible from probe.colgrant;
    grant select on probe.colview to formancy_writer;

    create table probe.serialed (id serial primary key, label text);
    create table probe.numbered (id integer generated always as identity primary key, label text);
    grant select, insert on probe.serialed, probe.numbered to formancy_forms;

    create table probe.policed (id integer primary key, tenant_id integer not null, note text, version bigint not null default 1);
    insert into probe.policed values (1, 1, 'ours', 1), (2, 2, 'theirs', 1);
    alter table probe.policed enable row level security;
    create policy policed_tenant on probe.policed using (current_user <> 'formancy_writer' or tenant_id = 1);
    grant select, insert, update on probe.policed to formancy_forms;

    create schema sealed;
    create table sealed.inside (id integer primary key, note text);
    grant select, insert, update on sealed.inside to formancy_writer;
  `)
})

afterAll(async () => {
  await Promise.all(opened.map((sql) => sql.end()))
  await fixture?.stop()
})

function described(snapshot: MetadataSnapshot, schema: string, name: string): ObjectMeta {
  const found = findObject(snapshot, { schema, name })
  if (found === undefined) throw new Error(`${schema}.${name} is not in the snapshot`)
  return found
}

/** What each column of an object may do, as `name:siu` with a dash for each capability it lacks. */
function capabilities(object: ObjectMeta): string[] {
  return object.columns.map(({ name, access }) => `${name}:${access.select ? 's' : '-'}${access.insert ? 'i' : '-'}${access.update ? 'u' : '-'}`)
}

describe('the writer, the order form’s account', () => {
  // The fixture's whole promise about the writer (data-fixtures, access.ts):
  // it holds every grant through the role formancy_forms, so an adapter that
  // asked about the login's own grants only would report nothing here. On
  // PostgreSQL the application maintains row_version, and the writer may
  // update it; SQL Server's writer may not.
  test('agrees with WRITER_ACCESS, row_version updatable, with no gap, as itself', covers('postgres', MODEL_CASES.writerAccess), async () => {
    const snapshot = await discoverPostgres(writer, FIXTURE_SCOPE)
    expect(accessDisagreements(snapshot, WRITER_ACCESS)).toEqual([])
    expect(snapshot.gaps).toEqual([])
    expect(snapshot.account).toEqual({ user: WRITER.user, login: WRITER.user })
    expect(capabilities(described(snapshot, 'sales', 'order'))).toContain('row_version:siu')
    expect(capabilities(described(snapshot, 'sales', 'order'))).toContain('amount:si-')
  })

  // B5: postgres.js can start a session under another role. current_user is
  // then that role, and it is the principal privileges and policies are
  // evaluated for -- the writer's customer policy compares current_user, and
  // under the role reads both tenants. So the user moves the fingerprint and
  // the login does not: everything else in the two snapshots is the same.
  test('under a session role, the user is the role and the login the writer, and only the user is hashed', async () => {
    const asRole = connect(fixture.writer, { connection: { role: 'formancy_forms' } })
    const [own, viaRole] = await Promise.all([discoverPostgres(writer, FIXTURE_SCOPE), discoverPostgres(asRole, FIXTURE_SCOPE)])
    expect(viaRole.account).toEqual({ user: 'formancy_forms', login: WRITER.user })
    expect(viaRole.objects).toEqual(own.objects)
    expect(viaRole.fingerprint).not.toBe(own.fingerprint)
    // What the server does with that principal: the policy no longer names it.
    expect(await asRole`select tenant_id from sales.customer order by tenant_id`).toEqual([{ tenant_id: 1 }, { tenant_id: 2 }])
  })
})

describe('a column renamed in the database', () => {
  // The studio's drift gate stands a snapshot renamed in place for a
  // database whose column was renamed; if discovery reported a rename
  // differently -- a new ordinal, lost column grants -- the gate would walk
  // a state no database reaches. As the writer, whose UPDATE of notes is a
  // column grant: what a column added in its place would not have. Renamed
  // back before the next test, which expects the fixture.
  test('is discovered as renamedColumn says: the same column, ordinal and grants included, under its new name', async () => {
    const order = { schema: 'sales', name: 'order' }
    const before = await discoverPostgres(writer, FIXTURE_SCOPE)
    expect(capabilities(described(before, 'sales', 'order'))).toContain('notes:siu')
    await owner`alter table sales."order" rename column notes to memo`
    try {
      expect(await discoverPostgres(writer, FIXTURE_SCOPE)).toEqual(renamedColumn(before, order, 'notes', 'memo'))
    } finally {
      await owner`alter table sales."order" rename column memo to notes`
    }
    expect(await discoverPostgres(writer, FIXTURE_SCOPE)).toEqual(before)
  })
})

/** The server's answer to one statement: `ok`, or the SQLSTATE it refused with. */
type Answer = 'ok' | string

const ROLLED_BACK = new Error('rolled back')

/**
 * Ask the server, in a savepoint that is always rolled back, whether this
 * account may run each statement. A statement that touches no row still goes
 * through the privilege check, which happens before execution.
 */
async function answers(sql: Sql, statements: readonly string[]): Promise<Answer[]> {
  const out: Answer[] = []
  await sql
    .begin(async (tx) => {
      for (const statement of statements) {
        try {
          await tx.savepoint(async (sp) => {
            await sp.unsafe(statement)
            throw ROLLED_BACK
          })
        } catch (error) {
          out.push(error === ROLLED_BACK ? 'ok' : String((error as { code?: unknown }).code))
        }
      }
      throw ROLLED_BACK
    })
    .catch((error: unknown) => {
      if (error !== ROLLED_BACK) throw error
    })
  return out
}

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`

interface Probe {
  statement: string
  /** What the snapshot says the account may do, which the server must agree with. */
  claimed: boolean
}

/**
 * One statement per capability per column. Writes name the column alone and
 * assign a NULL of its type, never `c = c`, which also needs SELECT (B6).
 * Writes skip a generated or identity-always column, which the server refuses
 * with 428C9 before it checks a privilege, and a view, which it refuses with
 * 55000 when the view is not updatable -- both answers about the column, not
 * about the account.
 */
function probes(snapshot: MetadataSnapshot): Probe[] {
  const out: Probe[] = []
  for (const object of snapshot.objects) {
    const table = `${quote(object.ref.schema)}.${quote(object.ref.name)}`
    for (const column of object.columns) {
      const name = quote(column.name)
      out.push({ statement: `select ${name} from ${table} where false`, claimed: column.access.select })
      if (object.kind === 'view' || column.generated === 'computed' || column.generated === 'identity-always') continue
      const value = `null::${column.databaseType}`
      out.push({ statement: `update ${table} set ${name} = ${value} where false`, claimed: column.access.update })
      out.push({ statement: `insert into ${table} (${name}) select ${value} where false`, claimed: column.access.insert })
    }
  }
  return out
}

describe('every capability the snapshot reports is the answer the database gives', () => {
  // The claim the whole of 0027 rests on: a column the snapshot says may be
  // written is one the server lets this account write, and one it says may
  // not is refused 42501 -- for the account that may do everything, the one
  // that may read one table, and the one whose grants are column by column
  // and held through a role. Any other answer (a parse error from a type
  // spelling, an RLS refusal) is a disagreement too, so the probe cannot pass
  // by being refused for the wrong reason.
  test.each([
    ['the owner', () => owner],
    ['the reader', () => reader],
    ['the writer', () => writer],
  ])('as %s', async (_who, account) => {
    const sql = account()
    const snapshot = await discoverPostgres(sql, { schemas: ['sales', 'probe', 'sealed'] })
    const asked = probes(snapshot)
    const answered = await answers(sql, asked.map((probe) => probe.statement))
    const disagreements = asked.flatMap(({ statement, claimed }, index) => {
      const answer = answered[index]
      const agrees = claimed ? answer === 'ok' : answer === '42501'
      return agrees ? [] : [`${statement}: the snapshot says ${claimed ? 'yes' : 'no'}, the server answered ${String(answer)}`]
    })
    expect(disagreements).toEqual([])
    // Not vacuous: hundreds of statements, and for a restricted account both answers.
    expect(asked.length).toBeGreaterThan(100)
    if (sql !== owner) expect(new Set(answered)).toEqual(new Set(['ok', '42501']))
  })
})

describe('privileges through roles', () => {
  beforeAll(async () => {
    await owner.unsafe(`
      create role inh_target nologin;
      grant usage on schema probe to inh_target;
      grant select on probe.numbered to inh_target;
      create role inh_none login password 'inherit-false-password';
      create role inh_full login password 'inherit-true-password';
      grant inh_target to inh_none with inherit false;
      grant inh_target to inh_full with inherit true;
    `)
  })

  // PostgreSQL 16 made inheritance a property of each membership (B4). A
  // member WITH INHERIT FALSE holds the role's privileges only after SET
  // ROLE, which this module never issues, so the read is refused and the
  // snapshot must say no -- while an inheriting member's says yes. An
  // adapter that walked pg_auth_members itself would get the first wrong.
  test('a WITH INHERIT FALSE membership reports no capability, and the read is refused', async () => {
    const none = connect(as('inh_none', 'inherit-false-password'))
    const full = connect(as('inh_full', 'inherit-true-password'))
    const [withoutInherit, withInherit] = await Promise.all([discoverPostgres(none, { schemas: ['probe'] }), discoverPostgres(full, { schemas: ['probe'] })])
    expect(capabilities(described(withoutInherit, 'probe', 'numbered'))).toEqual(['id:---', 'label:---'])
    expect(capabilities(described(withInherit, 'probe', 'numbered'))).toEqual(['id:s--', 'label:s--'])
    await expect(none`select id from probe.numbered`).rejects.toMatchObject({ code: '42501' })
    await expect(full`select id from probe.numbered`).resolves.toEqual([])
  })
})

describe('row-level security', () => {
  beforeAll(async () => {
    await owner.unsafe(`
      create role rls_owner login password 'rls-owner-password';
      create role rls_bypass login bypassrls password 'rls-bypass-password';
      create schema rls;
      create table rls.kept (id integer primary key, tenant_id integer not null);
      insert into rls.kept values (1, 1), (2, 2);
      alter table rls.kept enable row level security;
      create policy kept_tenant on rls.kept using (tenant_id = 1);
      alter table rls.kept owner to rls_owner;
      grant usage on schema rls to rls_owner, rls_bypass, formancy_reader;
      grant select on rls.kept to rls_bypass, formancy_reader;
    `)
  })

  // The fixture's policy binds the writer, and every other role sees both
  // tenants -- except the superuser owner, which row security never binds.
  // row_security_active answers for the account (B1), so the snapshots say
  // exactly that, and the reads agree.
  test('applies to the writer and the reader on customer, and not to the superuser owner', async () => {
    const [asOwner, asReader, asWriter] = await Promise.all([discoverPostgres(owner, FIXTURE_SCOPE), discoverPostgres(reader, FIXTURE_SCOPE), discoverPostgres(writer, FIXTURE_SCOPE)])
    expect(described(asOwner, 'sales', 'customer').rowSecurity).toBe('none')
    expect(described(asReader, 'sales', 'customer').rowSecurity).toBe('applies')
    expect(described(asWriter, 'sales', 'customer').rowSecurity).toBe('applies')
    for (const snapshot of [asOwner, asReader, asWriter]) {
      expect(snapshot.objects.filter((object) => object.ref.name !== 'customer').map((object) => object.rowSecurity)).toEqual(Array(6).fill('none'))
    }
    expect(await writer`select tenant_id from sales.customer`).toEqual([{ tenant_id: 1 }])
    expect(await owner`select tenant_id from sales.customer order by tenant_id`).toEqual([{ tenant_id: 1 }, { tenant_id: 2 }])
  })

  // A table's owner is exempt from its policies unless FORCE ROW LEVEL
  // SECURITY is set, and a BYPASSRLS role always is (B1+). An adapter that
  // read relrowsecurity from pg_class would say `applies` to both, and the
  // form would carry a warning about rows that are not hidden; one that
  // ignored relforcerowsecurity would miss the owner who is bound.
  test('the owner without FORCE and a BYPASSRLS role get none; the owner with FORCE and a plain grantee get applies', async () => {
    const tableOwner = connect(as('rls_owner', 'rls-owner-password'))
    const bypass = connect(as('rls_bypass', 'rls-bypass-password'))
    const rowSecurity = async (sql: Sql) => described(await discoverPostgres(sql, { schemas: ['rls'] }), 'rls', 'kept').rowSecurity
    expect(await rowSecurity(tableOwner)).toBe('none')
    expect(await rowSecurity(bypass)).toBe('none')
    expect(await rowSecurity(reader)).toBe('applies')
    await owner`alter table rls.kept force row level security`
    try {
      expect(await rowSecurity(tableOwner)).toBe('applies')
      expect(await tableOwner`select id from rls.kept`).toEqual([{ id: 1 }])
    } finally {
      await owner`alter table rls.kept no force row level security`
    }
    expect(await bypass`select id from rls.kept order by id`).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe('what a view does not say', () => {
  beforeAll(async () => {
    await owner.unsafe(`
      create role view_owner login password 'view-owner-password';
      create schema vw;
      create table vw.base (id integer primary key, tenant_id integer not null);
      insert into vw.base values (1, 1);
      create view vw.by_owner as select id from vw.base;
      alter view vw.by_owner owner to view_owner;
      create view vw.by_invoker with (security_invoker = true) as select id from vw.base;
      grant usage on schema vw to view_owner, formancy_reader;
      grant select on vw.by_owner, vw.by_invoker to formancy_reader;
    `)
  })

  // A cost 0027 states rather than removes. The privilege functions answer
  // for the view's own grants; a read through it also needs privileges on
  // the tables behind it -- the view owner's for an ordinary view, the
  // reader's for a security_invoker one -- and discovery does not follow a
  // view to its tables. So the snapshot says SELECT and the read is refused.
  // This pins that, so the day an adapter follows views the test fails and
  // the record, the README and the generator's view note are changed with it.
  test("a view's columns say SELECT while a read through it is refused for its tables' privileges", async () => {
    const snapshot = await discoverPostgres(reader, { schemas: ['vw'] })
    expect(capabilities(described(snapshot, 'vw', 'by_owner'))).toEqual(['id:s--'])
    expect(capabilities(described(snapshot, 'vw', 'by_invoker'))).toEqual(['id:s--'])
    expect(capabilities(described(snapshot, 'vw', 'base'))).toEqual(['id:---', 'tenant_id:---'])
    await expect(reader`select id from vw.by_owner`).rejects.toMatchObject({ code: '42501' })
    await expect(reader`select id from vw.by_invoker`).rejects.toMatchObject({ code: '42501' })
    // The owner's privilege is what the ordinary view needed: granted, the read succeeds and the snapshot is unchanged.
    await owner`grant select on vw.base to view_owner`
    try {
      expect(await reader`select id from vw.by_owner`).toEqual([{ id: 1 }])
      expect((await discoverPostgres(reader, { schemas: ['vw'] })).fingerprint).toBe(snapshot.fingerprint)
    } finally {
      await owner`revoke select on vw.base from view_owner`
    }
  })
})

const TEXT = { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false } as const
const INT32 = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const

function failure(outcome: RecordOutcome): string {
  return outcome.ok ? 'ok' : outcome.code
}

describe('what the records operations do with what the snapshot reports', () => {
  // The cost 0027 writes down (B14): a serial's default calls nextval(),
  // which needs USAGE on its sequence, and the snapshot describes column
  // privileges only -- so a column it says may be inserted into still makes
  // the create fail. An identity's sequence needs no privilege of the
  // inserter. If PostgreSQL ever checked identity sequences too, or stopped
  // checking serial's, the documented cost would be wrong and this says so.
  test("the writer's create through a serial default is permission-denied, through an identity it succeeds", async () => {
    const snapshot = await discoverPostgres(writer, { schemas: ['probe'] })
    expect(capabilities(described(snapshot, 'probe', 'serialed'))).toEqual(['id:si-', 'label:si-'])
    expect(capabilities(described(snapshot, 'probe', 'numbered'))).toEqual(['id:si-', 'label:si-'])
    const records = createPostgresRecords(writer)
    const create = (name: string) =>
      records.insert({
        target: { table: { schema: 'probe', name }, identity: [{ name: 'id', type: INT32 }], concurrency: null },
        values: [{ name: 'label', type: TEXT, value: 'new' }],
        returning: [{ name: 'id', type: INT32 }],
      })
    expect(failure(await create('serialed'))).toBe('permission-denied')
    expect(await create('numbered')).toEqual({ ok: true, values: { id: '1' }, version: null })
  })

  // Row security only ever makes a form refuse more (B17), which is why drift
  // sends it to review rather than blocking: a write the policy refuses is
  // refused, an update of a row it hides is not-found, and no write is
  // reported done that the table does not hold.
  test('under row security, a refused insert is permission-denied and a hidden row is not-found', async () => {
    const snapshot = await discoverPostgres(writer, { schemas: ['probe'] })
    expect(described(snapshot, 'probe', 'policed').rowSecurity).toBe('applies')
    const records = createPostgresRecords(writer)
    const id: RecordColumn = { name: 'id', type: INT32 }
    const target = { table: { schema: 'probe', name: 'policed' }, identity: [id], concurrency: { kind: 'version-column', column: 'version' } } as const satisfies RecordTarget
    const everyRow: RowFilters = { kind: 'unrestricted' }
    const row = (key: string, tenant: string) => [
      { ...id, value: key },
      { name: 'tenant_id', type: INT32, value: tenant },
    ]
    const update = (key: string) =>
      records.update({ target, key: [{ ...id, value: key }], set: [{ name: 'note', type: TEXT, value: 'changed' }], expectedVersion: '1', filters: everyRow, returning: [] })

    expect(failure(await records.insert({ target, values: row('3', '2'), returning: [] }))).toBe('permission-denied')
    expect(failure(await records.read({ target, key: [{ ...id, value: '2' }], columns: [id], filters: everyRow }))).toBe('not-found')
    expect(failure(await update('2'))).toBe('not-found')
    expect(failure(await update('1'))).toBe('ok')
    expect(await owner`select id, note from probe.policed order by id`).toEqual([
      { id: 1, note: 'changed' },
      { id: 2, note: 'theirs' },
    ])
  })
})
