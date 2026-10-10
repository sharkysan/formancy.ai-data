import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConnectionConfig, IdentityVerifier } from '@formancy/data-server'
import mssql from 'mssql'
import { afterAll, afterEach, beforeAll, describe, expect, inject, test } from 'vitest'
import { load, mount, pane, RENDERERS, signIn, statuses } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import type { Engine, Held, Owners, Sent } from './test-stamped.js'
import { connectOwners, createStamped, dropStamped, ENGINE_NAME, fetchThrough, heldStamped, holdsFraction, insertStamped, updatesIn } from './test-stamped.js'

/*
 * An instant and a time saved through the host page itself (0040): `Host`,
 * both panes, both renderers, Save pressed by role and name, against the
 * real server over real PostgreSQL 17 and SQL Server 2022 -- nothing between
 * the person and the server is a stand-in, the renderers' own controls
 * included. `temporal-round-trip.test.ts` holds the same through the session
 * and the client; this file holds what a person meets.
 *
 * The failures they prevent, each seen on main before 0040, in both
 * renderers:
 * - SQL Server: the page said "Saved." and the stored instant had lost its
 *   fraction and the time its seconds, edited or not.
 * - PostgreSQL: after Save the fields were `aria-invalid` with the
 *   description `shape`, and no update was sent -- also when the account may
 *   not write the columns, where the generator disables the fields and the
 *   person cannot edit their way out, and when the policy alone withholds
 *   them.
 * And what 0040 decides that a person sees: a form whose only change was an
 * unedited instant and time is not saved and says why, with nothing written;
 * and an instant changed in React's datetime control is saved as the control
 * holds it, a local minute.
 *
 * The clerk's policy is derived from the bindings as the host suites'
 * clerkPolicy derives it. Tables, a login and a role of this file's own, in
 * schema `temporal_round_trip_page`, made in `beforeAll` and dropped in
 * `afterAll`. Grown from the second reproduction of the gap analysis's
 * section 3.2 item 1, which this file replaces.
 */

const SCHEMA = 'temporal_round_trip_page'
const WRITER = 'temporal_page_writer'
// A fixture constant for a container that lives for one run, as the fixture's own restricted logins' are.
const WRITER_PASSWORD = 'Temporal-Page-Writer-1!'
const TOKENS = { admin: 'temporal-page-administrator', clerk: 'temporal-page-clerk-tenant-1' } as const

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-1', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'ERR_JWS_INVALID' }
}

/**
 * Who stands between the clerk and the two temporal columns, one form each.
 * `owner`: nobody -- the fixture's owner may write every column, and the
 * clerk every field the generator made writable. `writer`: the database --
 * an account that may read the table and UPDATE only the note (and
 * PostgreSQL's version column) and INSERT nothing, so the generator disables
 * both temporal fields. `policy`: the policy alone, over the owner's
 * connection, which leaves both fields enabled. `temporal`: the owner's
 * connection, with the note withheld by the policy, so the temporal fields
 * are the only ones the clerk writes.
 */
type Account = 'owner' | 'writer' | 'policy' | 'temporal'
const WITHHELD: Record<Account, readonly string[]> = { owner: [], writer: [], policy: ['created_at', 'at_time'], temporal: ['note'] }

/**
 * The host suites' clerkPolicy: every field the bindings write on some
 * operation, less the withheld ones; and every operation the form offers,
 * which for the restricted account is not create.
 */
