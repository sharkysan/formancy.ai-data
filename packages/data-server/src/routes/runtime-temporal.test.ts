import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, generateForm, WRITE_ID_HEADER } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, DescribedRoot, FormPolicy, InsertRequest, LookupAdapter, NormalizedType, RecordAdapter, RecordFailure, RecordOutcome, UpdateRequest } from '@formancy/data-core'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * An instant and a time on the runtime plane's update (0040), over fake
 * ports. Both adapters read an instant cut to the second and a time to the
 * minute, so a renderer that submits every field echoes a value shorter than
 * the one stored; written back, it would replace the stored fraction or
 * seconds with nothing anybody chose. What is under test here is what the
 * route decides before the adapter is asked: which echo it removes, against
 * which read, and what it refuses. What each engine then stores is the host
 * suite's `temporal-round-trip.test.ts`, against both real servers.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})

const SNAPSHOT = createSnapshot({
  kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    {
      ref: { schema: 'sales', name: 'stamped' }, kind: 'table', comment: null,
      columns: [
        col('id', 1, INT32, { generated: 'identity-always' }),
        col('tenant_id', 2, INT32),
        col('note', 3, { kind: 'text', maxLength: 50, lengthUnit: 'utf16-code-units', fixedLength: false }),
        col('created_at', 4, { kind: 'timestamp', withTimeZone: true, precision: 7 }, { hasDefault: true }),
        col('at_time', 5, { kind: 'time', precision: 7 }),
        col('rv', 6, { kind: 'rowversion' }, { generated: 'rowversion' }),
      ],
      primaryKey: { name: 'pk_stamped', columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
  ],
})

const READ = { read: ['clerk'], write: [] }
const RW = { read: ['clerk'], write: ['clerk'] }
const WRITE_ONLY = { read: [], write: ['clerk'] }

/** A policy over the stamped form: every operation, tenant 1's rows, and these fields. */
function policy(fields: Record<string, { read: string[]; write: string[] }>, operations: Partial<FormPolicy['operations']> = {}): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], ...operations },
    fields: { id: READ, tenant_id: READ, ...fields },
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
  }
}

/**
 * The forms, by id. `writable`: the clerk writes the note and both temporal
 * fields. `temporal`: only the temporal fields, the note shown and never
 * written. `blind-field`: the clerk writes both temporal fields and may not
 * read them. `blind-record`: the clerk may update and may not read at all.
 */
const POLICIES: Record<string, FormPolicy> = {
  writable: policy({ note: RW, created_at: RW, at_time: RW }),
  temporal: policy({ note: READ, created_at: RW, at_time: RW }),
  'blind-field': policy({ note: RW, created_at: WRITE_ONLY, at_time: WRITE_ONLY }),
  'blind-record': policy({ note: RW, created_at: RW, at_time: RW }, { read: [] }),
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } } : { ok: false, reason: 'bad' }

