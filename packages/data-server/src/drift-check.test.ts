import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, LookupAdapter, MetadataSnapshot, NormalizedType, RecordAdapter } from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import { DRIFT_CHECK_USAGE, runDriftCheck } from './drift-check.js'

/*
 * The drift check a deploy pipeline runs (0111), against the real server's
 * administrator plane over a catalog the test changes as a migration would:
 * what it prints, and the exit status a pipeline reads -- 0 with nothing
 * failing, 1 with a change failing, 2 with a form it could not check.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
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

/** The database as the server's connection finds it "now", and who it is: a test changes either, as a migration or a rotated login would. */
let columns: ColumnMeta[]
let account: MetadataSnapshot['account']
let root: string
let app: FastifyInstance

function snapshot(): MetadataSnapshot {
  return createSnapshot({
    kind: 'sqlserver',
    serverVersion: '16.0',
    account,
    scope: { schemas: ['sales'] },
    gaps: [],
    objects: [
      {
        ref: { schema: 'sales', name: 'employee' },
        kind: 'table',
        comment: null,
        columns,
        primaryKey: { name: 'pk_employee', columns: ['id'] },
        uniqueKeys: [],
        foreignKeys: [],
        checks: [],
        rowSecurity: 'none',
      },
    ],
  })
}

const TOKEN = 'drift-check-administrator'
const verifyIdentity: IdentityVerifier = async (token) =>
  token === TOKEN ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } } : { ok: false, reason: 'bad' }

function registry(): ConnectionRegistry {
  const adapter = {
    kind: 'sqlserver',
    ping: async () => ({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }),
    discover: async () => snapshot(),
    close: async () => {},
  } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined),
    open: async (id) => (id === 'erp' ? { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter } : undefined),
    close: async () => {},
  }
}

/** The server as `fetch` reaches it, under the address the check is given: every request is answered by `app`, as one over the network would be. */
const SERVER = 'https://staging.example/'
const served: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const reply = await app.inject({ method: (init?.method ?? 'GET') as 'POST', url: url.pathname, headers: init?.headers as Record<string, string> })
  return new Response(reply.body, { status: reply.statusCode, headers: { 'content-type': String(reply.headers['content-type'] ?? 'application/json') } })
}

/** The check run with `argv`, its output and its status. */
async function check(argv: readonly string[], env: Record<string, string | undefined> = { FORMANCY_DATA_ADMIN_TOKEN: TOKEN }, fetcher: typeof fetch = served) {
  let stdout = ''
  let stderr = ''
  const status = await runDriftCheck(argv, env, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text), fetch: fetcher })
  return { status, stdout, stderr }
}

