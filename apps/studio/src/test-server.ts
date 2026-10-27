import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf } from '@formancy/data-core'
import type { ApiValue, ColumnMeta, CoverageGap, DatabaseAdapter, DescribedTable, ListRequest, LookupAdapter, MetadataSnapshot, RecordAdapter, RecordFilter, ReferentialAction, ServerFacts } from '@formancy/data-core'
import { createDataServer, createFileConfigurationStore } from '@formancy/data-server'
import type { ConfigurationStore, ConnectionRegistry, IdentityVerifier } from '@formancy/data-server'
import owner from './fixtures/postgres-owner.json'
import reader from './fixtures/postgres-reader.json'
import writer from './fixtures/postgres-writer.json'
import sqlserver from './fixtures/sqlserver-owner.json'
import sqlserverReader from './fixtures/sqlserver-reader.json'

/**
 * The real data server, behind a fake `fetch`, for the studio's suite.
 *
 * Every answer the studio gets in a test is the one `createDataServer` gives:
 * the administrator plane's own routes, its own validation and its own store
 * on a temporary directory. Nothing here writes a response body. So when the
 * server changes a shape -- a field renamed, a status moved -- the studio's
 * tests fail, rather than passing against JSON somebody wrote to look like it.
 *
 * What is fake is what the server is designed to be given: the identity
 * verifier (literal tokens instead of signed ones; verification is
 * `identity.test.ts`'s), and the connection registry, whose adapters answer
 * with snapshots captured from the shared fixture by
 * `scripts/capture-snapshots.mjs`: PostgreSQL as its owner, who may do
 * everything; as the restricted reader, who sees every table and may read
 * `sales.order` only; and as the order form's own account, the writer, whom
 * row-level security on customer binds (0027). SQL Server as its owner, whose
 * order table keeps a rowversion, and as the reader, whose catalog hides what
 * it may not use behind gaps, the "cannot tell" the studio must show (0004).
 *
 * The registry's records port pages the rows a test puts in, for a browse
 * (0099): narrowed by a follow's values (0103) and by the person's filter
 * (0104), each condition compared as `RecordFilter`'s doc comment says an
 * adapter compares it. It stands in for the adapters, whose comparison the
 * parity suites prove on both engines against real servers (0003); here it
 * is what lets a test see that the page the studio shows is the one the
 * filter it sent asks for.
 */

/** A snapshot read from a committed file, refused if it was edited after it was captured. */
export function readSnapshot(raw: unknown): MetadataSnapshot {
  const { fingerprint, ...contents } = raw as MetadataSnapshot
  const recomputed = createSnapshot(contents)
  if (recomputed.fingerprint !== fingerprint) {
    throw new Error(`a captured snapshot hashes to ${recomputed.fingerprint}, not ${String(fingerprint)}: it was edited. Run scripts/capture-snapshots.mjs again.`)
  }
  return recomputed
}

export const OWNER_SNAPSHOT = readSnapshot(owner)
export const READER_SNAPSHOT = readSnapshot(reader)
export const WRITER_SNAPSHOT = readSnapshot(writer)
export const SQLSERVER_SNAPSHOT = readSnapshot(sqlserver)
export const SQLSERVER_READER_SNAPSHOT = readSnapshot(sqlserverReader)

/**
 * The tokens the fake verifier accepts, and who each one is. Under review
 * (0065), `admin` is an author -- an administrator without a publisher
 * role; `publisher` holds the publisher role alone, which a reviewed plane
 * also lets in; `both` holds both, and still never approves what it
 * submitted. `browser` administers and holds the browse role (0099).
 */
export const TOKENS = { admin: 'studio-test-administrator', clerk: 'studio-test-clerk', publisher: 'studio-test-publisher', both: 'studio-test-both', browser: 'studio-test-browser' } as const
export const ADMIN_ROLE = 'data-admin'
export const PUBLISHER_ROLE = 'data-publisher'
export const BROWSE_ROLE = 'data-browser'

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: [ADMIN_ROLE] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-7', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.publisher) return { ok: true, identity: { actor: { id: 'grace', roles: [PUBLISHER_ROLE] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.both) return { ok: true, identity: { actor: { id: 'lin', roles: [ADMIN_ROLE, PUBLISHER_ROLE] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.browser) return { ok: true, identity: { actor: { id: 'bo', roles: [ADMIN_ROLE, BROWSE_ROLE] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'ERR_JWS_INVALID' }
}

