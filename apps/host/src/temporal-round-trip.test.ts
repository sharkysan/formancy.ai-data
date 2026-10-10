import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataClient } from '@formancy/data-client'
import type { DataClient, FormRecord, PublishedForm } from '@formancy/data-client'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConnectionConfig, IdentityVerifier } from '@formancy/data-server'
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest'
import { createSession } from './session.js'
import type { Engine, Owners, Sent } from './test-stamped.js'
import { connectOwners, createStamped, dropStamped, ENGINE_NAME, fetchThrough, heldStamped, holdsFraction, insertStamped, updatesIn } from './test-stamped.js'

/*
 * An instant and a time saved through the runtime plane on both engines
 * (0040), the way a host saves them: the real data server over real
 * PostgreSQL 17 and SQL Server 2022 behind a fake `fetch`,
 * `@formancy/data-client`, and this page's own session over the headless
 * engine both renderers run, whose `submit()` is the renderers' validation.
 * Each row is written by the database's owner, read through the plane, saved,
 * and compared with what the owner reads back byte for byte
 * (`test-stamped.ts`).
 *
 * The failures they prevent, each seen on main before 0040:
 * - On SQL Server, which reads an instant to the second and a time to the
 *   minute, a save that left them as read wrote the cut values over the
 *   stored fraction and seconds, rewrote the offset to +00:00, and was
 *   answered "Saved".
 * - On PostgreSQL, which read them faithfully, the engine refused the
 *   unedited value, so the record could not be saved at all -- also when
 *   the clerk may not write the columns.
 * And the cases 0040 decides, which a fix that removed too much would break:
 * a value the person changes is written; a form whose only change was an
 * unedited instant and time writes nothing and says so; a field the clerk
 * may write and not read, and every field of a clerk who may update and not
 * read the record, is written as sent; a created record whose instant was
 * left to its default saves again unedited; and, on PostgreSQL, what no
 * shape names is refused by the renderers and kept by a client of its own.
 *
 * Grown from the reproduction of the gap analysis's section 3.2 item 1,
 * which this file replaces.
 */

const SCHEMA = 'temporal_round_trip'

const TOKENS = { admin: 'temporal-administrator', clerk: 'temporal-clerk-tenant-1' } as const

// Literal tokens, as the host suites' plane takes them: verification is identity.test's subject.
const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-1', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'ERR_JWS_INVALID' }
}

const ENGINES = [
  { engine: 'pg', versionColumn: 'row_version' as string | undefined },
  { engine: 'ms', versionColumn: undefined },
] as const

/**
 * The forms each engine publishes over `stamped`, by what the clerk may do
 * with the note and the two temporal fields. The key and the tenant are
 * never the clerk's to write, and every form is the generator's own.
 * - `writable`: the clerk reads and writes all three, as the host suites'
 *   clerkPolicy grants every field the generator made writable.
 * - `readonly`: the temporal fields are shown and never written: 0022's echo.
 * - `temporal`: only the temporal fields are written, the note shown.
 * - `blind`: the temporal fields are written and never shown.
 * - `unread`: the clerk may update the record and may not read it at all.
 */
type Shape = 'writable' | 'readonly' | 'temporal' | 'blind' | 'unread'
const SHAPES: Record<Shape, Record<'note' | 'created_at' | 'at_time', { read: boolean; write: boolean }>> = {
  writable: { note: { read: true, write: true }, created_at: { read: true, write: true }, at_time: { read: true, write: true } },
  readonly: { note: { read: true, write: true }, created_at: { read: true, write: false }, at_time: { read: true, write: false } },
  temporal: { note: { read: true, write: false }, created_at: { read: true, write: true }, at_time: { read: true, write: true } },
  blind: { note: { read: true, write: true }, created_at: { read: false, write: true }, at_time: { read: false, write: true } },
  unread: { note: { read: false, write: true }, created_at: { read: false, write: true }, at_time: { read: false, write: true } },
}

