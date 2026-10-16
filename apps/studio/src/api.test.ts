// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. The client against the real
// server, route by route.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Bundle, ProposalRequest } from './api.js'
import { isFormId } from './choice.js'
import { OWNER_SNAPSHOT, renamedOrderColumn, startPlane, TOKENS, withoutColumn } from './test-server.js'
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
  const { form, bindings, snapshot, generation } = proposal.value
  // Format 2 (0030): the generated base, nothing chosen over it, and the request it came from.
  return { format: 2, connection: 'fixture', generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot }
}

describe('the administrator plane, through the studio client', () => {
  // Each route answers in the shape the studio reads. Were the server to
  // rename a field, the step that shows it would go blank; here it is a
  // failure that names the route.
  test('reads every route the studio uses in the shape the server sends', async () => {
    expect(await admin.whoami()).toEqual({ ok: true, value: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } })
    expect(await admin.connections()).toEqual({ ok: true, value: ['fixture', 'fixture-reader', 'fixture-sqlserver', 'fixture-sqlserver-reader', 'fixture-writer'] })
    expect(await admin.test('fixture')).toEqual({ ok: true, value: { kind: 'postgres', version: '17.11' } })
    // The connection whose catalog hides what it may not use, and says so as gaps (0027).
    const metadata = await admin.metadata('fixture-sqlserver-reader')
    expect(metadata.ok && metadata.value.gaps.length).toBeGreaterThan(0)
    const proposal = await admin.propose(ORDER)
    // Delete too since 0050: the database numbers an order's key, and the owner may DELETE.
    expect(proposal.ok && proposal.value.bindings.operations).toEqual({ create: true, update: true, delete: true })
    expect(await admin.publish('sales-order', null, await bundle())).toEqual({ ok: true, value: { version: 1 } })
    const latest = await admin.latest('sales-order')
    expect(latest.ok && latest.value.version).toBe(1)
    // Nothing changed: the report says so, and that the runtime refuses nothing either (0041).
    const everything = { readable: true, writable: { create: true, update: true, delete: true } }
    expect(await admin.drift('sales-order')).toEqual({ ok: true, value: { version: 1, changes: [], blocking: false, ...everything, runtime: everything } })
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
  // about something else. Encoded, the escape makes a path the server
  // refuses before any route (0037), with its own code and sentence.
  test('keeps a name with a slash in one path segment', async () => {
    expect(await admin.metadata('a/b')).toMatchObject({ ok: false, status: 400, code: 'path-not-plain' })
    expect(plane.requests).toEqual([{ method: 'GET', path: '/v1/connections/a%2Fb/metadata' }])
  })

  // The four routes of 0030 -- versions, one version, a regeneration and a
  // restore -- each read in the shape the server sends. A renamed field would
  // blank the Drift step's version list or its regeneration; here it is a
  // failure that names the route.
  test('lists, reads, regenerates and restores versions in the shapes the server sends', async () => {
    await admin.publish('sales-order', null, await bundle())
    await admin.publish('sales-order', 1, await bundle())
    expect(await admin.versions('sales-order')).toEqual({ ok: true, value: [1, 2] })
    const first = await admin.version('sales-order', 1)
    expect(first.ok && [first.value.version, first.value.bundle.format]).toEqual([1, 2])
    const regenerated = await admin.regenerate('sales-order')
    if (!regenerated.ok) throw new Error(regenerated.message)
    const { version, conflicts, lookupsDropped, keysReassigned, policyProblems, presentation } = regenerated.value
    expect({ version, conflicts, lookupsDropped, keysReassigned, policyProblems, presentation }).toEqual({
      version: 2,
      conflicts: [],
      lookupsDropped: [],
      keysReassigned: [],
      policyProblems: [],
      presentation: EMPTY_PRESENTATION,
    })
    expect(regenerated.value.generation).toEqual(ORDER)
    // A restore names the newest version it saw, as a publish does: 1 is stale.
    expect(await admin.restore('sales-order', 1, 1)).toMatchObject({ ok: false, status: 409, code: 'conflict', current: 2 })
    expect(await admin.restore('sales-order', 1, 2)).toEqual({
      ok: true,
      value: { version: 3, restoredFrom: 1, drift: { changes: [], blocking: false, readable: true, writable: { create: true, update: true, delete: true }, runtime: { readable: true, writable: { create: true, update: true, delete: true } } } },
    })
    expect(await admin.version('sales-order', 9)).toMatchObject({ ok: false, status: 404, code: 'unknown-version' })
    expect(await admin.versions('nothing-here')).toMatchObject({ ok: false, status: 404, code: 'unknown-form' })
  })

  // A refused restore says which changes block it, and a form that cannot be
  // generated any more says what drifted. A client that kept only the
  // sentence would leave the studio saying "no" without the reason a person
  // acts on.
  test('carries the blocking changes of a refused restore, and the drift of a form that cannot be generated', async () => {
    await admin.publish('sales-order', null, await bundle())
    await admin.publish('sales-order', 1, await bundle())
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const refused = await admin.restore('sales-order', 1, 2)
    expect(refused).toMatchObject({ ok: false, status: 409, code: 'incompatible' })
    expect(!refused.ok && refused.changes?.map((change) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])

    // The confirmed version column gone: nothing can be generated from the stored request.
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'row_version'))
    const cannot = await admin.regenerate('sales-order')
    expect(cannot).toMatchObject({ ok: false, status: 422, code: 'cannot-generate' })
    expect(!cannot.ok && cannot.drift?.changes.map((change) => change.kind)).toEqual(['concurrency-changed'])
  })

  // An import (0062) answers with the version written and the drift that
  // allowed it, and a refusal over reassigned keys carries the keys, which
  // the confirmation sends back exactly. A client that dropped `keys` would
  // leave the studio with a sentence and nothing to confirm, and an import
  // that can never be completed from the studio.
  test('imports a version file in the shape the server sends, and carries the keys of a refused one', async () => {
    const source = await startPlane()
    try {
      // Here: version 1 over the database as captured, granting on order_date.
      const granting: FormPolicy = { ...READ_ONLY, fields: { order_date: { read: ['clerk'], write: [] } } }
      expect(await admin.publish('sales-order', null, await bundle(granting))).toEqual({ ok: true, value: { version: 1 } })
      // Both databases then renamed order_date to "order date", and the other deployment published from that.
      const renamed = renamedOrderColumn(OWNER_SNAPSHOT, 'order_date', 'order date')
      plane.databases.set('fixture', renamed)
      source.databases.set('fixture', renamed)
      const there = createAdminClient({ token: TOKENS.admin, fetch: source.fetch })
      const proposal = await there.propose(ORDER)
      if (!proposal.ok) throw new Error(proposal.message)
      const { form, bindings, snapshot, generation } = proposal.value
      expect(await there.publish('sales-order', null, { format: 2, connection: 'fixture', generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy: granting, snapshot })).toMatchObject({ ok: true })
      const file = JSON.parse(await readFile(join(source.root, 'sales-order', '1.json'), 'utf8')) as unknown

      const refused = await admin.importVersion('sales-order', 1, file)
      expect(refused).toMatchObject({ ok: false, status: 422, code: 'keys-reassigned' })
      const keys = refused.ok ? undefined : refused.keys
      expect(keys).toEqual([{ field: 'order_date', was: { kind: 'column', column: 'order_date' }, now: { kind: 'column', column: 'order date' } }])
      const nothing = { readable: true, writable: { create: true, update: true, delete: true } }
      expect(await admin.importVersion('sales-order', 1, file, keys)).toEqual({ ok: true, value: { version: 2, drift: { changes: [], blocking: false, ...nothing, runtime: nothing } } })
      expect(plane.requests.at(-1)).toEqual({ method: 'POST', path: '/v1/forms/sales-order/imports', body: { expectedBase: 1, bundle: file, keysConfirmed: keys } })
    } finally {
      await source.close()
    }
  })

  // Drift runs against the database as it is now, through the real diff.
  test('reports drift after the database changes', async () => {
    await admin.publish('sales-order', null, await bundle())
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const drift = await admin.drift('sales-order')
    expect(drift.ok && drift.value.changes.map((change) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])
  })
})