export interface TestPlane {
  /** The `fetch` the studio is given: every call is answered by the real server. */
  fetch: typeof fetch
  /** Each connection's database as it is now. A test replaces one to make drift. */
  databases: Map<string, MetadataSnapshot>
  /** Connections whose database does not answer. */
  unreachable: Set<string>
  /**
   * The rows a browse pages through (0099), by `schema.name`, in the order
   * a test means them to be read. Narrowed by the request's equal values,
   * as a follow of a foreign key asks (0103) -- a row is kept when it holds
   * each value exactly as the term spells it, which the canonical text a
   * test puts in always is -- and by the person's filter (0104), each
   * condition with the meaning `RecordFilter`'s doc comment gives it
   * (`holds`); then paged by its offset and limit, and nothing else. It
   * stands in for the adapters: what a database does with a filter is the
   * parity suites' to prove, on both engines, and what it does with a sort,
   * a search, or a value spelled another way the adapter suites', against
   * real servers (0003).
   */
  rows: Map<string, Array<Record<string, ApiValue>>>
  /** Connections the operator has taken out of the allowlist since the server started. */
  removed: Set<string>
  /** Every request the studio made, as method and path, in order, with the JSON body it sent, if any. */
  requests: Array<{ method: string; path: string; body?: unknown }>
  /**
   * Hold every request whose path matches until `release` is called: the
   * server is slow, and the studio is seen while it waits.
   */
  hold(path: RegExp): { release: () => void }
  store: ConfigurationStore
  /** The store's directory: one file per published version, which a test can damage by hand, and under review the drafts beside them in `.drafts` (0065). */
  root: string
  close(): Promise<void>
}

/** The connections the registry allows, in the order the server lists them. */
export const CONNECTIONS = ['fixture', 'fixture-reader', 'fixture-sqlserver', 'fixture-sqlserver-reader', 'fixture-writer'] as const

