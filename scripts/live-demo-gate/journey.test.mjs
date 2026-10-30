import { describe, expect, test } from 'vitest'
import { PER_TENANT, ROLE_GRANTS } from '../../apps/live-demo/dist/worker/pure.mjs'
import { closedRoutes, cookieProblems, expectedMenu, lineTotal, pagesOf, units } from './journey.mjs'

describe('what the journey expects', () => {
  // The menu a persona sees is a claim the page makes in their sentence;
  // the gate holds it to ROLE_GRANTS, the one place it is decided, and to
  // the chain the image's forms are published with.
  test("is each role's menu as ROLE_GRANTS grants it, with the master-detail chain", () => {
    for (const [role, { may }] of Object.entries(ROLE_GRANTS)) {
      const menu = expectedMenu(role)
      expect(menu.map((form) => form.id), role).toEqual(['customer', 'delivery', 'order', 'order-line'])
      for (const form of menu) expect(form.operations, `${role} ${form.id}`).toEqual(may[form.id])
    }
    expect(expectedMenu('clerk').find((form) => form.id === 'order').children).toEqual([
      { form: 'delivery', field: 'order', one: false, when: null },
      { form: 'order-line', field: 'order', one: false, when: null },
    ])
    expect(() => expectedMenu('administrator')).toThrow(/no role administrator/)
  })

  // Nine pages of fifty for 420 orders: what a visitor pages through.
  test('is the pages a tenant’s orders fill', () => {
    expect(pagesOf(PER_TENANT.orders, 50)).toBe(9)
    expect(pagesOf(50, 50)).toBe(1)
    expect(pagesOf(51, 50)).toBe(2)
  })
})

describe('the money', () => {
  // An order's amount is numeric(…, 4) and a line's price two decimals:
  // added as floats, 0.1 + 0.2 would differ from the database's sum.
  test('adds quantity times unit price exactly, in ten-thousandths', () => {
    expect(units('12.5')).toBe(125000n)
    expect(units('0.0001')).toBe(1n)
    expect(units('-3')).toBe(-30000n)
    expect(lineTotal([{ quantity: 3, unit_price: '0.10' }, { quantity: 1, unit_price: '0.20' }])).toBe(units('0.5'))
    expect(() => units('1.23456')).toThrow(/more than four decimals/)
    expect(() => units('1e3')).toThrow(/not a decimal/)
  })
})

describe('the cookie', () => {
  const good = '__Secure-formancy-data-demo=0123456789abcdef0123456789abcdef; Path=/data/demo/; Secure; HttpOnly; SameSite=Strict'

  // The cookie is the instance's credential (0070): sent only to the
  // demo's path, only over HTTPS, never to a script, never cross-site, and
  // forgotten when the browser closes.
  test("is exactly the Worker's: its name, path and flags, and no lifetime", () => {
    expect(cookieProblems([good])).toEqual([])
    expect(cookieProblems([])).toEqual(['the sign-in set no cookie'])
    expect(cookieProblems([good, good])).toEqual(['the sign-in set 2 cookies, not one'])
    expect(cookieProblems([good.replace('; HttpOnly', '')])).toEqual(['the cookie is not HttpOnly'])
    expect(cookieProblems([`${good}; Max-Age=3600`])).toEqual(['the cookie has a lifetime (Max-Age=3600), so it outlives the browser'])
    expect(cookieProblems([good.replace('Path=/data/demo/', 'Path=/')])).toEqual(['the cookie’s Path is /, not /data/demo/'])
    expect(cookieProblems([good.replace('0123456789abcdef0123456789abcdef', 'x')])).toEqual(['the cookie’s value is not 32 lowercase hex characters'])
  })
})

describe('the routes the Worker keeps closed', () => {
  // The gate asks the Worker, and the image past it, for every route 0037's
  // runtime door does not forward, from doors.json: a list typed here would
  // miss the next administrator's route the server adds under /v1/forms.
  test("are every route doors.json does not forward, and the administrator's plane among them for the image", () => {
    const { worker, server } = closedRoutes()
    expect(worker.some((route) => route.method === 'POST' && route.sample === '/v1/forms/order/versions')).toBe(true)
    expect(worker.some((route) => route.sample === '/v1/forms/order/records/list')).toBe(false)
    expect(server.length).toBeGreaterThan(10)
    for (const route of server) expect(worker, `${route.method} ${route.path}`).toContainEqual(route)
    expect(server.some((route) => route.path === '/health' || route.path === '/v1/whoami')).toBe(false)
    const doors = { routes: [{ method: 'GET', path: '/v1/forms', sample: '/v1/forms', plane: 'runtime', runtimeDoor: 'forwarded' }, { method: 'GET', path: '/v1/whoami', sample: '/v1/whoami', plane: 'shared', runtimeDoor: 'not forwarded' }, { method: 'POST', path: '/v1/x', sample: '/v1/x', plane: 'administrator', runtimeDoor: 'not forwarded' }] }
    expect(closedRoutes(doors)).toEqual({ worker: [doors.routes[1], doors.routes[2]].map(({ method, path, sample }) => ({ method, path, sample })), server: [{ method: 'POST', path: '/v1/x', sample: '/v1/x' }] })
  })
})