/** The server's governance sentences (0065), as the client carries them. */
const REVIEW_REQUIRED = { code: 'review-required', message: 'This deployment reviews publication: submit this version as a draft, and a publisher other than you approves it.' }
const PUBLISHER_REQUIRED = { code: 'publisher-required', message: "This needs a publisher role: restoring a version, and approving or rejecting someone else's draft, are a publisher's." }
const OWN_DRAFT = { code: 'own-draft', message: 'You submitted this draft: a publisher other than you approves it.' }
const NOTHING_DRIFTED = { changes: [], blocking: false, readable: true, writable: { create: true, update: true, delete: true }, runtime: { readable: true, writable: { create: true, update: true, delete: true } } }

describe('publication under review, through the studio client', () => {
  let reviewed: TestPlane
  let author: AdminClient
  let publisher: AdminClient

  beforeEach(async () => {
    reviewed = await startPlane({ review: true })
    author = createAdminClient({ token: TOKENS.admin, fetch: reviewed.fetch })
    publisher = createAdminClient({ token: TOKENS.publisher, fetch: reviewed.fetch })
  })

  afterEach(async () => {
    await reviewed.close()
  })

  // What the studio is told it may not do is what it hides and what it
  // explains, in the server's sentences: an answer read in another shape
  // would show an author an Approve button the server refuses, or hide a
  // publisher's restore.
  test('says, for each caller, whether the deployment reviews and what it refuses them', async () => {
    expect(await admin.administration()).toEqual({ ok: true, value: { review: false, publisher: true, refuses: {} } })
    expect(await author.administration()).toEqual({
      ok: true,
      value: { review: true, publisher: false, refuses: { publish: REVIEW_REQUIRED, import: REVIEW_REQUIRED, restore: PUBLISHER_REQUIRED, 'draft-approve': PUBLISHER_REQUIRED, 'draft-reject': PUBLISHER_REQUIRED } },
    })
    expect(await publisher.administration()).toEqual({ ok: true, value: { review: true, publisher: true, refuses: { publish: REVIEW_REQUIRED, import: REVIEW_REQUIRED } } })
  })

  // A draft submitted, queued, read, approved, rejected and withdrawn, each
  // answer in the shape the review step reads. A renamed field would leave
  // the queue empty or the decision unsaid; here it names the route.
  test('submits, queues, reads, approves, rejects and withdraws drafts in the shapes the server sends', async () => {
    const sent = await bundle()
    expect(await author.submitDraft('sales-order', null, sent)).toEqual({ ok: true, value: { draft: 1, state: 'pending', drift: NOTHING_DRIFTED } })
    expect(reviewed.requests.at(-1)).toEqual({ method: 'POST', path: '/v1/forms/sales-order/drafts', body: { expectedBase: null, bundle: sent } })
    const queued = { form: 'sales-order', draft: 1, expectedBase: null, submittedBy: 'ada', title: 'Order' }
    expect(await publisher.drafts()).toEqual({ ok: true, value: { drafts: [{ ...queued, refuses: {} }], unreadable: [] } })
    // The submitter may take it back, and only take it back.
    expect(await author.drafts()).toEqual({ ok: true, value: { drafts: [{ ...queued, refuses: { approve: PUBLISHER_REQUIRED } }], unreadable: [] } })
    const read = await publisher.draft('sales-order', 1)
    if (!read.ok) throw new Error(read.message)
    const { bundle: drafted, ...rest } = read.value
    expect(rest).toEqual({ form: 'sales-order', draft: 1, state: 'pending', expectedBase: null, submittedBy: 'ada', keysConfirmed: [], current: null, refuses: {} })
    expect(drafted).toEqual(sent)

    expect(await publisher.approveDraft('sales-order', 1)).toEqual({ ok: true, value: { version: 1, drift: NOTHING_DRIFTED } })
    expect(reviewed.requests.at(-1)).toEqual({ method: 'POST', path: '/v1/forms/sales-order/drafts/1/approval' })
    const approved = await publisher.draft('sales-order', 1)
    expect(approved.ok && approved.value.state).toBe('published')

    expect(await author.submitDraft('sales-order', 1, sent)).toMatchObject({ ok: true, value: { draft: 2 } })
    expect(await publisher.rejectDraft('sales-order', 2)).toEqual({ ok: true, value: { draft: 2, state: 'rejected', withdrawn: false } })
    expect(reviewed.requests.at(-1)).toEqual({ method: 'POST', path: '/v1/forms/sales-order/drafts/2/rejection' })
    const rejected = await author.draft('sales-order', 2)
    expect(rejected.ok && [rejected.value.state, rejected.value.rejectedBy, rejected.value.withdrawn]).toEqual(['rejected', 'grace', false])

    // A rejection takes the next entry's number: the next draft is 4.
    expect(await author.submitDraft('sales-order', 1, sent)).toMatchObject({ ok: true, value: { draft: 4 } })
    expect(await author.rejectDraft('sales-order', 4)).toEqual({ ok: true, value: { draft: 4, state: 'rejected', withdrawn: true } })
    expect(await publisher.drafts()).toEqual({ ok: true, value: { drafts: [], unreadable: [] } })
  })

  // Each refusal of a draft is the server's code and sentence, with what it
  // carries: four eyes, a publisher's role, the newest version a stale draft
  // was overtaken by. A client that kept only the status would leave the
  // review step saying "no" without the reason.
  test('carries the refusals of a draft as the server words them', async () => {
    const both = createAdminClient({ token: TOKENS.both, fetch: reviewed.fetch })
    await both.submitDraft('sales-order', null, await bundle())
    expect(await both.approveDraft('sales-order', 1)).toMatchObject({ ok: false, status: 403, ...OWN_DRAFT })
    expect(await author.approveDraft('sales-order', 1)).toMatchObject({ ok: false, status: 403, ...PUBLISHER_REQUIRED })
    expect(await author.publish('sales-order', null, await bundle())).toMatchObject({ ok: false, status: 403, ...REVIEW_REQUIRED })
    // Another draft over the same base, which differs: equal bytes would read as published too.
    await author.submitDraft('sales-order', null, await bundle({ ...READ_ONLY, operations: { ...READ_ONLY.operations, read: ['auditor'] } }))
    expect(await publisher.approveDraft('sales-order', 2)).toMatchObject({ ok: true, value: { version: 1 } })
    expect(await publisher.approveDraft('sales-order', 1)).toMatchObject({ ok: false, status: 409, code: 'stale', current: 1 })
    expect(await publisher.draft('sales-order', 9)).toMatchObject({ ok: false, status: 404, code: 'unknown-draft' })
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