/** Two exact numbers, integers or decimals, spelled as columns hold them, in order: each scaled to the longer fraction, so nothing passes through a double. */
function numberOrder(left: string, right: string): number {
  const parts = (text: string) => {
    const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.')
    return { sign: text.startsWith('-') ? '-' : '', whole, fraction }
  }
  const [a, b] = [parts(left), parts(right)]
  const scale = Math.max(a.fraction.length, b.fraction.length)
  const [x, y] = [a, b].map((part) => BigInt(`${part.sign}${part.whole}${part.fraction.padEnd(scale, '0')}`)) as [bigint, bigint]
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * A row's value against a range's bound. A day, an instant -- both
 * midnight-to-the-second and `Z` -- and a zoneless timestamp, whose fraction
 * follows the second, each sort as their text does, once the `Z` is off.
 */
function rangeOrder(type: Extract<RecordFilter, { op: 'range' }>['type'], value: string, bound: string): number {
  if (type.kind === 'integer' || type.kind === 'decimal') return numberOrder(value, bound)
  const [a, b] = [value.replace(/Z$/, ''), bound.replace(/Z$/, '')]
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Whether a row a test put in holds one condition of the person's filter
 * (0104), as `RecordFilter` says: `equals` the canonical value exactly, unit
 * for unit, or the boolean spelled `true` or `false`; `range` at least
 * `from`, at most `to`, below `before`; `contains` the text anywhere, case
 * folded; `null` and `not-null` NULL or not, where text of no characters is
 * a value. A column a row leaves out is NULL, as the page shows it.
 */
function holds(values: Record<string, ApiValue>, condition: RecordFilter): boolean {
  const value = values[condition.column] ?? null
  switch (condition.op) {
    case 'null':
      return value === null
    case 'not-null':
      return value !== null
    case 'equals':
      return value !== null && String(value) === condition.value
    case 'contains':
      return typeof value === 'string' && value.toLowerCase().includes(condition.text.toLowerCase())
    case 'range': {
      if (value === null) return false
      const order = (bound: string) => rangeOrder(condition.type, String(value), bound)
      return (condition.from === null || order(condition.from) >= 0) && (condition.to === null || order(condition.to) <= 0) && (condition.before === null || order(condition.before) < 0)
    }
  }
}

/**
 * `administrator: false` starts the server as one started without a store, an
 * allowlist or administrator roles would be: `/v1/whoami` answers and the
 * administrator plane does not exist. `review: true` starts it as
 * `FORMANCY_DATA_PUBLISHER_ROLES=data-publisher` would (0065): nobody
 * publishes directly, an administrator submits a draft, and a publisher
 * who did not submit it approves it. `browse: true` starts it as
 * `FORMANCY_DATA_BROWSE_ROLES=data-browser` would (0099).
 */
export async function startPlane(options: { administrator?: boolean; review?: boolean; browse?: boolean } = {}): Promise<TestPlane> {
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-studio-'))
  const store = createFileConfigurationStore(root)
  const databases = new Map<string, MetadataSnapshot>([
    ['fixture', OWNER_SNAPSHOT],
    ['fixture-reader', READER_SNAPSHOT],
    ['fixture-sqlserver', SQLSERVER_SNAPSHOT],
    ['fixture-sqlserver-reader', SQLSERVER_READER_SNAPSHOT],
    ['fixture-writer', WRITER_SNAPSHOT],
  ])
  const unreachable = new Set<string>()
  const rows = new Map<string, Array<Record<string, ApiValue>>>()
  const removed = new Set<string>()
  const requests: TestPlane['requests'] = []
  let held: { path: RegExp; until: Promise<void> } | null = null

  const allowed = (id: string) => databases.has(id) && !removed.has(id)
  const registry: ConnectionRegistry = {
    ids: () => [...databases.keys()].filter(allowed).sort(),
    scope: (id) => (allowed(id) ? { schemas: [...OWNER_SNAPSHOT.scope.schemas] } : undefined),
    open: async (id) => {
      const now = databases.get(id)
      if (now === undefined || !allowed(id)) return undefined
      // The driver's message names a host and a port, as a real one does; the
      // server must not pass it on.
      if (unreachable.has(id)) throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      const adapter: DatabaseAdapter = {
        kind: now.kind,
        // The server the snapshot records (0068), as the adapters' ping and
        // discovery read it with one query. Every capture records one; a
        // ping cannot answer for a server nobody recorded.
        ping: async () => {
          if (now.server === undefined) throw new Error(`the snapshot of ${id} records no server, so nothing can answer its ping`)
          return { kind: now.kind, version: now.serverVersion, ...now.server }
        },
        discover: async () => databases.get(id) ?? now,
        close: async () => {},
      }
      // The administrator plane never touches a lookup, and reads records only to browse them (0099), narrowed or not (0103), filtered or not (0104).
      const records = {
        list: async (request: ListRequest) => {
          const { schema, name } = request.target.table
          const narrowed = (rows.get(`${schema}.${name}`) ?? []).filter(
            (values) => request.equal.every((term) => values[term.name] === term.value) && request.filter.every((condition) => holds(values, condition)),
          )
          const page = narrowed.slice(request.offset, request.offset + request.limit + 1)
          const described = describedOf(databases.get(id) ?? now, request.target.table) as DescribedTable
          // Only the columns the request names, as an adapter reads them: a fake that answered every value it holds would show a page what the server's discovery left out.
          const read = (values: Record<string, ApiValue>) => Object.fromEntries(request.columns.filter((column) => Object.hasOwn(values, column.name)).map((column) => [column.name, values[column.name]]))
          return { ok: true, described, rows: page.map((values) => ({ values: read(values), version: null })) }
        },
      } as unknown as RecordAdapter
      return { adapter, lookups: {} as LookupAdapter, records }
    },
    close: async () => {},
  }

  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const audit = { sink: () => {} }
  const browse = options.browse === true ? { browseRoles: [BROWSE_ROLE] } : {}
  const admin =
    options.review === true
      ? { registry, store, adminRoles: [ADMIN_ROLE, PUBLISHER_ROLE, BROWSE_ROLE], publisherRoles: [PUBLISHER_ROLE], ...browse, audit }
      : { registry, store, adminRoles: [ADMIN_ROLE, BROWSE_ROLE], ...browse, audit }
  const app = await createDataServer(options.administrator === false ? { verifyIdentity } : { verifyIdentity, admin })

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://studio.test')
    const method = (init?.method ?? 'GET').toUpperCase()
    requests.push({ method, path: url.pathname, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}) })
    if (held?.path.test(url.pathname) === true) await held.until
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value
    })
    const reply = await app.inject({
      method: method as 'GET' | 'POST',
      url: `${url.pathname}${url.search}`,
      headers,
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    })
    const answered = new Headers()
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined) answered.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: answered })
  }

  return {
    fetch,
    databases,
    unreachable,
    rows,
    removed,
    requests,
    hold: (path) => {
      let release = () => {}
      held = { path, until: new Promise<void>((resolve) => (release = resolve)) }
      return {
        release: () => {
          held = null
          release()
        },
      }
    },
    store,
    root,
    close: async () => {
      await app.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * A snapshot of `base` with one column of one table dropped, made the one way a
 * snapshot is made, so it carries a true fingerprint: the database after
 * somebody ran `alter table ... drop column`.
 */
export function withoutColumn(base: MetadataSnapshot, table: string, column: string): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const object = contents.objects.find((candidate) => candidate.ref.name === table)
  if (object === undefined) throw new Error(`the snapshot has no ${table}`)
  object.columns = object.columns.filter((candidate) => candidate.name !== column)
  return createSnapshot(contents)
}

/**
 * A snapshot of `base` with one more column on one table, made the one way a
 * snapshot is made: the database after `alter table ... add column`. With
 * `withoutColumn` first, a column renamed, which a catalog shows as one
 * dropped and one added.
 */
export function withColumn(base: MetadataSnapshot, table: string, column: ColumnMeta): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const object = contents.objects.find((candidate) => candidate.ref.name === table)
  if (object === undefined) throw new Error(`the snapshot has no ${table}`)
  object.columns.push(structuredClone(column))
  object.columns.sort((left, right) => left.ordinal - right.ordinal)
  return createSnapshot(contents)
}