function policyFor(fields: readonly FieldBinding[], shape: Shape): FormPolicy {
  const grant = (field: string) => SHAPES[shape][field as 'note'] ?? { read: shape !== 'unread', write: false }
  return {
    version: 1,
    operations: { read: shape === 'unread' ? [] : ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map(({ field }) => [field, { read: grant(field).read ? ['clerk'] : [], write: grant(field).write ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
  }
}

const formId = (engine: Engine, shape: Shape) => `${engine}-stamped-${shape}`

let app: Awaited<ReturnType<typeof createDataServer>>
let registryClose: () => Promise<void>
let root: string
let owners: Owners
const sent: Sent[] = []
let client: DataClient

beforeAll(async () => {
  const { pg, ms } = inject('databases')
  owners = await connectOwners()
  await createStamped(owners, SCHEMA)

  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: [SCHEMA], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: [SCHEMA], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const registry = createConnectionRegistry(connections, DRIVER_FACTORIES, { env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password }, readFile: async () => '' })
  registryClose = () => registry.close()
  root = await mkdtemp(join(tmpdir(), 'formancy-data-temporal-'))
  const store = createFileConfigurationStore(root)
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  client = createDataClient({ token: () => TOKENS.clerk, fetch: fetchThrough(app, sent) })

  const admin = async (url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const reply = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${TOKENS.admin}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${url} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json<Record<string, unknown>>()
  }
  for (const { engine, versionColumn } of ENGINES) {
    for (const shape of Object.keys(SHAPES) as Shape[]) {
      const id = formId(engine, shape)
      const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
        connection: engine,
        root: { schema: SCHEMA, name: 'stamped' },
        formId: id,
        title: 'Stamped',
        lookups: [],
        // The tenant comes from the token, as the row filter says: pinned, so a new record needs no tenant typed in.
        pinned: ['tenant_id'],
        ...(versionColumn === undefined ? {} : { versionColumn }),
      })
      const policy = policyFor((bindings as { fields: FieldBinding[] }).fields, shape)
      await admin(`/v1/forms/${id}/versions`, { expectedBase: null, bundle: { format: 2, connection: engine, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } })
    }
  }
})

afterAll(async () => {
  await app?.close()
  await registryClose?.()
  if (owners !== undefined) {
    await dropStamped(owners, SCHEMA)
    await owners.pg.end()
    await owners.ms.close()
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function definitionOf(id: string): Promise<PublishedForm> {
  const outcome = await client.form(id)
  if (!outcome.ok) throw new Error(`the form did not open: ${outcome.message}`)
  return outcome.value
}

async function readThroughPlane(id: string, record: string): Promise<FormRecord> {
  const outcome = await client.read(id, record)
  if (!outcome.ok) throw new Error(`the record did not read: ${String(outcome.status)} ${outcome.code} ${outcome.message}`)
  return outcome.value
}

/**
 * Open the record in this page's session, change what `edits` says (nothing,
 * for "saved unedited"), submit as a renderer submits -- the engine's
 * verdict, its value as data -- and save through the session. A null result
 * is a submit the engine refused: nothing was sent.
 */
async function saveThroughSession(id: string, record: string, edits: Record<string, unknown>) {
  const session = createSession({ client, formId: id, definition: await definitionOf(id), renderer: 'react' })
  session.open(await readThroughPlane(id, record))
  const { engine } = session.opened()
  for (const [key, value] of Object.entries(edits)) engine.setValue([key], value)
  const verdict = engine.submit()
  return { verdict: verdict.errors, result: await session.save({ ok: verdict.ok, data: engine.value() }) }
}

describe.each(ENGINES)('an instant and a time on $engine, through the runtime plane', ({ engine }) => {
  const name = ENGINE_NAME[engine]
  // A defaulted instant with its fraction, and a time with seconds and a
  // fraction: both longer than either engine reads them.
  const row = { note: 'as inserted', atTime: engine === 'pg' ? '10:34:56.123456' : '10:34:56.1234567' }
  const insert = async () => {
    const record = await insertStamped(owners, SCHEMA, engine, row)
    const before = await heldStamped(owners, SCHEMA, engine, record)
    expect(holdsFraction(before), `the default wrote a fractional instant: ${before.created_at.text}`).toBe(true)
    return { record, before }
  }

  // A person opens the record and presses Save. On main, SQL Server stored
  // both cut and said Saved; PostgreSQL's engine refused both, and nothing
  // was sent.
  test(`${name}: saved unedited through the session, both are byte-identical`, async () => {
    const { record, before } = await insert()
    const { verdict, result } = await saveThroughSession(formId(engine, 'writable'), record, {})
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ verdict, saved: result?.kind }).toEqual({ verdict: {}, saved: 'saved' })
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })

  // The claim as the gap analysis words it: the record's other field edited,
  // the temporal ones left as read.
  test(`${name}: saved with the note edited, both are byte-identical`, async () => {
    const { record, before } = await insert()
    const { verdict, result } = await saveThroughSession(formId(engine, 'writable'), record, { note: 'edited through the page' })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ verdict, saved: result?.kind, note: after.note }).toEqual({ verdict: {}, saved: 'saved', note: 'edited through the page' })
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })

  // A host's own client that sends the read answers back as they came, no
  // renderer in between (0022: "a host's own client might not use them").
  // On main PostgreSQL refused it 422 `invalid-values`, because the faithful
  // read is not a value the codec accepts, and SQL Server wrote the cut
  // values.
  test(`${name}: the read answers sent back by a client of its own, the note edited, both are byte-identical`, async () => {
    const id = formId(engine, 'writable')
    const { record, before } = await insert()
    const read = await readThroughPlane(id, record)
    const outcome = await client.update(id, { record: read.record ?? '', version: read.version ?? '', answers: { ...read.answers, note: 'edited through the client' } })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })

  // The clerk may read both temporal columns and write neither: 0022
  // removes the echo, compared with a value read cut the same way. On main
  // PostgreSQL's engine refused the faithful value first, so the page could
  // not save the note at all.
  test(`${name}: columns the clerk may not write, saved through the session with the note edited`, async () => {
    const { record, before } = await insert()
    const { verdict, result } = await saveThroughSession(formId(engine, 'readonly'), record, { note: 'edited, read-only temporal' })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ verdict, saved: result?.kind, note: after.note }).toEqual({ verdict: {}, saved: 'saved', note: 'edited, read-only temporal' })
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })

  // The same through a client of its own: 0022's comparison, which a cut
  // read must still win on both engines.
  test(`${name}: columns the clerk may not write, the read answers sent back by a client of its own`, async () => {
    const id = formId(engine, 'readonly')
    const { record, before } = await insert()
    const read = await readThroughPlane(id, record)
    const outcome = await client.update(id, { record: read.record ?? '', version: read.version ?? '', answers: { ...read.answers, note: 'edited, client, read-only temporal' } })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })

  // What the person enters is written, to the second and the minute the
  // fields hold. A fix that removed every writable instant and time, equal
  // or not, would pass every case above and fail this one.
  test(`${name}: an instant and a time the person changes are written as entered`, async () => {
    const { record } = await insert()
    const { verdict, result } = await saveThroughSession(formId(engine, 'writable'), record, { created_at: '2026-01-02T03:04:05Z', at_time: '11:22' })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ verdict, saved: result?.kind }).toEqual({ verdict: {}, saved: 'saved' })
    expect({ created_at: after.created_at.text, at_time: after.at_time.text }).toEqual(
      engine === 'pg' ? { created_at: '2026-01-02 03:04:05+00', at_time: '11:22:00' } : { created_at: '2026-01-02 03:04:05.0000000 +00:00', at_time: '11:22:00.0000000' },
    )
  })

  // A form whose only writable fields are the temporal ones, saved
  // unedited: nothing is left to write, and the server says so rather than
  // writing the cut values (SQL Server on main, "Saved") or the page
  // refusing them (PostgreSQL on main). The version does not move.
  test(`${name}: a form whose only change was an unedited instant and time writes nothing, and says so`, async () => {
    const { record, before } = await insert()
    const { verdict, result } = await saveThroughSession(formId(engine, 'temporal'), record, {})
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ verdict, result }).toEqual({ verdict: {}, result: { kind: 'refused', message: 'These answers change no column.' } })
    expect(after).toEqual(before)
  })

  // A field the clerk may write and not read has no value of theirs to echo,
  // so what is sent is theirs, and is written: here the cut values, which
  // replace the stored fraction and seconds. Compared with the stored value
  // instead, the save would tell the clerk whether they had guessed what the
  // policy keeps from them (0040's cost).
  test(`${name}: a field the clerk may write and not read is written as sent`, async () => {
    const id = formId(engine, 'blind')
    const { record } = await insert()
    const read = await readThroughPlane(id, record)
    expect(Object.keys(read.answers)).not.toContain('created_at')
    const outcome = await client.update(id, { record: read.record ?? '', version: read.version ?? '', answers: { ...read.answers, created_at: '2026-10-08T10:34:56Z', at_time: '10:34' } })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect({ created_at: after.created_at.text, at_time: after.at_time.text }).toEqual(
      engine === 'pg' ? { created_at: '2026-10-08 10:34:56+00', at_time: '10:34:00' } : { created_at: '2026-10-08 10:34:56.0000000 +00:00', at_time: '10:34:00.0000000' },
    )
  })

  // A clerk who may update the record and not read it has no read to echo,
  // so nothing is removed and the planner needs no read for them: what they
  // send is written, here the cut values (0040's cost, beside 0022's). A
  // rule that compared it anyway would have to read for someone the policy
  // reads nothing for. The version is the owner's, since the clerk reads none.
  test(`${name}: a clerk who may update and not read the record has what they send written`, async () => {
    const { record, before } = await insert()
    const outcome = await client.update(formId(engine, 'unread'), { record, version: before.version, answers: { note: 'edited, unread', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' } })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect({ note: after.note, created_at: after.created_at.text, at_time: after.at_time.text }).toEqual(
      engine === 'pg'
        ? { note: 'edited, unread', created_at: '2026-10-08 10:34:56+00', at_time: '10:34:00' }
        : { note: 'edited, unread', created_at: '2026-10-08 10:34:56.0000000 +00:00', at_time: '10:34:00.0000000' },
    )
  })

  // A record created through the page with the instant left to its default:
  // nothing was read before the create, so nothing is compared, and the
  // default writes the clock with its fraction. The created record then
  // saves again unedited and keeps it. On main PostgreSQL answered the
  // create with the fraction, and the engine refused the next save.
  test(`${name}: a record created with the instant left to its default saves again unedited, and keeps it`, async () => {
    const id = formId(engine, 'writable')
    const session = createSession({ client, formId: id, definition: await definitionOf(id), renderer: 'react' })
    const { engine: form } = session.opened()
    form.setValue(['note'], 'created on the page')
    form.setValue(['at_time'], '11:22')
    const created = await session.save({ ok: form.submit().ok, data: form.value() })
    expect(created?.kind, created?.message).toBe('created')
    const record = session.state().record ?? ''
    const first = await heldStamped(owners, SCHEMA, engine, record)
    expect(holdsFraction(first), `the default wrote a fractional instant: ${first.created_at.text}`).toBe(true)
    const verdict = form.submit()
    const saved = await session.save({ ok: verdict.ok, data: form.value() })
    const after = await heldStamped(owners, SCHEMA, engine, record)
    expect({ verdict: verdict.errors, saved: saved?.kind }).toEqual({ verdict: {}, saved: 'saved' })
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: first.created_at, at_time: first.at_time })
  })
})

