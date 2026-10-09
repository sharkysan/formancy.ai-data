import type { FormSchema } from '@formancy/spec'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
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
  plane = await startPlane()
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
function request(kind: LookupRequest['kind'], options: { query?: string; values?: readonly string[]; limit?: number; signal?: AbortSignal } = {}): LookupRequest {
  return { kind, query: options.query ?? '', values: options.values ?? [], limit: options.limit ?? 50, signal: options.signal ?? new AbortController().signal }
}

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
    const options = await sources[source]?.resolve(request('search', { query: 'Muster', limit: 20 }))
    expect(options).toEqual([{ value: expect.stringMatching(/^k1:/) as unknown, label: 'Muster AG' }])
    expect(plane.sent.map((sent) => `${sent.method} ${sent.url}`)).toEqual([`POST ${plane.base}/v1/forms/${formId}/lookups/${encodeURIComponent(source)}/query`])
    expect(body(0)).toEqual({ operation: 'create', search: 'Muster', limit: 20 })
    expect(plane.sent[0]?.headers['authorization']).toBe(`Bearer ${plane.tokens.clerk}`)
  })

  // (j) The plain select's path: the generator emits a select with no widget,
  // which asks once with an empty query and lists the first page. A source
  // that refused an empty search would leave every generated lookup empty.
  test('an empty search lists the tenant’s customers', async () => {
    const { form, source } = await published()
    const options = await lookupSources(plane.client(), formId, form, 'create')[source]?.resolve(request('search'))
    expect(options?.map((option) => option.label)).toEqual(['Muster AG'])
    expect(body(0)).toEqual({ operation: 'create', search: '', limit: 50 })
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

  // (g) A document is untrusted input to the route: a name that tries to
  // climb out of the lookups path stays one encoded segment, under this form's
  // lookups, and the server answers that it has no such lookup. No records
  // route is reached, whatever the name says.
  test('a source name is one path segment under this form’s lookups', async () => {
    const { form } = await published()
    const climbing: FormSchema = { ...form, model: { ...form.model, fields: [{ key: 'customer', type: 'select', optionsSource: '../records/read' }] } }
    const sources = lookupSources(plane.client(), formId, climbing, 'create')
    await expect(sources['../records/read']?.resolve(request('search'))).rejects.toThrow('This form has no lookup called ../records/read.')
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
