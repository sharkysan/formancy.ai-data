import { DEFAULT_MAX_PAGE_SIZE } from '@formancy/data-core'
import { blockTable, pagedCustomers } from '@formancy/data-fixtures'
import type { BlockedTable } from '@formancy/data-fixtures'
import type { FormSchema, RemoteOptionsAnswer, RemoteOptionsPage } from '@formancy/spec'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest'
import type { Refusal } from './client.js'
import { lookupSources, sourceNames } from './lookups.js'
import type { LookupOperation, LookupRequest } from './lookups.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The option sources a host hands either renderer, answering through the
 * runtime plane on both engines (formancy.ai 0077, 0012). What a tenant's
 * lookup offers is a database answer under the policy's filter, so it is
 * asked of the databases; what crosses the wire is read from the spied fetch.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ countries: true })
})

afterAll(async () => {
  await plane?.close()
})

beforeEach(() => {
  plane.sent.length = 0
})

function expectOk<T>(outcome: { ok: true; value: T } | Refusal): T {
  if (!outcome.ok) throw new Error(`expected success, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
  return outcome.value
}

/** A request as a renderer makes one: the fields the source reads, and a live signal. */
function request(
  kind: LookupRequest['kind'],
  options: { query?: string; values?: readonly string[]; limit?: number; signal?: AbortSignal } = {},
): LookupRequest {
  return { kind, query: options.query ?? '', values: options.values ?? [], limit: options.limit ?? 50, signal: options.signal ?? new AbortController().signal }
}

/**
 * The run's database, held behind a lock on `sales.country` by its owner, on
 * a connection of the helper's own. Every file of this package shares the
 * database and runs beside this one, and `waiting()` counts every session
 * the lock holds up: a lock on `sales.customer`, which the order form's
 * lookup and every order's membership check and foreign key read, would
 * count another file's statement as this case's and hold it until release
 * (2026-10-15 review). Only `pg-customer` and `ms-customer`, this file's
 * own, read `sales.country`.
 */
function countriesLocked(connection: string): Promise<BlockedTable> {
  const { pg, ms } = inject('databases')
  const table = { schema: 'sales', name: 'country' }
  if (connection === 'pg') {
    const admin = `postgres://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${String(pg.port)}/${encodeURIComponent(pg.database)}`
    return blockTable({ kind: 'postgres', admin }, table)
  }
  return blockTable(
    {
      kind: 'sqlserver',
      admin: {
        server: ms.host,
        port: ms.port,
        database: ms.database,
        user: ms.user,
        password: ms.password,
        options: { encrypt: false, trustServerCertificate: true },
      },
    },
    table,
  )
}

