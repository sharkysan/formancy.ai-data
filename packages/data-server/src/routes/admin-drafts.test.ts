import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ColumnMeta } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import type { ConfigurationStore } from '../config-store.js'
import { REFUSALS } from '../governance.js'
import { ADMIN_OPERATIONS } from './admin-audit.js'
import {
  answer,
  app,
  approve,
  as,
  col,
  db,
  EMPLOYEE,
  fresh,
  plane,
  proposed,
  published,
  queue,
  read,
  reject,
  root,
  serve,
  store,
  submit,
  TEXT,
  useDrafts,
  versionFile,
} from './test-drafts.js'

/*
 * Publication under review (0065): with publisher roles set, nobody writes
 * a version alone. An administrator submits a draft, kept beside the
 * versions; a publisher who did not submit it approves it, which writes
 * the draft's bundle as the next version, after every check a publish
 * makes and the gate an import passes, run again against the database as
 * it is then. The database is a fake adapter whose discovery the test
 * changes (test-drafts.ts), as in admin-promotion.test.ts; what this
 * proves is the routes' own decisions. The drafts store itself -- an entry
 * damaged on disk, a volume that cannot be read, concurrent appends, the
 * queue -- is admin-drafts-store.test.ts's.
 */

useDrafts()

describe('writing a version under review', () => {
  // Under review nobody writes a version alone. A publisher who could
  // still publish or import directly would be one person putting a form
  // in front of every user by themselves, which is what review is for;
  // one route left open makes the review a convention. Refused before the
  // route reads the body: a body of no shape at all is the same 403.
  test('a direct publish or import is 403 review-required for everybody, publishers included, and writes nothing', async () => {
    const bundle = await proposed()
    for (const token of ['author', 'publisher', 'submitter']) {
      for (const url of ['/v1/forms/employee/versions', '/v1/forms/employee/imports']) {
        for (const payload of [{ expectedBase: null, bundle }, { nonsense: true }]) {
          const response = await app.inject({ method: 'POST', url, headers: as(token), payload })
          expect(answer(response), `${token} ${url}`).toEqual([403, { code: 'review-required', message: REFUSALS['review-required'].message }])
        }
      }
    }
    expect(await store.latest('employee')).toBeNull()
  })

  // The draft is the bundle an author would have published, kept on the
  // server; the version an approval writes is that bundle and nothing
  // else -- not regenerated, not stamped with who approved it, which is
  // the trail's (0033). A version file with an approval written into it
  // would be a second write that can fail after the first.
  test("an author submits, a publisher approves, and the version written is the draft's bundle exactly", async () => {
    const bundle = await proposed()
    const submitted = await submit('author', { expectedBase: null, bundle })
    expect(submitted.statusCode, submitted.body).toBe(201)
    expect(submitted.json()).toEqual({ draft: 1, state: 'pending', drift: expect.objectContaining({ changes: [], blocking: false }) })
    expect(await store.latest('employee')).toBeNull()

    const approved = await approve('publisher', 1)
    expect(approved.statusCode, approved.body).toBe(201)
    expect(approved.json()).toEqual({ version: 1, drift: expect.objectContaining({ changes: [], blocking: false }) })
    expect(await versionFile(1)).toBe(`${JSON.stringify(bundle, null, 2)}\n`)
    expect(await readdir(join(root, 'employee'))).toEqual(['1.json'])
    expect((await readdir(root)).sort()).toEqual(['.drafts', 'employee'])
    expect((await read('author', 1)).json()).toMatchObject({
      form: 'employee',
      draft: 1,
      state: 'published',
      expectedBase: null,
      submittedBy: 'author',
      keysConfirmed: [],
      current: 1,
      bundle,
    })
    expect((await queue('publisher')).json()).toEqual({ drafts: [], unreadable: [] })
  })

  // Restoring and deciding on another's draft are a publisher's: an author
  // who could approve would be the review's second pair of eyes by holding
  // the same role as the first. Restore stays one publisher's action, and
  // needs no draft: what it writes was reviewed when it was first written.
  test("an author is refused approving or rejecting another's draft and restoring; a publisher restores alone", async () => {
    const bundle = await proposed()
    await submit('colleague', { expectedBase: null, bundle })
    for (const response of [await approve('author', 1), await reject('author', 1)]) {
      expect(answer(response)).toEqual([403, { code: 'publisher-required', message: REFUSALS['publisher-required'].message }])
    }
    expect((await read('author', 1)).json()).toMatchObject({ state: 'pending' })
    expect((await approve('publisher', 1)).statusCode).toBe(201)

    const restore = (token: string) =>
      app.inject({ method: 'POST', url: '/v1/forms/employee/restorations', headers: as(token), payload: { version: 1, expectedBase: 1 } })
    expect(answer(await restore('author'))).toEqual([403, { code: 'publisher-required', message: REFUSALS['publisher-required'].message }])
    expect(await store.versions('employee')).toEqual([1])
    const restored = await restore('publisher')
    expect([restored.statusCode, restored.json().version]).toEqual([201, 2])
  })

  // Four eyes, whatever roles the submitter holds: who submitted is the
  // token's subject, never a body's word, or a publisher could submit as
  // someone else and approve their own work.
  test('whoever submitted a draft never approves it, whatever roles they hold, and a body cannot say who submitted it', async () => {
    const submitted = await submit('submitter', { expectedBase: null, bundle: await proposed(), submittedBy: 'publisher' })
    expect(submitted.statusCode, submitted.body).toBe(201)
    expect((await read('publisher', 1)).json().submittedBy).toBe('submitter')
    expect(answer(await approve('submitter', 1))).toEqual([403, { code: 'own-draft', message: REFUSALS['own-draft'].message }])
    expect(await store.latest('employee')).toBeNull()
    expect((await approve('publisher', 1)).statusCode).toBe(201)
  })

  // A draft is a change to the version it was submitted over. Once
  // another version replaced that one, approving it would publish over
  // something its author never saw: refused with the newest version, out
  // of the queue, and not rejected either, since nothing can approve it.
  test('a draft whose base another version replaced is stale: 409 with the current version, out of the queue, and not rejectable', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    await submit('colleague', { expectedBase: null, bundle: await proposed({ role: 'manager' }) })
    expect((await approve('publisher', 1)).statusCode).toBe(201)
    expect((await read('colleague', 2)).json()).toMatchObject({ state: 'stale', current: 1 })
    for (const response of [await approve('publisher', 2), await reject('publisher', 2)]) {
      expect([response.statusCode, response.json()]).toEqual([
        409,
        { code: 'stale', message: expect.stringMatching(/^Draft 2 of employee was submitted as the first version/), current: 1 },
      ])
    }
    expect((await queue('publisher')).json()).toEqual({ drafts: [], unreadable: [] })
    expect(await store.versions('employee')).toEqual([1])
  })

  // The cost 0065 names: "published" is derived, by equal bytes at the
  // version after its base, and asked before a rejection is. Two drafts of
  // the same bundle on one base both read published once either is
  // approved -- which is what is served -- and so does a third rejected
  // before the approval, whose bundle is served all the same.
  test('drafts of one bundle on one base all read published once one is approved, a rejected one included', async () => {
    const bundle = await proposed()
    await submit('author', { expectedBase: null, bundle })
    await submit('colleague', { expectedBase: null, bundle })
    await submit('author', { expectedBase: null, bundle })
    expect((await reject('publisher', 3)).statusCode).toBe(201)
    expect((await approve('publisher', 2)).statusCode).toBe(201)
    expect(await Promise.all([1, 2, 3].map(async (draft) => (await read('publisher', draft)).json().state))).toEqual(['published', 'published', 'published'])
    expect((await read('publisher', 3)).json()).toMatchObject({ rejectedBy: 'publisher', withdrawn: false })
    expect((await approve('publisher', 1)).json()).toMatchObject({ code: 'published' })
  })

  // A rejection is an entry beside the draft, never an edit of it, and
  // says who rejected. A rejected draft is decided: approving it, or
  // rejecting it again, would be a second decision on one draft.
  test("a publisher rejects another's draft; it reads rejected, by whom, and is refused approval and a second rejection", async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    const rejected = await reject('publisher', 1)
    expect(answer(rejected)).toEqual([201, { draft: 1, state: 'rejected', withdrawn: false }])
    expect((await read('author', 1)).json()).toMatchObject({ state: 'rejected', rejectedBy: 'publisher', withdrawn: false })
    for (const response of [await approve('submitter', 1), await reject('publisher', 1)]) {
      expect([response.statusCode, response.json().code]).toEqual([409, 'rejected'])
    }
    expect(await store.drafts().versions('employee')).toEqual([1, 2])
    expect(await store.latest('employee')).toBeNull()
    expect((await queue('publisher')).json()).toEqual({ drafts: [], unreadable: [] })
  })

  // An author takes back what they submitted without a publisher: a
  // rejection by its own submitter, which is a withdrawal, said as one.
  // The rejection's own entry takes a number, so the next draft is 3.
  test('a submitter withdraws their own draft, publisher or not, and the answer and the read say it was withdrawn', async () => {
    const bundle = await proposed()
    await submit('author', { expectedBase: null, bundle })
    expect(answer(await reject('author', 1))).toEqual([201, { draft: 1, state: 'rejected', withdrawn: true }])
    expect((await read('publisher', 1)).json()).toMatchObject({ state: 'rejected', rejectedBy: 'author', withdrawn: true })
    expect((await submit('submitter', { expectedBase: null, bundle })).json().draft).toBe(3)
    expect(answer(await reject('submitter', 3))).toEqual([201, { draft: 3, state: 'rejected', withdrawn: true }])
  })
})