// The other column on each engine, alone: PostgreSQL's time with seconds,
// beside an instant on a whole second; SQL Server's instant stored at
// another offset, beside a whole-minute time -- on main the point in time
// survived to the second there, and the fraction and the offset did not.
describe('the other column alone, through the session, the note edited', () => {
  test('PostgreSQL: a time(6) with seconds and a fraction is byte-identical', async () => {
    const record = await insertStamped(owners, SCHEMA, 'pg', { note: 'as inserted', atTime: '10:34:56.789012', createdAt: '2026-10-08 10:34:56+00' })
    const before = await heldStamped(owners, SCHEMA, 'pg', record)
    const { verdict, result } = await saveThroughSession(formId('pg', 'writable'), record, { note: 'edited, time alone' })
    const after = await heldStamped(owners, SCHEMA, 'pg', record)
    expect({ verdict, saved: result?.kind }).toEqual({ verdict: {}, saved: 'saved' })
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })

  test('SQL Server: a datetimeoffset(7) at +02:00 with a fraction is byte-identical, offset included', async () => {
    const record = await insertStamped(owners, SCHEMA, 'ms', { note: 'as inserted', atTime: '10:34:00', createdAt: '2026-10-08 10:34:56.1234567 +02:00' })
    const before = await heldStamped(owners, SCHEMA, 'ms', record)
    const { verdict, result } = await saveThroughSession(formId('ms', 'writable'), record, { note: 'edited, offset alone' })
    const after = await heldStamped(owners, SCHEMA, 'ms', record)
    expect({ verdict, saved: result?.kind }).toEqual({ verdict: {}, saved: 'saved' })
    expect({ created_at: after.created_at, at_time: after.at_time }).toEqual({ created_at: before.created_at, at_time: before.at_time })
  })
})