/** One column of sales.order in `base` renamed: to the catalog, one dropped and one added at the same place. */
export function renamedOrderColumn(base: MetadataSnapshot, column: string, to: string): MetadataSnapshot {
  const meta = base.objects.find((object) => object.ref.name === 'order')?.columns.find((candidate) => candidate.name === column)
  if (meta === undefined) throw new Error(`the order has no ${column}`)
  return withColumn(withoutColumn(base, 'order', column), 'order', { ...meta, name: to })
}

/**
 * A snapshot of `base` with a foreign key from one table of the order's
 * schema onto another, said on both sides as discovery says it -- the
 * referring table's `foreignKeys` and the referred one's `referencedBy`
 * (0049) -- and made the one way a snapshot is made: the database after
 * `alter table ... add constraint ... foreign key ... on delete ...`. A key
 * of that name there already is replaced, which is the database after it
 * was dropped and added again with another action.
 */
export function withForeignKey(
  base: MetadataSnapshot,
  key: { from: string; name: string; columns: string[]; onto: string; referencedColumns: string[]; onDelete: ReferentialAction },
): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const find = (name: string) => {
    const object = contents.objects.find((candidate) => candidate.ref.name === name)
    if (object === undefined) throw new Error(`the snapshot has no ${name}`)
    return object
  }
  const from = find(key.from)
  const onto = find(key.onto)
  from.foreignKeys = [
    ...from.foreignKeys.filter((candidate) => candidate.name !== key.name),
    { name: key.name, columns: key.columns, references: { table: onto.ref, columns: key.referencedColumns }, onUpdate: 'no-action', onDelete: key.onDelete, enforced: true, validated: true },
  ]
  onto.referencedBy = [
    ...(onto.referencedBy ?? []).filter((candidate) => candidate.name !== key.name || candidate.table.name !== key.from),
    { table: from.ref, name: key.name, columns: key.columns, referencedColumns: key.referencedColumns, onDelete: key.onDelete, onUpdate: 'no-action', enforced: true },
  ]
  return createSnapshot(contents)
}

/** A snapshot of `base` in which its account may, or may not, DELETE from `table`, as discovery says it (0049). */
function withDeleteGrant(base: MetadataSnapshot, table: string, granted: boolean): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const object = contents.objects.find((candidate) => candidate.ref.name === table)
  if (object?.access === undefined) throw new Error(`the snapshot has no ${table} with access facts`)
  object.access = { ...object.access, delete: granted }
  return createSnapshot(contents)
}

/** A snapshot of `base` in which its account may no longer DELETE from `table`: the database after `revoke delete on ...` (0049). */
export function withoutDelete(base: MetadataSnapshot, table: string): MetadataSnapshot {
  return withDeleteGrant(base, table, false)
}

/** A snapshot of `base` in which its account may DELETE from `table`: the database after `grant delete on ...` (0049). */
export function withDelete(base: MetadataSnapshot, table: string): MetadataSnapshot {
  return withDeleteGrant(base, table, true)
}

/** A snapshot of `base` with one more gap: what the catalog hid from its account, as discovery says it (0004). */
export function withGap(base: MetadataSnapshot, gap: CoverageGap): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  return createSnapshot({ ...contents, gaps: [...contents.gaps, gap] })
}

/**
 * The same database read from another server (0068): `base`'s catalog as
 * discovery would read it there, with the version and the facts that
 * server would answer, made the one way a snapshot is made. The server is
 * outside the fingerprint, so this is the database after an in-place
 * upgrade, or a restore elsewhere, that changed nothing a form binds.
 * `server` undefined is a snapshot an adapter before 0068 took.
 */
export function onServer(base: MetadataSnapshot, serverVersion: string, server: ServerFacts | undefined): MetadataSnapshot {
  const { fingerprint: _, server: _server, ...contents } = structuredClone(base)
  return createSnapshot({ ...contents, serverVersion, ...(server === undefined ? {} : { server }) })
}