describe('what an approval asks again', () => {
  // The database a draft was checked against at submit is not the one an
  // approval publishes to an hour later. A bound column dropped between
  // the two would publish a form every save of which the database
  // refuses: the approval discovers again, refuses with only the blocking
  // changes, and the draft stays pending for when the database is put back.
  test('drift between submit and approval is 409 incompatible, and the draft waits', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    db.columns = db.columns.filter((column) => column.name !== 'title')
    const refused = await approve('publisher', 1)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().code).toBe('incompatible')
    expect(refused.json().changes.map((change: { kind: string; severity: string }) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])
    db.reachable = false
    const down = await approve('publisher', 1)
    expect([down.statusCode, down.json().code]).toEqual([503, 'unavailable'])
    expect(down.body).not.toContain('10.0.0.5')
    expect(await store.latest('employee')).toBeNull()
    expect((await read('publisher', 1)).json().state).toBe('pending')

    db.reachable = true
    db.columns = EMPLOYEE()
    expect((await approve('publisher', 1)).statusCode).toBe(201)
  })

  // A submit runs what an approval runs, short of the four eyes and the
  // write, so an author learns at once what no publisher could approve.
  // Each refusal keeps nothing: a draft that could never be approved
  // would only wait in the queue.
  test('a submit is refused for what an approval would refuse, and keeps nothing', async () => {
    const bundle = await proposed()
    const edited = JSON.parse(JSON.stringify(bundle)) as { snapshot: { objects: Array<{ columns: Array<{ name: string; type: { maxLength?: number } }> }> } }
    const name = edited.snapshot.objects[0]?.columns.find((column) => column.name === 'name')
    if (name !== undefined) name.type.maxLength = 4000
    const snapshotEdited = await submit('author', { expectedBase: null, bundle: edited })
    expect([snapshotEdited.statusCode, snapshotEdited.json().code]).toEqual([422, 'invalid-bundle'])
    expect((await submit('author', { expectedBase: null, bundle }, 'staff')).json()).toMatchObject({
      code: 'invalid-bundle',
      message: "The form's id is employee, not staff.",
    })

    db.allowlist = ['erp', 'crm']
    const crm = await proposed({ connection: 'crm' })
    db.allowlist = ['erp']
    expect(answer(await submit('author', { expectedBase: null, bundle: crm }))).toEqual([
      422,
      {
        code: 'invalid-bundle',
        message:
          "No connection is called crm in this deployment: a version keeps its connection's name, which each deployment's allowlist resolves to its own database.",
      },
    ])

    db.engine = 'postgres'
    expect(answer(await submit('author', { expectedBase: null, bundle }))).toEqual([
      422,
      {
        code: 'other-engine',
        message:
          "This draft cannot be submitted: connection erp is a postgres database here, and the version is bound to sqlserver. A form's bindings belong to one engine.",
      },
    ])
    db.engine = 'sqlserver'

    db.columns = db.columns.filter((column) => column.name !== 'title')
    const incompatible = await submit('author', { expectedBase: null, bundle })
    expect([incompatible.statusCode, incompatible.json().code, incompatible.json().changes.length]).toEqual([409, 'incompatible', 1])
    db.columns = EMPLOYEE()

    db.reachable = false
    const down = await submit('author', { expectedBase: null, bundle })
    expect([down.statusCode, down.json().code]).toEqual([503, 'unavailable'])
    expect(down.body).not.toContain('10.0.0.5')
    db.reachable = true

    // Over a version that is not the newest: the conflict a publish answers, before anything is kept.
    expect(answer(await submit('author', { expectedBase: 1, bundle }))).toEqual([409, { code: 'conflict', message: expect.any(String), current: null }])
    expect(await store.drafts().list()).toEqual([])
  })

  // 0039 under review: the keys a draft confirms are the author's
  // decision, kept in the draft, and the approval publishes with them. A
  // draft that granted on a key now standing for another column, unasked,
  // is refused at submit with the keys to confirm. The table had job_title
  // and "job title", so job_title_2 stood for "job title"; then job_title
  // went and "job-title" came, and every key moved.
  test('a reassigned key is 422 at submit until confirmed; the draft keeps the confirmation, and its approval publishes', async () => {
    const job = [col('job_title', 5, TEXT, { nullable: true }), col('job title', 6, TEXT, { nullable: true })]
    db.columns.push(...job)
    await published(await proposed())
    db.columns = [
      ...db.columns.filter((column) => column.name !== 'job_title' && column.name !== 'job title'),
      job[1] as ColumnMeta,
      col('job-title', 7, TEXT, { nullable: true }),
    ]
    const bundle = await proposed()
    const column = (name: string) => ({ kind: 'column', column: name })
    const reassigned = [
      { field: 'job_title', was: column('job_title'), now: column('job title') },
      { field: 'job_title_2', was: column('job title'), now: column('job-title') },
    ]
    const undecided = await submit('author', { expectedBase: 1, bundle })
    expect(undecided.statusCode).toBe(422)
    expect(undecided.json()).toMatchObject({ code: 'keys-reassigned', keys: reassigned })
    const confirmed = await submit('author', { expectedBase: 1, bundle, keysConfirmed: reassigned })
    expect(confirmed.statusCode, confirmed.body).toBe(201)
    const draft = (confirmed.json() as { draft: number }).draft
    expect((await read('publisher', draft)).json().keysConfirmed).toEqual(reassigned)
    const approved = await approve('publisher', draft)
    expect([approved.statusCode, approved.json().version]).toEqual([201, 2])
  })

  // An approval asks the database, which takes as long as the database
  // does, and another publisher may reject the draft meanwhile. The
  // rejection is asked for again just before the write, so it decides: a
  // draft rejected while its approval waited is not published. Watched
  // failing (201) with that second look taken out.
  test('a rejection made while an approval asks the database decides first', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    db.discovering = async () => {
      db.discovering = async () => {}
      expect((await reject('submitter', 1)).statusCode).toBe(201)
    }
    const approved = await approve('publisher', 1)
    expect([approved.statusCode, approved.json().code]).toEqual([409, 'rejected'])
    expect(await store.latest('employee')).toBeNull()
  })

  // The window that second look leaves: a rejection that lands while the
  // version is being written. Both succeed -- the two stores share no
  // compare-and-swap -- and the version is served. The draft then reads
  // what is served, published: a rejection beside a version that is
  // already the form decides nothing, and a publisher who rejected it and
  // reads it again must not be told their rejection held while the form is
  // live. A rejection after that is 409 published. Watched failing, the
  // draft reading rejected, with a rejection decided before publication.
  test('a rejection that lands while the approval writes the version leaves the draft reading published', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    const rejections: number[] = []
    const writing: ConfigurationStore = {
      ...store,
      publish: async (id, expectedBase, document) => {
        rejections.push((await reject('submitter', 1, 'employee', racing)).statusCode)
        return store.publish(id, expectedBase, document)
      },
    }
    const racing = await serve(true, writing)
    const approved = await approve('publisher', 1, 'employee', racing)
    expect([approved.statusCode, approved.json().version, rejections]).toEqual([201, 1, [201]])
    expect((await read('submitter', 1)).json()).toMatchObject({ state: 'published', rejectedBy: 'submitter', current: 1 })
    expect([...(await queue('publisher')).json().drafts]).toEqual([])
    const late = await reject('submitter', 1)
    expect([late.statusCode, late.json().code]).toEqual([409, 'published'])
  })

  // Two publishers approving two drafts over one base at the same moment:
  // the versions store's compare-and-swap decides, and the other is told,
  // as a stale draft or a conflict, without overwriting the first.
  test('two approvals over one base at once: one publishes, the other is refused, and nothing is overwritten', async () => {
    await submit('author', { expectedBase: null, bundle: await proposed() })
    await submit('colleague', { expectedBase: null, bundle: await proposed({ role: 'manager' }) })
    const answers = await Promise.all([approve('publisher', 1), approve('submitter', 2)])
    expect(answers.map((each) => each.statusCode).sort()).toEqual([201, 409])
    expect(['conflict', 'stale']).toContain(answers.find((each) => each.statusCode === 409)?.json().code)
    expect(await store.versions('employee')).toEqual([1])
  })
})

