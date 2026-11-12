import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, generateForm } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, DatabaseKind, DescribedRoot, FormPolicy, LookupAdapter, NormalizedType, RecordAdapter } from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'

/*
 * The defaults a person's new record starts with, as the form route
 * serves them (0149), over fake ports on each engine's spelling: the
 * published form's defaults are its columns' constants, and each person
 * is served those their create would take -- a field it accepts from
 * them, and on the state field a state one of their create moves starts
 * a record in. What is under test is what the route decides; which
 * default the generator reads is data-core's `defaults.test.ts`, and
 * what the database stores each adapter's parity suite.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 20, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  ordinal,
  databaseType: type.kind,
  type,
  nullable: false,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
  ...extra,
})

/** sales.ticket as each engine's catalog spells its defaults. */
function snapshotOf(kind: DatabaseKind) {
  const spelled = (text: string) => (kind === 'postgres' ? `'${text}'::character varying` : `('${text}')`)
  return createSnapshot({
    kind,
    serverVersion: kind === 'postgres' ? '17.2' : '16.0',
    account: { user: 'owner', login: 'owner' },
    scope: { schemas: ['sales'] },
    gaps: [],
    objects: [
      {
        ref: { schema: 'sales', name: 'ticket' },
        kind: 'table',
        comment: null,
        columns: [
          col('id', 1, INT32, { generated: 'identity-always' }),
          col('tenant_id', 2, INT32),
          col('note', 3, TEXT, { hasDefault: true, defaultExpression: spelled('new') }),
          col('status', 4, TEXT, { hasDefault: true, defaultExpression: spelled('open') }),
        ],
        primaryKey: { name: 'pk_ticket', columns: ['id'] },
        uniqueKeys: [],
        foreignKeys: [],
        checks: [],
        rowSecurity: 'none',
      },
    ],
  })
}

const EVERYONE = ['clerk', 'auditor', 'viewer']
/** The clerk gives the note and the status, and starts a ticket open; the auditor gives the status alone, and starts one held; the viewer reads. */
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: EVERYONE, create: ['clerk', 'auditor'], update: [] },
  fields: {
    id: { read: EVERYONE, write: [] },
    tenant_id: { read: EVERYONE, write: [] },
    note: { read: EVERYONE, write: ['clerk'] },
    status: { read: EVERYONE, write: ['clerk', 'auditor'] },
  },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
  transitions: {
    field: 'status',
    moves: [
      { from: null, to: 'open', roles: ['clerk'] },
      { from: null, to: 'held', roles: ['auditor'] },
    ],
  },
}

const verifyIdentity: IdentityVerifier = async (token) =>
  EVERYONE.includes(token) ? { ok: true, identity: { actor: { id: token, roles: [token] }, attributes: { tenant: '1' } } } : { ok: false, reason: 'bad' }

function registry(kind: DatabaseKind, snapshot: ReturnType<typeof snapshotOf>): ConnectionRegistry {
  const described = { ...(describedOf(snapshot, { schema: 'sales', name: 'ticket' }) as DescribedRoot), definition: 'unchanged' }
  const never = async (): Promise<never> => {
    throw new Error('opening a form writes and reads no record')
  }
  const records: RecordAdapter = {
    describe: async () => ({ ok: true, described }),
    read: never,
    list: never,
    insert: never,
    update: never,
    supersede: never,
    delete: never,
  }
  const lookups: LookupAdapter = { search: async () => ({ rows: [], hasMore: false, omitted: 0 }), resolve: async () => [], rejects: async () => [] }
  const adapter = {
    kind,
    ping: async () =>
      kind === 'postgres'
        ? { kind, version: '17.2', product: 'postgresql', major: 17 }
        : { kind, version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 },
    discover: async () => snapshot,
    close: async () => {},
  } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: () => ({ schemas: ['sales'] }),
    open: async (id) => (id === 'erp' ? { adapter, lookups, records } : undefined),
    close: async () => {},
  }
}

describe.each(['postgres', 'sqlserver'] as const)('the defaults the form route serves on %s (0149)', (kind) => {
  let root: string
  let app: FastifyInstance
  let published: PublishedBundle

  beforeEach(async () => {
    const snapshot = snapshotOf(kind)
    root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-defaults-'))
    const store = createFileConfigurationStore(root)
    const { form, bindings } = generateForm(snapshot, {
      connection: 'erp',
      root: { schema: 'sales', name: 'ticket' },
      formId: 'ticket',
      title: 'Ticket',
      lookups: [],
      pinned: ['tenant_id'],
    })
    published = { format: 1, connection: 'erp', form, bindings, policy: POLICY, snapshot }
    await store.publish('ticket', null, published)
    app = await createDataServer({ verifyIdentity, runtime: { registry: registry(kind, snapshot), store } })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Each field's default in the form `who` is served, by key. */
  const servedDefaults = async (who: string): Promise<Record<string, unknown>> => {
    const reply = await app.inject({ method: 'GET', url: '/v1/forms/ticket', headers: { authorization: `Bearer ${who}` } })
    expect(reply.statusCode).toBe(200)
    const { form } = reply.json<{ form: PublishedBundle['form'] }>()
    return Object.fromEntries(form.model.fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])))
  }

  // The published form starts the note at new and the status at open. The
  // clerk is served both; the auditor neither -- their create takes no
  // note, and starts a ticket held, never open -- and the viewer, who may
  // not create, none. An untouched New record of the auditor's would
  // otherwise send the note and the open status, and be refused. Watched
  // failing with the form served as published: the auditor and the viewer
  // were served both defaults.
  test('serves each person the defaults their create would take, and no other', async () => {
    expect(Object.fromEntries(published.form.model.fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])))).toEqual({
      note: 'new',
      status: 'open',
    })
    expect(await servedDefaults('clerk')).toEqual({ note: 'new', status: 'open' })
    expect(await servedDefaults('auditor')).toEqual({})
    expect(await servedDefaults('viewer')).toEqual({})
  })
})