/** The row as both adapters read it: the instant to the second, the time to the minute (0040). */
const STORED = { id: '5', tenant_id: '1', note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' }
const RECORD = 'k1:5'
const VERSION = '00000000000007d1'
const NEWER = '00000000000007d2'
/** What a renderer submits for the record as read: every field it shows, unedited. */
const UNEDITED = { id: 5, tenant_id: 1, note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' }
/**
 * The same, as a client of its own sends it: only the fields the clerk may
 * write, so no echo of a field they may not write meets 0022's over-posting
 * refusal before the instant and the time are decided.
 */
const WRITABLE = { note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' }

let calls: { inserts: InsertRequest[]; updates: UpdateRequest[]; reads: number }
/** The version the fake row is at, which its read answers and its update is guarded by. */
let rowVersion: string
/** What the fake read answers instead of the row, when a case says. */
let readOutcome: RecordOutcome | undefined
let root: string
let app: FastifyInstance

function registry(): ConnectionRegistry {
  // The table as the published snapshot describes it: nothing here is about drift (0041).
  const described = { ...(describedOf(SNAPSHOT, { schema: 'sales', name: 'stamped' }) as DescribedRoot), definition: 'unchanged' }
  const records: RecordAdapter = {
    describe: async () => ({ ok: true, described }),
    read: async () => {
      calls.reads += 1
      const outcome = readOutcome ?? { ok: true, values: { ...STORED }, version: rowVersion }
      return outcome.ok ? { ok: true, described, record: { values: outcome.values, version: outcome.version } } : outcome
    },
    insert: async (request) => {
      calls.inserts.push(request)
      return { ok: true, values: { ...STORED }, version: VERSION }
    },
    update: async (request) => {
      calls.updates.push(request)
      // An adapter's answer to an update guarded by a version the row no longer has.
      if (request.expectedVersion !== rowVersion) return { ok: false, code: 'stale', message: 'changed' }
      return { ok: true, values: { ...STORED }, version: NEWER }
    },
  }
  const lookups: LookupAdapter = { search: async () => ({ rows: [], hasMore: false, omitted: 0 }), resolve: async () => [], rejects: async () => [] }
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0' }), discover: async () => SNAPSHOT, close: async () => {} } as DatabaseAdapter
  return { ids: () => ['erp'], scope: () => ({ schemas: ['sales'] }), open: async (id) => (id === 'erp' ? { adapter, lookups, records } : undefined), close: async () => {} }
}

beforeEach(async () => {
  calls = { inserts: [], updates: [], reads: 0 }
  rowVersion = VERSION
  readOutcome = undefined
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-temporal-'))
  const store = createFileConfigurationStore(root)
  const { form, bindings } = generateForm(SNAPSHOT, { connection: 'erp', root: { schema: 'sales', name: 'stamped' }, formId: 'stamped', title: 'Stamped', lookups: [], pinned: ['tenant_id'] })
  for (const [id, entry] of Object.entries(POLICIES)) {
    const bundle: PublishedBundle = { format: 1, connection: 'erp', form: { ...form, id }, bindings, policy: entry, snapshot: SNAPSHOT }
    await store.publish(id, null, bundle)
  }
  app = await createDataServer({ verifyIdentity, runtime: { registry: registry(), store } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { authorization: 'Bearer clerk' }, payload: payload as Record<string, unknown> })
const update = (form: string, answers: Record<string, unknown>) => post(`/v1/forms/${form}/records/update`, { record: RECORD, version: VERSION, answers })
/** The columns the one update the adapter was asked for sets, by name, with the values it carries. */
const setBy = (index = 0) => Object.fromEntries((calls.updates[index]?.set ?? []).map((entry) => [entry.name, entry.value]))

describe('an instant and a time on update (0040)', () => {
  // The defect itself: SQL Server stored the cut value over the stored
  // fraction and seconds on every save through the host page, and said Saved.
  test('an unedited writable instant and time are removed; the note is still written', async () => {
    const saved = await update('writable', UNEDITED)
    expect(saved.statusCode).toBe(200)
    expect(setBy()).toEqual({ note: 'as stored' })
  })

  // Removing every writable instant and time, whatever its value, passes the
  // case above and silently drops what a person entered.
  test('a changed instant and time are written as sent', async () => {
    const saved = await update('writable', { ...UNEDITED, created_at: '2026-01-02T03:04:05Z', at_time: '11:22' })
    expect(saved.statusCode).toBe(200)
    expect(setBy()).toEqual({ note: 'as stored', created_at: '2026-01-02T03:04:05Z', at_time: '11:22' })
  })

  // The echo is proved against the record at the version the update is
  // guarded by. Against a newer record, an equal value is still the person's
  // old read: it reaches the adapter, whose version guard refuses it as
  // stale. Proved against whatever the read found, the update below would be
  // 400 nothing-to-update -- "nothing changed" about a record that has.
  test('an echo of an older version is not removed, and the update is stale', async () => {
    rowVersion = NEWER
    const stale = await update('temporal', UNEDITED)
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'stale' })
    expect(setBy()).toEqual({ created_at: '2026-10-08T10:34:56Z', at_time: '10:34' })
  })

  // A form whose only writable fields are the temporal ones, saved unedited:
  // nothing is left to set, and the planner refuses an empty patch on both
  // engines alike rather than sending a statement that sets nothing.
  test('an update whose only change was an unedited instant and time is nothing-to-update, and nothing is sent', async () => {
    const refused = await update('temporal', UNEDITED)
    expect(refused.statusCode).toBe(400)
    expect(refused.json()).toEqual({ code: 'nothing-to-update', message: 'These answers change no column.' })
    expect(calls.updates).toEqual([])
  })

  // A field the actor may write and not read has no value of theirs to echo,
  // so what they send is theirs. Compared with the stored value all the
  // same, the save would tell them whether they had guessed a value the
  // policy keeps from them: nothing-to-update, or a version that moved.
  test('a field the actor may write and not read is written as sent, equal or not', async () => {
    const saved = await update('blind-field', { note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' })
    expect(saved.statusCode).toBe(200)
    expect(setBy()).toEqual({ note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' })
  })

  // 0022's cost, unchanged: an actor who may update and not read gets no
  // echo removed, because nothing was read for them to compare with.
  test('an actor who may update and not read has nothing removed', async () => {
    const saved = await update('blind-record', { note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' })
    expect(saved.statusCode).toBe(200)
    expect(calls.reads).toBe(0)
    expect(setBy()).toEqual({ note: 'as stored', created_at: '2026-10-08T10:34:56Z', at_time: '10:34' })
  })

  // A read that failed cannot tell an echo from a change, whatever the
  // failure. Sent anyway, a read that failed and a write that did not would
  // store the cut value, the defect this record removes: so the update is
  // refused with the read's own answer and nothing is sent, as a lookup that
  // cannot vouch for a selection refuses a save. Only the writable fields are
  // sent, as a client of its own sends them: a renderer's echo of the key
  // would be refused as over-posting first (0022), and the case would pass
  // without the refusal it is about. An update that carries no instant or
  // time goes on as 0022 has it: here the note alone, which needs no read.
  test.each<[RecordFailure['code'], number]>([
    ['unavailable', 503],
    ['refused', 422],
    ['permission-denied', 403],
    ['schema-changed', 409],
    ['out-of-range', 422],
    ['not-found', 404],
  ])('a read that failed as %s refuses an update carrying an instant or a time with its answer, and sends nothing', async (code, status) => {
    readOutcome = { ok: false, code, message: 'connection reset by 10.0.0.5' }
    const refused = await update('writable', WRITABLE)
    expect({ status: refused.statusCode, code: (refused.json() as { code: string }).code }).toEqual({ status, code })
    expect(refused.body).not.toContain('10.0.0.5')
    expect(calls.updates).toEqual([])
    expect((await update('writable', { note: 'edited' })).statusCode).toBe(200)
    expect(setBy()).toEqual({ note: 'edited' })
  })

  // The read the update compares with must be the record it addresses. A
  // key the token spells otherwise than the row holds it -- `abc` for `ABC`
  // under a case-insensitive collation -- reads back another token, and the
  // read cannot be told apart from another record's, against which an
  // edited value could be dropped as an echo. Refused, and nothing sent; 409
  // rather than 500, which the client would report as perhaps saved.
  test('a read that comes back as another record refuses an update carrying an instant or a time, and sends nothing', async () => {
    readOutcome = { ok: true, values: { ...STORED, id: '6' }, version: VERSION }
    const refused = await update('writable', WRITABLE)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ code: 'record-not-read', message: 'This update could not be compared with the record as read. Nothing was saved.' })
    expect(calls.updates).toEqual([])
  })

  // 0031: a write that arrives again with its write id is answered with the
  // first sending's answer, and nothing is asked of the database. Chromium
  // resends an update whose answer the network lost after it was stored; its
  // own read failing -- no connection free, while the first still holds one
  // -- it was told "Nothing was saved." about a save that was.
  test('a resend of a stored update is answered with the first answer, whatever its own read would say', async () => {
    const sending = () =>
      app.inject({
        method: 'POST',
        url: '/v1/forms/writable/records/update',
        headers: { authorization: 'Bearer clerk', [WRITE_ID_HEADER]: '0123456789abcdef0123456789abcdef' },
        payload: { record: RECORD, version: VERSION, answers: { ...WRITABLE, note: 'edited' } },
      })
    const first = await sending()
    expect(first.statusCode).toBe(200)
    rowVersion = NEWER
    readOutcome = { ok: false, code: 'unavailable', message: 'no connection free' }
    const again = await sending()
    expect({ status: again.statusCode, body: again.json() as unknown }).toEqual({ status: 200, body: first.json() as unknown })
    expect({ reads: calls.reads, updates: calls.updates.length }).toEqual({ reads: 1, updates: 1 })
  })
})

describe('an instant and a time on create (0040)', () => {
  // Nothing has been read before a create, so nothing is an echo: a value is
  // the person's and is written, and an untouched field, which a renderer
  // leaves out, is left to the column's default. An echo rule applied here
  // would drop an entered value and let the default write the clock instead.
  test('a value entered is written as sent, and one left out is left to the default', async () => {
    const entered = await post('/v1/forms/writable/records/create', { answers: { note: 'new', created_at: '2026-01-02T03:04:05Z', at_time: '11:22' } })
    expect(entered.statusCode).toBe(201)
    const values = (index: number) => Object.fromEntries((calls.inserts[index]?.values ?? []).map((entry) => [entry.name, entry.value]))
    expect(values(0)).toEqual({ tenant_id: '1', note: 'new', created_at: '2026-01-02T03:04:05Z', at_time: '11:22' })
    const defaulted = await post('/v1/forms/writable/records/create', { answers: { note: 'new', at_time: '11:22' } })
    expect(defaulted.statusCode).toBe(201)
    expect(values(1)).toEqual({ tenant_id: '1', note: 'new', at_time: '11:22' })
    expect(calls.reads).toBe(0)
  })
})