function clerkPolicy(fields: readonly FieldBinding[], offered: { create?: unknown; update?: unknown }, withhold: readonly string[]): FormPolicy {
  const writes = (binding: FieldBinding) => (binding.writes.create || binding.writes.update) && !withhold.includes(binding.field)
  return {
    version: 1,
    operations: { read: ['clerk'], create: offered.create === false ? [] : ['clerk'], update: offered.update === false ? [] : ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: writes(binding) ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
  }
}

let app: Awaited<ReturnType<typeof createDataServer>>
let registryClose: () => Promise<void>
let root: string
let owners: Owners
const sent: Sent[] = []
let fetchThroughServer: typeof fetch

const formId = (engine: Engine, account: Account) => `${engine}-stamped-page-${account}`
/** The zoneless precedent's form: see the last describe. */
const localFormId = (engine: Engine) => `${engine}-local-page`

beforeAll(async () => {
  const { pg, ms } = inject('databases')
  owners = await connectOwners()
  await createStamped(owners, SCHEMA)
  await owners.pg.unsafe(`
    create table ${SCHEMA}.local_stamped (
      id integer generated always as identity constraint pk_${SCHEMA}_local primary key,
      tenant_id integer not null,
      note varchar(50) not null,
      local_at timestamp(6) not null default localtimestamp,
      row_version bigint not null default 1
    );
    create role ${WRITER} login password '${WRITER_PASSWORD}';
    grant usage on schema ${SCHEMA} to ${WRITER};
    grant select on ${SCHEMA}.stamped to ${WRITER};
    grant update (note, row_version) on ${SCHEMA}.stamped to ${WRITER};
  `)
  await owners.ms.request().batch(`
    create table ${SCHEMA}.local_stamped (
      id int identity constraint pk_${SCHEMA}_local primary key,
      tenant_id int not null,
      note nvarchar(50) not null,
      local_at datetime2(7) not null constraint df_${SCHEMA}_local_at default sysdatetime(),
      rv rowversion
    )
  `)
  await owners.ms.request().batch(`
    create login ${WRITER} with password = '${WRITER_PASSWORD}', check_policy = off;
    create user ${WRITER} for login ${WRITER};
    grant select on ${SCHEMA}.stamped to ${WRITER};
    grant update (note) on ${SCHEMA}.stamped to ${WRITER};
    grant view definition to ${WRITER};
  `)

  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: [SCHEMA], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: [SCHEMA], tls: { enabled: false, trustServerCertificate: true } },
    { id: 'pgw', kind: 'postgres', ...pg, user: WRITER, password: 'env:WRITER_PASSWORD', schemas: [SCHEMA], tls: { enabled: false } },
    { id: 'msw', kind: 'sqlserver', ...ms, user: WRITER, password: 'env:WRITER_PASSWORD', schemas: [SCHEMA], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const registry = createConnectionRegistry(connections, DRIVER_FACTORIES, { env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password, WRITER_PASSWORD }, readFile: async () => '' })
  registryClose = () => registry.close()
  root = await mkdtemp(join(tmpdir(), 'formancy-data-temporal-page-'))
  const store = createFileConfigurationStore(root)
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  fetchThroughServer = fetchThrough(app, sent)

  const admin = async (url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const reply = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${TOKENS.admin}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${url} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json<Record<string, unknown>>()
  }
  const forms = (['pg', 'ms'] as const).flatMap((engine) => [
    ...(Object.keys(WITHHELD) as Account[]).map((account) => ({ engine, id: formId(engine, account), table: 'stamped', connection: account === 'writer' ? `${engine}w` : engine, withhold: WITHHELD[account] })),
    { engine, id: localFormId(engine), table: 'local_stamped', connection: engine, withhold: [] as readonly string[] },
  ])
  for (const { engine, id, table, connection, withhold } of forms) {
    const { form, bindings, snapshot, generation } = (await admin('/v1/form-proposals', {
      connection,
      root: { schema: SCHEMA, name: table },
      formId: id,
      title: 'Stamped',
      lookups: [],
      // The tenant comes from the token, as the row filter says: pinned, so the generator never makes it a field anybody writes.
      pinned: ['tenant_id'],
      ...(engine === 'pg' ? { versionColumn: 'row_version' } : {}),
    })) as { form: unknown; bindings: { fields: FieldBinding[]; operations: { create?: unknown; update?: unknown } }; snapshot: unknown; generation: unknown }
    await admin(`/v1/forms/${id}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy: clerkPolicy(bindings.fields, bindings.operations, withhold), snapshot },
    })
  }
})

afterAll(async () => {
  await app?.close()
  await registryClose?.()
  if (owners !== undefined) {
    await dropStamped(owners, SCHEMA, ['local_stamped'])
    await owners.pg.unsafe(`drop role if exists ${WRITER}`)
    await owners.ms.request().batch(`drop user if exists ${WRITER}`)
    await owners.ms.request().batch(`if exists (select 1 from sys.server_principals where name = '${WRITER}') drop login ${WRITER}`)
    await owners.pg.end()
    await owners.ms.close()
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

afterEach(cleanup)

/** One pane's white paper, named for the document and the renderer. */
function paper(renderer: RendererName): HTMLElement {
  return within(pane(renderer)).getByRole('form', { name: `Stamped, ${renderer}` })
}

/** A control by its exact accessible name; by label, because datetime-local and time inputs have no ARIA role. */
function control(renderer: RendererName, name: string): HTMLInputElement {
  return within(paper(renderer)).getByLabelText(name, { exact: true }) as HTMLInputElement
}

const ARRIVES = { timeout: 20_000 }

/** A tenant-1 row written by the owner, created_at from the column's default, which holds a fraction. */
async function insertDefaulted(engine: Engine): Promise<{ record: string; before: Held }> {
  const record = await insertStamped(owners, SCHEMA, engine, { note: 'as inserted', atTime: engine === 'pg' ? '10:34:56.123456' : '10:34:56.1234567' })
  const before = await heldStamped(owners, SCHEMA, engine, record)
  expect(holdsFraction(before), `the default wrote a fractional instant: ${before.created_at.text}`).toBe(true)
  return { record, before }
}

/** Sign in, open the form, load `record` into both panes, and wait until both show it. */
async function openRecord(id: string, record: string): Promise<User> {
  const user = mount(fetchThroughServer)
  await signIn(user, TOKENS.clerk, id)
  await waitFor(() => {
    for (const renderer of RENDERERS) expect(within(paper(renderer)).queryByLabelText('Note', { exact: true })).not.toBeNull()
  }, ARRIVES)
  await load(user, record)
  await waitFor(() => {
    for (const renderer of RENDERERS) expect(control(renderer, 'Note').value).toBe('as inserted')
  }, ARRIVES)
  return user
}

/** The notice a refused save opens in a pane (the host suites' `notice`), or null. */
function refusal(renderer: RendererName): HTMLElement | null {
  return within(pane(renderer)).queryByRole('region', { name: `${renderer} Not saved` })
}

/**
 * Press Save and wait for the page to settle one way or the other: "Saved."
 * or another sentence on the pane's line, a field the engine marked invalid,
 * which is all a refused submit leaves (it sends nothing), or the notice a
 * refused save opens. Returns what the pane says, which fields are invalid,
 * and every update the page sent.
 */
async function pressSave(user: User, renderer: RendererName) {
  const mark = sent.length
  // A refused submit's only trace is aria-invalid, read off the DOM because the accessibility tree has no query for it.
  const invalid = () => Array.from(paper(renderer).querySelectorAll('input')).filter((element) => element.getAttribute('aria-invalid') === 'true').map((element) => element.labels?.[0]?.textContent ?? element.name)
  await user.click(within(paper(renderer)).getByRole('button', { name: 'Save' }))
  await waitFor(() => {
    const line = statuses(renderer).filter((text) => text !== '' && text !== 'Saving…')
    expect(line.length > 0 || invalid().length > 0 || refusal(renderer) !== null, 'the page settled').toBe(true)
  }, ARRIVES)
  return { statuses: statuses(renderer).filter((text) => text !== ''), invalid: invalid(), notice: refusal(renderer)?.textContent ?? null, updates: updatesIn(sent, mark) }
}

const temporal = (held: Held) => ({ created_at: held.created_at, at_time: held.at_time })

// A writable instant and time through the page, nothing edited and the note
// edited. On main: SQL Server "Saved." over cut values; PostgreSQL both
// fields aria-invalid, and nothing sent.
describe.each(['pg', 'ms'] as const)('%s, both temporal columns writable, through the page', (engine) => {
  for (const renderer of RENDERERS) {
    for (const edited of [false, true]) {
      test(`${ENGINE_NAME[engine]}, ${renderer}: ${edited ? 'the note edited' : 'nothing edited'}, both are byte-identical`, async () => {
        const { record, before } = await insertDefaulted(engine)
        const user = await openRecord(formId(engine, 'owner'), record)
        if (edited) {
          await user.clear(control(renderer, 'Note'))
          await user.type(control(renderer, 'Note'), 'edited on the page')
        }
        const result = await pressSave(user, renderer)
        const after = await heldStamped(owners, SCHEMA, engine, record)
        expect({ invalid: result.invalid, saved: result.statuses.includes('Saved.') }, JSON.stringify(result)).toEqual({ invalid: [], saved: true })
        expect(after.note).toBe(edited ? 'edited on the page' : 'as inserted')
        expect(temporal(after)).toEqual(temporal(before))
      })
    }
  }
})

// Columns the clerk may not write, by the account's privileges (the fields
// disabled) and by the policy alone (enabled): 0022 removes the unchanged
// echo. On main PostgreSQL's engine refused the faithful value first, so the
// note could not be saved -- with the fields disabled, not even by editing
// them.
describe.each(['pg', 'ms'] as const)('%s, both temporal columns the clerk may not write, through the page', (engine) => {
  for (const account of ['writer', 'policy'] as const) {
    for (const renderer of RENDERERS) {
      test(`${ENGINE_NAME[engine]}, ${renderer}: withheld by ${account === 'writer' ? "the account's privileges" : 'the policy'}, the note edited`, async () => {
        const { record, before } = await insertDefaulted(engine)
        const user = await openRecord(formId(engine, account), record)
        expect(control(renderer, 'Created at').disabled, 'disabled by the generator exactly when the account may not write it').toBe(account === 'writer')
        await user.clear(control(renderer, 'Note'))
        await user.type(control(renderer, 'Note'), 'edited, withheld temporal')
        const result = await pressSave(user, renderer)
        const after = await heldStamped(owners, SCHEMA, engine, record)
        expect({ invalid: result.invalid, saved: result.statuses.includes('Saved.') }, JSON.stringify(result)).toEqual({ invalid: [], saved: true })
        expect(after.note).toBe('edited, withheld temporal')
        expect(temporal(after)).toEqual(temporal(before))
      })
    }
  }
})

// A form whose only writable fields are the instant and the time, saved
// unedited: nothing is left to write once the echo is removed, and the page
// says so in the server's words. Nothing is written; the version does not
// move. On main SQL Server said "Saved." over cut values, and PostgreSQL's
// engine refused both fields.
describe.each(['pg', 'ms'] as const)('%s, only the temporal columns writable, through the page', (engine) => {
  for (const renderer of RENDERERS) {
    test(`${ENGINE_NAME[engine]}, ${renderer}: nothing edited, nothing is written and the page says why`, async () => {
      const { record, before } = await insertDefaulted(engine)
      const user = await openRecord(formId(engine, 'temporal'), record)
      const result = await pressSave(user, renderer)
      const after = await heldStamped(owners, SCHEMA, engine, record)
      expect({ invalid: result.invalid, notice: result.notice }, JSON.stringify(result)).toEqual({ invalid: [], notice: expect.stringContaining('These answers change no column.') as unknown })
      expect(result.statuses).not.toContain('Saved.')
      expect(after).toEqual(before)
    })
  }
})

// An instant the person changes in React's datetime control, which shows a
// local minute: moved away and back to the minute it showed, it is saved as
// the control then holds it, that minute, the seconds and the fraction gone
// -- an edit, written, as 0040 writes every changed value. An echo rule that
// compared at the control's minute would drop this edit; this is also how a
// person meets the control's precision, which is upstream's (0040's cost).
describe.each(['pg', 'ms'] as const)('%s, React, the person changes the shown instant', (engine) => {
  test(`${ENGINE_NAME[engine]}: moved away and back, it is saved as the minute the control holds`, async () => {
    const { record } = await insertDefaulted(engine)
    const user = await openRecord(formId(engine, 'owner'), record)
    const shown = control('React', 'Created at').value
    expect(shown, 'the control shows a minute').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    // What the datetime-local input reports as a person sets it: another minute, then the one it showed.
    fireEvent.change(control('React', 'Created at'), { target: { value: '2026-01-01T00:00' } })
    fireEvent.change(control('React', 'Created at'), { target: { value: shown } })
    const result = await pressSave(user, 'React')
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ invalid: result.invalid, saved: result.statuses.includes('Saved.') }, JSON.stringify(result)).toEqual({ invalid: [], saved: true })
    // The control's minute is the reader's local wall clock; as an instant, in UTC.
    const minute = new Date(shown).toISOString().slice(0, 16).replace('T', ' ')
    expect(after.created_at.text).toBe(engine === 'pg' ? `${minute}:00+00` : `${minute}:00.0000000 +00:00`)
  })
})

/** The zoneless table's row, as the owner reads it. */
async function heldLocal(engine: Engine, record: string): Promise<{ note: string; text: string; bytes: string }> {
  const id = Number(record.slice(3))
  if (engine === 'pg') {
    const [row] = await owners.pg.unsafe<Array<{ note: string; t: string; b: string }>>(
      `select note, local_at::text as t, encode(pg_catalog.timestamp_send(local_at), 'hex') as b from ${SCHEMA}.local_stamped where id = $1`,
      [id],
    )
    if (row === undefined) throw new Error(`no row ${String(id)}`)
    return { note: row.note, text: row.t, bytes: row.b }
  }
  const result = await owners.ms
    .request()
    .input('id', mssql.Int, id)
    .query<{ note: string; t: string; b: Buffer }>(`select note, cast(local_at as nvarchar(40)) as t, cast(local_at as varbinary(16)) as b from ${SCHEMA}.local_stamped where id = @id`)
  const row = result.recordset[0]
  if (row === undefined) throw new Error(`no row ${String(id)}`)
  return { note: row.note, text: row.t, bytes: Buffer.from(row.b).toString('hex') }
}

// A zoneless timestamp, which 0040 leaves as 0026 had it: read with its
// fraction on both engines and shown as read-only text the generator never
// writes. With a fraction from localtimestamp or sysdatetime(), a save
// through the page keeps it. Passed on main too; held because a cut that
// reached the zoneless read would be shown here as a value the row does not
// hold.
describe.each(['pg', 'ms'] as const)('%s, a zoneless timestamp, through the page', (engine) => {
  test(`${ENGINE_NAME[engine]}, React: shown as read-only text with its fraction, the note edited, it is byte-identical`, async () => {
    const id =
      engine === 'pg'
        ? (await owners.pg.unsafe<Array<{ id: number }>>(`insert into ${SCHEMA}.local_stamped (tenant_id, note) values (1, 'as inserted') returning id`))[0]?.id
        : (await owners.ms.request().query<{ id: number }>(`insert into ${SCHEMA}.local_stamped (tenant_id, note) output inserted.id values (1, N'as inserted')`)).recordset[0]?.id
    const record = `k1:${String(id)}`
    const before = await heldLocal(engine, record)
    expect(before.text, 'the default wrote a fraction').toMatch(/\.\d*[1-9]/)
    const user = await openRecord(localFormId(engine), record)
    const local = control('React', 'Local at')
    expect({ type: local.type, fraction: /\.\d*[1-9]$/.test(local.value) }).toEqual({ type: 'text', fraction: true })
    await user.clear(control('React', 'Note'))
    await user.type(control('React', 'Note'), 'edited, zoneless')
    const result = await pressSave(user, 'React')
    const after = await heldLocal(engine, record)
    expect({ invalid: result.invalid, saved: result.statuses.includes('Saved.') }, JSON.stringify(result)).toEqual({ invalid: [], saved: true })
    expect(after).toEqual({ note: 'edited, zoneless', text: before.text, bytes: before.bytes })
  })
})