// What no shape names, on PostgreSQL alone: SQL Server's types hold no
// infinity and no 24:00. PostgreSQL reads `infinity` and `24:00:00` in
// spellings the codec refuses (0016), and both renderers' validation refuses
// them, so the page cannot submit the record until the person changes them.
// A client of its own that sends them back unedited saves, because the
// planner removes the echo before any codec sees it, and both are kept
// (0040); on main, and with that removal disabled, it was refused
// `invalid-values`.
describe('what no shape names, on PostgreSQL alone', () => {
  test('infinity and 24:00 are refused by the renderers, and kept by a client of its own that sends them back', async () => {
    const id = formId('pg', 'writable')
    const record = await insertStamped(owners, SCHEMA, 'pg', { note: 'as inserted', atTime: '24:00:00', createdAt: 'infinity' })
    const before = await heldStamped(owners, SCHEMA, 'pg', record)
    const read = await readThroughPlane(id, record)
    expect({ created_at: read.answers['created_at'], at_time: read.answers['at_time'] }).toEqual({ created_at: 'infinity', at_time: '24:00' })
    const from = sent.length
    const { verdict, result } = await saveThroughSession(id, record, { note: 'edited through the page' })
    expect({ refused: Object.keys(verdict).sort(), result, updates: updatesIn(sent, from) }).toEqual({ refused: ['at_time', 'created_at'], result: null, updates: [] })
    const outcome = await client.update(id, { record: read.record ?? '', version: read.version ?? '', answers: { ...read.answers, note: 'edited through the client' } })
    const after = await heldStamped(owners, SCHEMA, 'pg', record)
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect(after).toMatchObject({ note: 'edited through the client', created_at: before.created_at, at_time: before.at_time })
  })
})
