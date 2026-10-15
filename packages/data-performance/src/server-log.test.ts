import { describe, expect, test } from 'vitest'
import { addressedProblem, readServerLog, routeOf, tallyRows } from './server-log.js'

/**
 * A log line as Fastify and the audit sink write them, JSON per line. The
 * sink writes through the server's own logger, not the request's, so an
 * audit line carries no request id (as `main.ts` composes it, 2026-10-09).
 */
const line = (fields: Record<string, unknown>): string => JSON.stringify({ level: 30, time: 1, pid: 1, hostname: 'h', ...fields })

const LOG = [
  line({ msg: 'planes', runtime: true, admin: true }),
  line({ reqId: 'req-1', req: { method: 'POST', route: '/v1/form-proposals' }, msg: 'incoming request' }),
  line({ audit: { plane: 'admin', operation: 'proposal', status: 200 }, msg: 'audit' }),
  line({ reqId: 'req-1', res: { statusCode: 200 }, msg: 'request completed' }),
  line({ reqId: 'req-2', req: { method: 'POST', route: '/v1/forms/:id/lookups/:source/query' }, msg: 'incoming request' }),
  line({ reqId: 'req-2', res: { statusCode: 200 }, msg: 'request completed' }),
  line({ audit: { plane: 'runtime', operation: 'lookup-query', form: 'pg-order', status: 200 }, msg: 'audit' }),
  line({ reqId: 'req-3', req: { method: 'GET', route: '/health' }, msg: 'incoming request' }),
  line({ reqId: 'req-3', res: { statusCode: 200 }, msg: 'request completed' }),
  line({ reqId: 'req-4', req: { method: 'POST', route: '/v1/forms/:id/records/create' }, msg: 'incoming request' }),
  line({ audit: { plane: 'runtime', operation: 'create', form: 'pg-order', status: 201 }, msg: 'audit' }),
  line({ reqId: 'req-4', res: { statusCode: 201 }, msg: 'request completed' }),
  line({ reqId: 'req-5', req: { method: 'POST', route: '/v1/forms/:id/lookups/:source/query' }, msg: 'incoming request' }),
  line({ audit: { plane: 'runtime', operation: 'lookup-query', form: 'pg-order', status: 200 }, msg: 'audit' }),
  '',
].join('\n')

describe("the server's log", () => {
  // The reconciliation: every runtime request the harness sent is one
  // event in the server's own trail, by operation, form and status. Counted
  // from the events, never from the request lines, so a request that was
  // logged and not audited is a difference.
  test('counts runtime audit events by operation, form and status, and admin events apart', () => {
    const read = readServerLog(LOG)
    expect(read.runtimeEvents).toEqual([
      { operation: 'create', form: 'pg-order', status: 201, count: 1 },
      { operation: 'lookup-query', form: 'pg-order', status: 200, count: 2 },
    ])
    expect(read.adminEvents).toBe(1)
    expect(read.errorLines).toBe(0)
  })

  // What logging costs per request is lines per request: the lines that
  // carry a runtime request's id, and its audit line, which carries none,
  // over those requests. Startup lines, health checks and the
  // administrator's plane are not runtime requests.
  test('counts the lines that belong to runtime requests', () => {
    expect(readServerLog(LOG).runtimeLines).toEqual({ requests: 3, lines: 8 })
  })

  // A line at error level or above means the server failed at something
  // while it was being measured, and the run refuses.
  test('counts lines at level 50 and above', () => {
    expect(readServerLog(`${LOG}${line({ level: 50, msg: 'a lookup search failed' })}\n${line({ level: 60, msg: 'fatal' })}\n`).errorLines).toBe(2)
  })

  // A line that is not JSON is a write the logger did not make; it is not skipped silently.
  test('refuses a line that is not JSON', () => {
    expect(() => readServerLog('not json\n')).toThrow(/line 1/)
  })
})

describe("the harness's tally", () => {
  // The harness counts what it sent by the route it addressed, so the two
  // tallies meet on the same names the server's audit uses.
  test('names each runtime route by its audit operation and form', () => {
    expect(routeOf('GET', '/v1/forms/pg-order')).toEqual({ plane: 'runtime', operation: 'form', form: 'pg-order' })
    expect(routeOf('POST', '/v1/forms/ms-hop-order/records/update')).toEqual({ plane: 'runtime', operation: 'update', form: 'ms-hop-order' })
    expect(routeOf('POST', '/v1/forms/pg-order/lookups/customer/resolve')).toEqual({ plane: 'runtime', operation: 'lookup-resolve', form: 'pg-order' })
    expect(routeOf('POST', '/v1/form-proposals')).toEqual({ plane: 'admin' })
    expect(routeOf('POST', '/v1/forms/pg-order/versions')).toEqual({ plane: 'admin' })
    expect(routeOf('GET', '/health')).toEqual({ plane: 'none' })
  })

  test('turns counts into rows in a fixed order', () => {
    expect(tallyRows(new Map([['update\tpg-order\t200', 2], ['create\tpg-order\t201', 1]]))).toEqual([
      { operation: 'create', form: 'pg-order', status: 201, count: 1 },
      { operation: 'update', form: 'pg-order', status: 200, count: 2 },
    ])
  })
})

describe('what one counted request addressed', () => {
  // The default lookup deadline is derived from the scenarios the catalogue
  // says address the lookup routes (0061). A catalogue entry naming the
  // wrong operation would derive it from a create, or leave the slowest
  // search out; the counting pass sends each scenario once and holds what it
  // addressed, by the route the audit names, to what the catalogue says.
  test('is exactly one request to the operation the catalogue names, or none for one outside the runtime plane', () => {
    const before = new Map([['lookup-query', 3]])
    expect(addressedProblem('lookup-common', 'lookup-query', before, new Map([['lookup-query', 4]]))).toBeUndefined()
    expect(addressedProblem('health', null, before, new Map(before))).toBeUndefined()
    expect(addressedProblem('resolve-1', 'lookup-resolve', before, new Map([['lookup-query', 4]]))).toBe('resolve-1 addressed lookup-query once; the catalogue says lookup-resolve')
    expect(addressedProblem('health', null, before, new Map([['lookup-query', 3], ['form', 1]]))).toBe('health addressed form once; the catalogue says no runtime operation')
    expect(addressedProblem('create', 'create', new Map(), new Map([['create', 2]]))).toBe('create addressed create twice; the catalogue says create')
    expect(addressedProblem('read', undefined, new Map(), new Map([['read', 1]]))).toBe('read names no operation in the catalogue')
  })
})
