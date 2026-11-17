// The studio gate's planes: the real server, as the suite runs it -- the
// captured databases behind a fake registry, a store on a temporary
// directory, literal tokens. One plane as most deployments run, where every
// administrator publishes, and a browse role reads rows (0099) as
// FORMANCY_DATA_BROWSE_ROLES=data-browser starts it; and one under review
// (0065), as FORMANCY_DATA_PUBLISHER_ROLES=data-publisher starts it, where
// an author submits a draft and a publisher who did not submit it approves
// it.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot } from '@formancy/data-core'
import { createDataServer, createFileConfigurationStore } from '@formancy/data-server'
import { APP } from './serve.mjs'

/** `admin` is an administrator, and under review an author; `publisher` holds the publisher role alone; `browser` administers and browses. */
export const TOKENS = { admin: 'browser-gate-administrator', publisher: 'browser-gate-publisher', browser: 'browser-gate-browser' }

export const snapshot = (name) => JSON.parse(readFileSync(join(APP, 'src', 'fixtures', name), 'utf8'))

/**
 * A captured database with the fixture's routines in it, as its account's
 * discovery reports them when its scope asks (0158, 0163): the suite's
 * `withRoutines` (src/test-server.ts), from the same file, which
 * src/fixtures.test.ts holds to the model both adapters answer to.
 */
export function withRoutines(name) {
  const { fingerprint: _, ...contents } = snapshot(name)
  const facts = JSON.parse(readFileSync(join(APP, 'src', 'fixtures', 'routines.json'), 'utf8'))[name]
  return createSnapshot({ ...contents, scope: { ...contents.scope, routines: true }, routines: facts.routines, gaps: [...contents.gaps, ...facts.gaps] })
}

/** A database as a discovery whose scope does not ask for routines reads it: the captured file it always was (0158). */
function withoutRoutines(base) {
  const { fingerprint: _, routines: _routines, scope, gaps, ...contents } = base
  const { routines: _asked, ...plain } = scope
  return createSnapshot({ ...contents, scope: plain, gaps: gaps.filter((gap) => gap.aspect !== 'routines') })
}

const IDENTITIES = new Map([
  [TOKENS.admin, { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } }],
  [TOKENS.publisher, { actor: { id: 'grace', roles: ['data-publisher'] }, attributes: { tenant: '1' } }],
  [TOKENS.browser, { actor: { id: 'bo', roles: ['data-admin', 'data-browser'] }, attributes: { tenant: '1' } }],
])

/**
 * The rows a browse reads, by `schema.name`: an order wider than a phone,
 * with a long note and a NULL, so the grid scrolls inside its own region;
 * and the customer and the employee it refers to, so a row's foreign key
 * can be followed and a NULL one is said (0103). Narrowed by the request's
 * equal values, each spelled as the rows hold it, and by the person's
 * filter (0104) as far as `holds` compares it, and paged by offset and
 * limit; what a database does with a sort, a search, a filter or another
 * spelling is the adapter and parity suites' to prove (0003).
 */
const ORDER = {
  tenant_id: '1',
  customer_no: '1001',
  order_date: '2026-10-08',
  status: 'placed',
  amount: '99999999999999.9999',
  group: 'A',
  created_by: '1',
  approved_by: null,
  row_version: '1',
}
const ROWS = new Map([
  [
    'sales.order',
    [
      { id: '9007199254740993', ...ORDER, notes: 'Deliver to the loading dock at the back of the building, not the front desk.' },
      { id: '9007199254740995', ...ORDER, notes: null, status: 'shipped' },
    ],
  ],
  [
    'sales.customer',
    [
      { tenant_id: '1', customer_no: '1001', name: 'Muster AG', country_code: 'CH' },
      { tenant_id: '1', customer_no: '1002', name: 'Beispiel GmbH', country_code: 'DE' },
    ],
  ],
  ['sales.employee', [{ id: '1', name: 'Ada Lovelace', manager_id: null }]],
  [
    'sales.customer_summary',
    [
      { tenant_id: '1', customer_no: '1001', name: 'Muster AG', order_count: '2' },
      { tenant_id: '2', customer_no: '1001', name: 'Other Tenant GmbH', order_count: '1' },
    ],
  ],
])

/**
 * Whether a row holds one condition of the filter, as `RecordFilter` says
 * an adapter compares it: an equal value exactly, NULL or not. The states
 * the gate measures ask for nothing else; a range or a contains is
 * refused rather than ignored, so a state that asked for one would fail
 * here instead of measuring a page the filter did not narrow. The
 * studio's suite compares every operator (src/test-server.ts).
 */
function holds(values, condition) {
  const value = values[condition.column] ?? null
  if (condition.op === 'equals') return value !== null && String(value) === condition.value
  if (condition.op === 'null') return value === null
  if (condition.op === 'not-null') return value !== null
  throw new Error(`the gate's plane compares no ${condition.op} condition`)
}

const records = {
  list: async (request) => {
    const rows = (ROWS.get(`${request.target.table.schema}.${request.target.table.name}`) ?? []).filter(
      (values) => request.equal.every((term) => values[term.name] === term.value) && request.filter.every((condition) => holds(values, condition)),
    )
    const page = rows.slice(request.offset, request.offset + request.limit + 1)
    return { ok: true, described: null, rows: page.map((values) => ({ values, version: null })) }
  },
}

/**
 * A plane; `review: true` puts publication under review. `databases` is
 * mutable so a run can drift one.
 */
export async function startPlane({ review = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-studio-gate-'))
  const databases = new Map([
    ['fixture', withRoutines('postgres-owner.json')],
    ['fixture-reader', withRoutines('postgres-reader.json')],
    ['fixture-sqlserver', withRoutines('sqlserver-owner.json')],
    ['fixture-sqlserver-reader', withRoutines('sqlserver-reader.json')],
    ['fixture-writer', withRoutines('postgres-writer.json')],
  ])
  const registry = {
    ids: () => [...databases.keys()].sort(),
    scope: (id) => (databases.has(id) ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      const now = databases.get(id)
      if (now === undefined) return undefined
      // The ping answers the server the capture records (0068), as the adapters read it beside discovery.
      const adapter = {
        kind: now.kind,
        ping: async () => ({ kind: now.kind, version: now.serverVersion, ...now.server }),
        // As the scope asks (0158): one a run put in without routines cannot answer a discovery that asks for them.
        discover: async (scope) => {
          const current = databases.get(id)
          if (scope.routines !== true) return current.routines === undefined ? current : withoutRoutines(current)
          if (current.routines === undefined) throw new Error(`the snapshot of ${id} records no routines, so nothing can answer a discovery that asks for them`)
          return current
        },
        close: async () => {},
      }
      return { adapter, lookups: {}, records }
    },
    close: async () => {},
  }
  const verifyIdentity = async (token) => (IDENTITIES.has(token) ? { ok: true, identity: IDENTITIES.get(token) } : { ok: false, reason: 'ERR_JWS_INVALID' })
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const audit = { sink: () => {} }
  const store = createFileConfigurationStore(root)
  const admin = review
    ? { registry, store, adminRoles: ['data-admin', 'data-publisher'], publisherRoles: ['data-publisher'], audit }
    : { registry, store, adminRoles: ['data-admin', 'data-browser'], browseRoles: ['data-browser'], audit }
  const server = await createDataServer({ verifyIdentity, admin })
  return {
    server,
    databases,
    root,
    close: async () => {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