describe('without review', () => {
  // Unset, the setting changes nothing: an administrator publishes,
  // imports and restores alone, the draft routes are not routes, and the
  // administration answer says so -- so a studio asks rather than guesses.
  test('the draft routes do not exist, an administrator publishes alone, and the administration answer says review is off', async () => {
    const plain = await serve(false)
    expect((await plain.inject({ method: 'GET', url: '/v1/administration', headers: as('author') })).json()).toEqual({
      review: false,
      publisher: true,
      refuses: {
        browse: {
          code: 'browse-role-required',
          message: "Reading a connection's rows needs a browse role, which this deployment gives to nobody or not to you.",
        },
      },
    })
    for (const [method, url] of [
      ['GET', '/v1/drafts'],
      ['POST', '/v1/forms/employee/drafts'],
      ['GET', '/v1/forms/employee/drafts/1'],
      ['POST', '/v1/forms/employee/drafts/1/approval'],
      ['POST', '/v1/forms/employee/drafts/1/rejection'],
    ] as const) {
      expect((await plain.inject({ method, url, headers: as('author') })).statusCode, `${method} ${url}`).toBe(404)
    }
    const bundle = await proposed({ on: plain })
    expect(
      (await plain.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: as('author'), payload: { expectedBase: null, bundle } })).statusCode,
    ).toBe(201)
    expect(
      (await plain.inject({ method: 'POST', url: '/v1/forms/employee/restorations', headers: as('author'), payload: { version: 1, expectedBase: 1 } }))
        .statusCode,
    ).toBe(201)
    expect(await store.versions('employee')).toEqual([1, 2])
  })
})