/** Polls until `condition` holds, or fails naming what never happened. */
async function until(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** A search's answer as a page: what `lookupSources` answers for a search; fails on a list, which says nothing of what follows. */
function pageOf(answer: RemoteOptionsAnswer | undefined): RemoteOptionsPage {
  if (answer === undefined || Array.isArray(answer)) throw new Error(`a search answered ${JSON.stringify(answer)}, not a page`)
  return answer as RemoteOptionsPage
}

/** The labels a search's page offers, in order. */
const labelsOf = (answer: RemoteOptionsAnswer | undefined): string[] => pageOf(answer).options.map((option) => option.label)

/** The body of the n-th request sent, parsed. */
function body(index: number): Record<string, unknown> {
  return JSON.parse(plane.sent[index]?.body ?? 'null') as Record<string, unknown>
}

describe.each(ENGINES)('lookups on $engine', ({ connection }) => {
  const formId = `${connection}-order`

  async function published(): Promise<{ form: FormSchema; source: string }> {
    const { form } = expectOk(await plane.client().form(formId))
    const [source] = sourceNames(form)
    if (source === undefined) throw new Error('the generated order form names no source')
    plane.sent.length = 0
    return { form, source }
  }

  // (f) One source per name the document carries, and no other: a map with
  // an extra name answers for a field the form does not have; one without the
  // customer's name renders "this application has not provided" it.
  test('lookupSources names exactly the sources the document names', async () => {
    const { form, source } = await published()
    const sources = lookupSources(plane.client(), formId, form, 'create')
    expect(Object.keys(sources)).toEqual([source])
    expect(form.model.fields.find((field) => field.key === 'customer')?.optionsSource).toBe(source)
  })

  // (f) A typeahead's search, as the renderer asks it: only tenant 1's
  // customers come back, each as the token the select stores and the label a
  // person reads. The tenant is the token's, not the request's: nothing in the
  // body names one.
  test('a search returns only the tenant’s customers, as value and label', async () => {
    const { form, source } = await published()
    const sources = lookupSources(plane.client(), formId, form, 'create')
    const answer = await sources[source]?.resolve(request('search', { query: 'Muster', limit: 20 }))
    expect(answer).toEqual({ options: [{ value: expect.stringMatching(/^k1:/) as unknown, label: 'Muster AG' }], more: false, withheld: 0 })
    expect(plane.sent.map((sent) => `${sent.method} ${sent.url}`)).toEqual([
      `POST ${plane.base}/v1/forms/${formId}/lookups/${encodeURIComponent(source)}/query`,
    ])
    expect(body(0)).toEqual({ operation: 'create', search: 'Muster', limit: 20 })
    expect(plane.sent[0]?.headers['authorization']).toBe(`Bearer ${plane.tokens.clerk}`)
  })

  // (j) The empty search: a plain select, now an unsearchable lookup's
  // control (0066), asks only "", and a typeahead asks it on mount. A source
  // that refused it would leave every such lookup empty.
  test('an empty search lists the tenant’s customers', async () => {
    const { form, source } = await published()
    expect(labelsOf(await lookupSources(plane.client(), formId, form, 'create')[source]?.resolve(request('search')))).toEqual(['Muster AG'])
    expect(body(0)).toEqual({ operation: 'create', search: '', limit: 50 })
  })

  // A search says whether its list goes on, never how long it is
  // (0085), from the server's own extra row: as tenant 3's clerk, over the
  // paged customers, the empty search answers a page of the First rows, in
  // order on both engines, and more; `First` answers exactly one page, and
  // no more, 0029's list that looked complete; `Later 07`, past the first
  // page, one row, found by typing. Watched failing on both engines with
  // the source answering a list, as it did: "a search answered [...], not a
  // page"; with `more` guessed from a full page: `First`, exactly one page,
  // said more; and with `maxRows` 49: "expected 49 to be 50".
  test('a search answers a page that says whether the list goes on, and no total', async () => {
    const { form, source } = await published()
    const sources = lookupSources(plane.client(plane.tokens.thirdClerk), formId, form, 'create')
    const lookup = sources[source]
    if (lookup === undefined) throw new Error('no source for the customer')
    expect(lookup.maxRows).toBe(DEFAULT_MAX_PAGE_SIZE)
    const first = pagedCustomers()
      .slice(0, DEFAULT_MAX_PAGE_SIZE)
      .map((customer) => customer.name)
    const empty = await lookup.resolve(request('search', { limit: lookup.maxRows }))
    expect({ labels: labelsOf(empty), more: pageOf(empty).more, withheld: pageOf(empty).withheld }).toEqual({ labels: first, more: true, withheld: 0 })
    expect(body(0)).toEqual({ operation: 'create', search: '', limit: DEFAULT_MAX_PAGE_SIZE })
    const page = await lookup.resolve(request('search', { query: 'First', limit: lookup.maxRows }))
    expect({ labels: labelsOf(page), more: pageOf(page).more }).toEqual({ labels: first, more: false })
    const later = await lookup.resolve(request('search', { query: 'Later 07', limit: lookup.maxRows }))
    expect({ labels: labelsOf(later), more: pageOf(later).more }).toEqual({ labels: ['Later 07'], more: false })
  })

  // The page is the server's: a query naming no limit is answered the
  // source's `maxRows` rows, and one past it is refused, so a renderer that
  // asks for `maxRows` is never refused and is never handed a page larger
  // than it shows. A source whose `maxRows` disagreed with the server's
  // bound would cut the server's page or be refused (watched failing on
  // both engines with `maxRows` 49: the server answered 50 rows unasked).
  test('the server answers the source’s maxRows unasked, and refuses one more', async () => {
    const { form, source } = await published()
    const maxRows = lookupSources(plane.client(), formId, form, 'create')[source]?.maxRows ?? 0
    const unasked = expectOk(await plane.client(plane.tokens.thirdClerk).query(formId, source, { operation: 'create', search: '' }))
    expect({ rows: unasked.rows.length, hasMore: unasked.hasMore }).toEqual({ rows: maxRows, hasMore: true })
    const over = await plane.client(plane.tokens.thirdClerk).query(formId, source, { operation: 'create', search: '', limit: maxRows + 1 })
    expect(over.ok ? 'answered' : { status: over.status, code: over.code }).toEqual({ status: 400, code: 'limit-out-of-range' })
  })

  // (f) A loaded record holds a token; the renderer asks for its label. A
  // token the actor may not see -- tenant 2's customer -- is simply not named,
  // which the renderer shows as an unnamed value; a source that rejected
  // instead would make the whole field "could not be loaded" for one value.
  test('labels names a stored token and leaves out one the actor may not see', async () => {
    const { form, source } = await published()
    const mine = expectOk(await plane.client().query(formId, source, { operation: 'create', search: 'Muster' })).rows[0]?.token ?? ''
    const theirs = expectOk(await plane.client(plane.tokens.otherClerk).query(formId, source, { operation: 'create', search: '' })).rows[0]?.token ?? ''
    plane.sent.length = 0
    const sources = lookupSources(plane.client(), formId, form, 'update')
    expect(await sources[source]?.resolve(request('labels', { values: [mine], limit: 1 }))).toEqual([{ value: mine, label: 'Muster AG' }])
    expect(await sources[source]?.resolve(request('labels', { values: [theirs], limit: 1 }))).toEqual([])
    expect(body(0)).toEqual({ operation: 'update', tokens: [mine] })
    expect(plane.sent.map((sent) => sent.url)).toEqual([0, 1].map(() => `${plane.base}/v1/forms/${formId}/lookups/${encodeURIComponent(source)}/resolve`))
  })

  // (f) Nothing to name, nothing to ask: a request per empty field would be a
  // round trip per lookup on every new record.
  test('labels for no values makes no request', async () => {
    const { form, source } = await published()
    expect(await lookupSources(plane.client(), formId, form, 'create')[source]?.resolve(request('labels'))).toEqual([])
    expect(plane.sent).toEqual([])
  })

  // (f) The operation is read when the request is made, not when the map is
  // built: a pane that moves from create to update after its first save asks
  // under update's filter without a new map -- which, in Angular, would mean
  // a new application.
  test('the operation getter is read on every request', async () => {
    const { form, source } = await published()
    let operation: LookupOperation = 'create'
    const sources = lookupSources(plane.client(), formId, form, () => operation)
    await sources[source]?.resolve(request('search'))
    operation = 'update'
    await sources[source]?.resolve(request('search'))
    expect([body(0)['operation'], body(1)['operation']]).toEqual(['create', 'update'])
  })

  // (f) A refusal rejects, so the renderer says "The options could not be
  // loaded" -- an empty list instead would say this tenant has no customers,
  // and an empty label list would say the stored customer is not theirs.
  // The rejection carries the server's sentence, for searches and labels alike.
  test('a refusal rejects with the server sentence', async () => {
    const { form, source } = await published()
    const sources = lookupSources(plane.client('not-a-token'), formId, form, 'create')
    await expect(sources[source]?.resolve(request('search'))).rejects.toThrow('A valid host token is required.')
    await expect(sources[source]?.resolve(request('labels', { values: ['k1:1'], limit: 1 }))).rejects.toThrow('A valid host token is required.')
  })

  // (f) A newer keystroke aborts the older search. The abort reaches the
  // renderer as the AbortError it raised, never as a refusal it would show as
  // "could not be loaded" over the answer that is still coming.
  test('an abort rejects with the AbortError', async () => {
    const { form, source } = await published()
    const controller = new AbortController()
    const pending = lookupSources(plane.client(), formId, form, 'create')[source]?.resolve(request('search', { query: 'Muster', signal: controller.signal }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  // (k) The end-to-end proof of 0061's first decision: a renderer's abort
  // stops the statement in the database, not only the browser's wait. The
  // search is made to wait behind a lock its owner holds; once it waits, the
  // signal the renderer passes is aborted, the source rejects with the
  // AbortError, and the statement stops waiting while the lock is still
  // held. Before 0061 the server passed no signal to the adapter, and the
  // statement waited until the lock went -- "the database finishes every
  // scan it started".
  test('an abort while the statement waits rejects with the AbortError, and the statement is gone', async () => {
    const customers = `${connection}-customer`
    const { form } = expectOk(await plane.client().form(customers))
    const [source] = sourceNames(form)
    if (source === undefined) throw new Error('the generated customer form names no source')
    const blocked = await countriesLocked(connection)
    try {
      const controller = new AbortController()
      const pending = lookupSources(plane.client(), customers, form, 'create')[source]?.resolve(request('search', { query: 'Sw', signal: controller.signal }))
      await until(async () => (await blocked.waiting()) === 1, 'the search waited behind the lock')
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await until(async () => (await blocked.waiting()) === 0, 'the statement stopped waiting while the lock was held')
    } finally {
      await blocked.release()
    }
  })

  // (g) A document is untrusted input to the route: a name that tries to
  // climb out of the lookups path stays one encoded segment, under this form's
  // lookups. The escape makes it a path the server refuses before any route's
  // work, 400 `path-not-plain` (0037), so no records route is reached, nor
  // the lookup's, whatever the name says, and the rejection carries the
  // server's sentence.
  test('a source name is one path segment under this form’s lookups', async () => {
    const { form } = await published()
    const climbing: FormSchema = { ...form, model: { ...form.model, fields: [{ key: 'customer', type: 'select', optionsSource: '../records/read' }] } }
    const sources = lookupSources(plane.client(), formId, climbing, 'create')
    await expect(sources['../records/read']?.resolve(request('search'))).rejects.toThrow(/^This path holds an encoded character, an empty or a dot segment/)
    expect(plane.sent.map((sent) => sent.url)).toEqual([`${plane.base}/v1/forms/${formId}/lookups/..%2Frecords%2Fread/query`])
  })

  // (g) `..` and `.` survive encodeURIComponent unchanged, and fetch
  // normalises them away: `/v1/forms/x/lookups/../query` is `/v1/forms/x/query`.
  // So they are refused before any request is made.
  test('a source named `..` or `.` rejects without a request', async () => {
    const { form } = await published()
    for (const name of ['..', '.']) {
      const dotted: FormSchema = { ...form, model: { ...form.model, fields: [{ key: 'customer', type: 'select', optionsSource: name }] } }
      await expect(lookupSources(plane.client(), formId, dotted, 'create')[name]?.resolve(request('search'))).rejects.toThrow(/cannot address/)
    }
    expect(plane.sent).toEqual([])
  })
})
