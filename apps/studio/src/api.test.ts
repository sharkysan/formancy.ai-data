// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. The client against the real
// server, route by route.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Bundle, ProposalRequest } from './api.js'
import { isFormId } from './choice.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

let plane: TestPlane
let admin: AdminClient

beforeEach(async () => {
  plane = await startPlane()
  admin = createAdminClient({ token: TOKENS.admin, fetch: plane.fetch })
})

afterEach(async () => {
  await plane.close()
})

const ORDER: ProposalRequest = {
  connection: 'fixture',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'row_version',
}

const READ_ONLY: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: {}, rowFilters: [], lookups: {} }

async function bundle(policy: FormPolicy = READ_ONLY): Promise<Bundle> {
  const proposal = await admin.propose(ORDER)
  if (!proposal.ok) throw new Error(proposal.message)
  const { form, bindings, snapshot } = proposal.value
  return { format: 1, connection: 'fixture', form, bindings, policy, snapshot }
}

describe('the administrator plane, through the studio client', () => {
  // Each route answers in the shape the studio reads. Were the server to
  // rename a field, the step that shows it would go blank; here it is a
  // failure that names the route.
  test('reads every route the studio uses in the shape the server sends', async () => {
    expect(await admin.whoami()).toEqual({ ok: true, value: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } })
    expect(await admin.connections()).toEqual({ ok: true, value: ['fixture', 'fixture-reader', 'fixture-sqlserver'] })
    expect(await admin.test('fixture')).toEqual({ ok: true, value: { kind: 'postgres', version: '17.11' } })
    const metadata = await admin.metadata('fixture-reader')
    expect(metadata.ok && metadata.value.gaps.length).toBeGreaterThan(0)
    const proposal = await admin.propose(ORDER)
    expect(proposal.ok && proposal.value.bindings.operations).toEqual({ create: true, update: true })
    expect(await admin.publish('sales-order', null, await bundle())).toEqual({ ok: true, value: { version: 1 } })
    const latest = await admin.latest('sales-order')
    expect(latest.ok && latest.value.version).toBe(1)
    expect(await admin.drift('sales-order')).toEqual({ ok: true, value: { version: 1, changes: [], blocking: false, writable: { create: true, update: true } } })
  })

  // A refusal is the server's own code and sentence, with what it carries:
  // the problems of a bundle, the version somebody published first. A studio
  // that dropped them could only say "it failed".
  test('carries a refusal as the server words it', async () => {
    const stranger = createAdminClient({ token: 'not-a-token', fetch: plane.fetch })
    expect(await stranger.whoami()).toMatchObject({ ok: false, status: 401, code: 'unauthenticated' })
    const clerk = createAdminClient({ token: TOKENS.clerk, fetch: plane.fetch })
    expect(await clerk.connections()).toMatchObject({ ok: false, status: 403, code: 'forbidden', message: 'This action needs an administrator role.' })

    const ghost = await admin.publish('sales-order', null, { ...(await bundle()), policy: { ...READ_ONLY, fields: { ghost: { read: [], write: [] } } } })
    expect(ghost).toMatchObject({ ok: false, status: 422, code: 'invalid-bundle' })
    expect(!ghost.ok && ghost.problems).toEqual(['policy: fields.ghost: the form has no field ghost'])

    await admin.publish('sales-order', null, await bundle())
    expect(await admin.publish('sales-order', null, await bundle())).toMatchObject({ ok: false, status: 409, code: 'conflict', current: 1 })
    expect(await admin.latest('nothing-here')).toMatchObject({ ok: false, status: 404, code: 'unknown-form' })
  })

  // A database that is down says so in a sentence, never in the driver's
  // words, which name hosts and ports.
  test('says a database did not answer without saying where it is', async () => {
    plane.unreachable.add('fixture')
    const down = await admin.test('fixture')
    expect(down).toMatchObject({ ok: false, status: 503, code: 'unavailable' })
    expect(JSON.stringify(down)).not.toContain('10.0.0.5')
  })

  // A connection name is one path segment. Unencoded, a name with a slash
  // would reach a different route -- or none -- and the answer would be
  // about something else.
  test('keeps a name with a slash in one path segment', async () => {
    expect(await admin.metadata('a/b')).toMatchObject({ ok: false, status: 404, code: 'unknown-connection' })
  })

  // Drift runs against the database as it is now, through the real diff.
  test('reports drift after the database changes', async () => {
    await admin.publish('sales-order', null, await bundle())
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const drift = await admin.drift('sales-order')
    expect(drift.ok && drift.value.changes.map((change) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])
  })
})

describe('when the server is not the one answering', () => {
  // A page that cannot reach the server must say so, not throw into React
  // and leave a blank screen.
  test('a network failure is a failure, not a throw', async () => {
    const offline = createAdminClient({ token: TOKENS.admin, fetch: async () => Promise.reject(new TypeError('Failed to fetch')) })
    expect(await offline.whoami()).toEqual({ ok: false, status: 0, code: 'network', message: 'The data server could not be reached from this page.' })
  })

  // A proxy's error page is not the data server's answer, and is not read as
  // one: neither a success nor a refusal with a made-up message.
  test("a body that is not the server's is said to be so", async () => {
    const proxied = createAdminClient({ token: TOKENS.admin, fetch: async () => new Response('<h1>Bad gateway</h1>', { status: 502 }) })
    expect(await proxied.connections()).toMatchObject({ ok: false, status: 502, code: 'unexpected' })
    const empty = createAdminClient({ token: TOKENS.admin, fetch: async () => new Response('', { status: 200 }) })
    expect(await empty.whoami()).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
  })

  // The token is a credential: it travels in the Authorization header and in
  // no URL, where proxies and browser history keep it.
  test('sends the token in the Authorization header and nowhere else', async () => {
    const seen: Array<{ url: string; authorization: string | null }> = []
    const spy = createAdminClient({
      token: TOKENS.admin,
      fetch: async (input, init) => {
        seen.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') })
        return plane.fetch(input, init)
      },
    })
    await spy.whoami()
    await spy.metadata('fixture')
    expect(seen.map((entry) => entry.authorization)).toEqual([`Bearer ${TOKENS.admin}`, `Bearer ${TOKENS.admin}`])
    expect(seen.filter((entry) => entry.url.includes(TOKENS.admin))).toEqual([])
  })
})

describe("the studio's form id rule", () => {
  // The studio checks a form id as it is typed, and the server checks it again
  // on publish. Two copies of one rule: if they disagree, an id the studio
  // accepts is refused at the last step, or one the server takes is blocked
  // for nothing. So each candidate is put to the server, with a bundle that
  // cannot be published, and the two answers compared: the server got past
  // the id exactly when it went on to refuse the bundle (422).
  //
  // The lengths are the reason this asks the server rather than reading its
  // regular expression. The store allows 128 characters, and the router used
  // to refuse any path parameter past 100 before a handler ran — a limit no
  // regular expression shows. Found here, and fixed in the server.
  test('agrees with the server on every candidate', async () => {
    const candidates = ['sales-order', 'order.v2', 'a', '9lives', 'Order', 'sales order', '-order', '.hidden', '_x', 'ordér', ...[99, 100, 101, 128, 129].map((length) => 'x'.repeat(length))]
    for (const id of candidates) {
      const answer = await admin.publish(id, null, {} as Bundle)
      expect(isFormId(id), `${id} (${String(id.length)})`).toBe(!answer.ok && answer.code === 'invalid-bundle')
    }
    expect(isFormId('')).toBe(false)
  })
})