/** `route.url` with each parameter given a value: the connection, the form, version 1, and `draft`. */
const sampled = (url: string, draft: number) =>
  url
    .replace(':id', url.startsWith('/v1/connections/') ? 'erp' : 'employee')
    .replace(':version', '1')
    .replace(':draft', String(draft))
const routeKey = (route: { method: string; url: string }) => `${route.method} ${route.url}`

describe('what the answers say a caller may do, against what every route does', () => {
  /** What the grant alone refuses each caller, and what it refuses them on a draft the submitter holds, or on their own. */
  const RR = 'review-required'
  const PR = 'publisher-required'
  // No caller here holds a browse role, and browsing is refused review or not (0099).
  const BR = 'browse-role-required'
  const EXPECTED = {
    author: {
      refuses: { publish: RR, import: RR, restore: PR, 'draft-approve': PR, 'draft-reject': PR, browse: BR },
      submitters: { approve: PR, reject: PR },
      own: { approve: PR },
    },
    publisher: { refuses: { publish: RR, import: RR, browse: BR }, submitters: {}, own: { approve: 'own-draft' } },
    submitter: { refuses: { publish: RR, import: RR, browse: BR }, submitters: { approve: 'own-draft' }, own: { approve: 'own-draft' } },
  } as const

  /** A body every route of the plane accepts, as far as its shape goes: a proposal, a publish over version 1, a restore of version 1. */
  const body = (bundle: unknown) => ({
    connection: 'erp',
    root: { schema: 'sales', name: 'employee' },
    formId: 'employee',
    title: 'Employee',
    expectedBase: 1,
    bundle,
    version: 1,
  })

  // The studio draws its buttons from the administration answer and a
  // draft's `refuses`; a route that then refused what the answer allowed,
  // or allowed what it refused, would be two decisions where 0065 makes
  // one. For each caller kind, every route the router holds is sent, in a
  // deployment of its own with version 1 published and a draft pending
  // over it -- the submitter's, and for the draft routes the caller's own
  // too -- and its answer compared with what the answers derived. An
  // allowed route must answer 2xx, so the body was one it accepts; and the
  // derived refusals are held to the table, so a server that refused
  // nothing would not pass by agreeing with itself.
  test.each(['author', 'publisher', 'submitter'] as const)(
    "for %s, every route answers what the administration answer and the draft's refuses say",
    async (caller) => {
      const bundle = await proposed()
      const expected = EXPECTED[caller]
      const { routes } = await plane()
      expect(routes.map(routeKey).sort()).toEqual(Object.keys(ADMIN_OPERATIONS).sort())
      const results: Array<{ route: string; whose: string; derived: string; answered: string }> = []
      for (const route of routes) {
        const operation = ADMIN_OPERATIONS[routeKey(route)]
        for (const whose of route.url.includes(':draft') ? (['submitters', 'own'] as const) : (['submitters'] as const)) {
          await fresh()
          const { app: deployment } = await plane()
          await store.publish('employee', null, bundle)
          const pending = await submit(whose === 'own' ? caller : 'submitter', { expectedBase: 1, bundle }, 'employee', deployment)
          const draft = (pending.json() as { draft: number }).draft
          const administration = (await deployment.inject({ method: 'GET', url: '/v1/administration', headers: as(caller) })).json() as {
            review: boolean
            publisher: boolean
            refuses: Record<string, { code: string; message: string }>
          }
          const read = (await deployment.inject({ method: 'GET', url: `/v1/forms/employee/drafts/${String(draft)}`, headers: as(caller) })).json() as {
            refuses: Record<string, { code: string; message: string }>
          }
          expect(administration).toMatchObject({ review: true, publisher: caller !== 'author' })
          expect(Object.fromEntries(Object.entries(administration.refuses).map(([name, refusal]) => [name, refusal.code]))).toEqual(expected.refuses)
          expect(Object.fromEntries(Object.entries(read.refuses).map(([name, refusal]) => [name, refusal.code]))).toEqual(expected[whose])
          const derived =
            operation === 'draft-approve'
              ? read.refuses['approve']
              : operation === 'draft-reject'
                ? read.refuses['reject']
                : administration.refuses[operation ?? '']
          const response = await deployment.inject({
            method: route.method as 'GET',
            url: sampled(route.url, draft),
            headers: as(caller),
            ...(route.method === 'POST' ? { payload: body(bundle) } : {}),
          })
          const answered =
            response.statusCode === 403
              ? (response.json() as { code: string }).code
              : response.statusCode < 300
                ? 'allowed'
                : `answered ${String(response.statusCode)}: ${response.body}`
          if (derived !== undefined && response.statusCode === 403) expect(response.json(), routeKey(route)).toEqual(derived)
          results.push({ route: routeKey(route), whose, derived: derived?.code ?? 'allowed', answered })
        }
      }
      expect(results.filter((result) => result.derived !== result.answered)).toEqual([])
    },
  )

  // The property review exists for, derived from the router rather than a
  // list: whatever route an author sends, with a body that would write
  // for a publisher, and whichever draft it names -- a colleague's or
  // their own -- no version is written and none changes.
  test('an author writes no version on any route', async () => {
    const bundle = await proposed()
    await store.publish('employee', null, bundle)
    const before = await versionFile(1)
    const { app: deployment, routes } = await plane()
    const others = ((await submit('colleague', { expectedBase: 1, bundle }, 'employee', deployment)).json() as { draft: number }).draft
    const own = ((await submit('author', { expectedBase: 1, bundle }, 'employee', deployment)).json() as { draft: number }).draft
    let sent = 0
    for (const route of routes) {
      for (const draft of route.url.includes(':draft') ? [others, own] : [others]) {
        await deployment.inject({
          method: route.method as 'GET',
          url: sampled(route.url, draft),
          headers: as('author'),
          ...(route.method === 'POST' ? { payload: body(bundle) } : {}),
        })
        sent += 1
      }
    }
    expect(sent).toBeGreaterThan(Object.keys(ADMIN_OPERATIONS).length)
    expect(await store.versions('employee')).toEqual([1])
    expect(await versionFile(1)).toBe(before)
    expect((await readdir(root)).sort()).toEqual(['.drafts', 'employee'])
  })

  // The answer is the caller's, and a clerk is not one: the plane's door
  // refuses them before any governance is asked.
  test('a clerk is refused the administration answer as every route of the plane', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/administration', headers: as('clerk') })
    expect([response.statusCode, response.json().code]).toEqual([403, 'forbidden'])
    expect((await app.inject({ method: 'GET', url: '/v1/administration' })).statusCode).toBe(401)
  })
})