beforeEach(async () => {
  columns = [col('id', 1, INT32), col('name', 2, TEXT), col('row_version', 3, { kind: 'rowversion' }, { generated: 'rowversion' })]
  account = { user: 'dbo', login: 'sa' }
  root = await mkdtemp(join(tmpdir(), 'formancy-data-drift-check-'))
  app = await createDataServer({
    verifyIdentity,
    admin: { registry: registry(), store: createFileConfigurationStore(root), adminRoles: ['data-admin'], audit: { sink: () => {} } },
  })
  // The employee form, proposed and published as an administrator would.
  const as = { authorization: `Bearer ${TOKEN}` }
  const proposal = (
    await app.inject({
      method: 'POST',
      url: '/v1/form-proposals',
      headers: as,
      payload: { connection: 'erp', root: { schema: 'sales', name: 'employee' }, formId: 'employee', title: 'Employee' },
    })
  ).json()
  const policy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: { id: { read: ['clerk'], write: ['clerk'] }, name: { read: ['clerk'], write: ['clerk'] } },
    rowFilters: [],
    lookups: {},
  }
  const bundle = {
    format: 2,
    connection: 'erp',
    generation: proposal.generation,
    base: proposal.form,
    presentation: EMPTY_PRESENTATION,
    form: proposal.form,
    bindings: proposal.bindings,
    policy,
    snapshot: proposal.snapshot,
  }
  const published = await app.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as, payload: { expectedBase: null, bundle } })
  if (published.statusCode !== 201) throw new Error(published.body)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the drift check', () => {
  // Nothing changed since publication: the form is reported clean and the
  // pipeline goes on.
  test('passes a form the database still matches, 0', async () => {
    expect(await check([SERVER, 'employee'])).toEqual({
      status: 0,
      stdout: 'employee (version 1): no changes\n1 of 1 form checked; 0 with a change failing on blocking.\n',
      stderr: '',
    })
  })

  // A migration dropped a column the form is bound to: a blocking change,
  // printed with its subject and the server's sentence, and the pipeline
  // stops. Watched failing with the status taken from nothing but whether
  // the requests answered: 0.
  test('fails a form with a blocking change, 1, and says what changed', async () => {
    columns = columns.filter((entry) => entry.name !== 'name')
    const result = await check([SERVER, 'employee'])
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/^employee \(version 1\): \d+ changes?, \d+ failing the check\n/)
    expect(result.stdout).toMatch(/\n {2}blocking +column-dropped sales\.employee\.name: /)
    expect(result.stdout.endsWith('1 of 1 form checked; 1 with a change failing on blocking.\n')).toBe(true)
    expect(result.stdout + result.stderr).not.toContain(TOKEN)
  })

  // A review change -- the connection's login rotated -- passes by default
  // and fails with `--fail-on review`, for a pipeline that wants a person
  // to look first. Watched failing with --fail-on read and ignored.
  test('passes a review change by default, and fails it with --fail-on review', async () => {
    account = { user: 'forms_user', login: 'app_login_2026' }
    const passed = await check([SERVER, 'employee'])
    expect(passed.status).toBe(0)
    expect(passed.stdout).toMatch(/\n {2}review +account-changed the scope: /)
    expect((await check(['--fail-on', 'review', SERVER, 'employee'])).status).toBe(1)
  })

  // A form the check could not ask about is never taken for one without
  // drift: an unknown form, a refused token, a server that is not there,
  // and a 200 that is not a report each make the run 2, the others still
  // checked and printed. Watched failing with an unchecked form left out of
  // the status: 0.
  test('fails with 2 for a form it could not check, and checks the others', async () => {
    const unknown = await check([SERVER, 'nope', 'employee'])
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toBe('nope: the server answered 404 unknown-form: No form is called nope.\n')
    expect(unknown.stdout).toContain('employee (version 1): no changes\n1 of 2 forms checked; 0 with a change failing on blocking.\n')
    expect((await check([SERVER, 'employee'], { FORMANCY_DATA_ADMIN_TOKEN: 'someone-else' })).stderr).toMatch(/^employee: the server answered 401 /)
    const away = await check([SERVER, 'employee'], undefined, async () => {
      throw new TypeError('fetch failed')
    })
    expect(away).toMatchObject({ status: 2, stderr: 'employee: https://staging.example could not be reached: fetch failed\n' })
    const portal = await check(
      [SERVER, 'employee'],
      undefined,
      async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    expect(portal).toMatchObject({ status: 2, stderr: 'employee: the server answered 200, which is not a drift report\n' })
  })

  // What it is given is checked before any request: a token in the
  // environment and never an argument, a URL, at least one form, form ids
  // the server could hold, and a severity it knows.
  test('refuses what it cannot run with 2 and its usage, asking nothing', async () => {
    let asked = 0
    const counting: typeof fetch = async (...args) => {
      asked += 1
      return served(...args)
    }
    for (const [argv, env] of [
      [[SERVER, 'employee'], {}],
      [[SERVER, 'employee'], { FORMANCY_DATA_ADMIN_TOKEN: '' }],
      [[SERVER], undefined],
      [['staging', 'employee'], undefined],
      [['ftp://staging.example/', 'employee'], undefined],
      [[SERVER, 'Employee'], undefined],
      [['--fail-on', 'info', SERVER, 'employee'], undefined],
    ] as const) {
      const result = await check(argv, env, counting)
      expect({ argv, status: result.status, usage: result.stderr.endsWith(`${DRIFT_CHECK_USAGE}\n`) }).toEqual({ argv, status: 2, usage: true })
    }
    expect(asked).toBe(0)
  })
})
