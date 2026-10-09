import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup } from '@testing-library/react'
import { answer, chooseCustomer, load, openForm, said, save, shows } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane, Sent } from './test-plane.js'

/*
 * What the page sends, read off the wire after a whole journey in both
 * panes: the mirror of the studio's rule (0024) -- the host page speaks the
 * runtime plane and nothing else -- and the client's promises about the token
 * and the tenant, held where a host would break them, in the page (0029).
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

/** The runtime plane's routes, each with the method it answers, for one form. */
function routes(formId: string): ReadonlyArray<readonly [string, RegExp]> {
  return [
    ['form', new RegExp(`^GET /v1/forms/${formId}$`)],
    ['read', new RegExp(`^POST /v1/forms/${formId}/records/read$`)],
    ['create', new RegExp(`^POST /v1/forms/${formId}/records/create$`)],
    ['update', new RegExp(`^POST /v1/forms/${formId}/records/update$`)],
    ['lookup query', new RegExp(`^POST /v1/forms/${formId}/lookups/[^/]+/query$`)],
    ['lookup resolve', new RegExp(`^POST /v1/forms/${formId}/lookups/[^/]+/resolve$`)],
  ]
}

/** Every key anywhere in a parsed body, nested ones included. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)])
}

describe.each(ENGINES)('what the page sends on $engine', ({ formId }) => {
  test('only runtime routes, each carrying the token in the header and nowhere else, and never a tenant', async () => {
    plane.sent.length = 0
    const user = await openForm(plane, formId)
    // The whole journey, in both panes: a search, a create, a load that
    // resolves a label, an update.
    await chooseCustomer(user, 'Angular', 'Muster', 'Muster AG')
    await answer(user, 'Angular', 'Order date', EDGES.orderDate)
    await answer(user, 'Angular', 'Amount', '9')
    await save(user, 'Angular')
    const record = (await said('Angular', /^Created record /)).slice('Created record '.length, -1)
    await load(user, record)
    await shows('React', 'Customer', 'Muster AG')
    await answer(user, 'React', 'Amount', '10')
    await save(user, 'React')
    await said('React', /^Saved\.$/)

    const sent: Sent[] = [...plane.sent]
    const known = routes(formId)
    const line = (request: Sent): string => `${request.method} ${request.path}`

    // Nothing but the runtime plane: no whoami, no administrator route, no
    // other form. A page that asked anything else would need a role, or know
    // something, a host's person does not have.
    expect(sent.map(line).filter((said) => !known.some(([, pattern]) => pattern.test(said)))).toEqual([])
    // And the journey used every one of them, so the list above is not
    // satisfied by a page that did less.
    expect(known.filter(([, pattern]) => !sent.some((request) => pattern.test(line(request)))).map(([name]) => name)).toEqual([])

    // The token in the Authorization header of every request, and in no URL
    // and no body: a URL is in every proxy's log, a body in every dump.
    for (const request of sent) {
      expect({ request: line(request), authorization: request.headers['authorization'] }).toEqual({ request: line(request), authorization: `Bearer ${TOKENS.clerk}` })
      expect(request.url).not.toContain(TOKENS.clerk)
      expect(request.body ?? '').not.toContain(TOKENS.clerk)
    }

    // The tenant is the token's, never the form's or the page's: no body
    // names one, at any depth (0011, 0029).
    const named = sent.flatMap((request) => keys(JSON.parse(request.body ?? '{}')).filter((key) => /tenant/i.test(key)).map((key) => `${line(request)}: ${key}`))
    expect(named).toEqual([])
  })
})
