import type { RequestTally } from './results.js'

/*
 * The server's log as the measurement reads it after the run (0034): the
 * runtime audit events, which must equal what the harness sent, by
 * operation, form and status; the administrator's events; lines at error
 * level; and how many lines a runtime request costs. Pure, on the text.
 */

/** A tally key: operation, form and status, tab-separated. */
export const tallyKey = (operation: string, form: string, status: number): string => `${operation}\t${form}\t${String(status)}`

/** A tally as rows, sorted by operation, form and status, so two tallies compare as lists. */
export function tallyRows(tally: ReadonlyMap<string, number>): RequestTally[] {
  return [...tally.entries()]
    .map(([key, count]) => {
      const [operation, form, status] = key.split('\t')
      return { operation: operation ?? '', form: form ?? '', status: Number(status), count }
    })
    .sort((a, b) => (a.operation !== b.operation ? (a.operation < b.operation ? -1 : 1) : a.form !== b.form ? (a.form < b.form ? -1 : 1) : a.status - b.status))
}

const RUNTIME = /^\/v1\/forms\/([^/]+)(?:\/(records\/read|records\/create|records\/update|lookups\/[^/]+\/query|lookups\/[^/]+\/resolve))?$/
const OPERATION: Record<string, string> = { 'records/read': 'read', 'records/create': 'create', 'records/update': 'update' }

/** Which plane a request the harness sent belongs to, and for the runtime plane its audit operation and form. */
export function routeOf(method: string, path: string): { plane: 'runtime'; operation: string; form: string } | { plane: 'admin' } | { plane: 'none' } {
  if (path === '/v1/form-proposals' || /^\/v1\/forms\/[^/]+\/versions(\/.*)?$/.test(path)) return { plane: 'admin' }
  const match = RUNTIME.exec(path)
  if (match === null) return { plane: 'none' }
  const form = decodeURIComponent(match[1] as string)
  const rest = match[2]
  if (rest === undefined) return method === 'GET' ? { plane: 'runtime', operation: 'form', form } : { plane: 'none' }
  const operation = OPERATION[rest] ?? (rest.endsWith('/query') ? 'lookup-query' : 'lookup-resolve')
  return { plane: 'runtime', operation, form }
}

/** Runtime routes as Fastify names them in a request line. */
const RUNTIME_ROUTES = new Set(['/v1/forms/:id', '/v1/forms/:id/records/read', '/v1/forms/:id/records/create', '/v1/forms/:id/records/update', '/v1/forms/:id/lookups/:source/query', '/v1/forms/:id/lookups/:source/resolve'])

export interface ServerLog {
  runtimeEvents: RequestTally[]
  adminEvents: number
  errorLines: number
  /** Runtime requests found by their request line; every line carrying one of their ids, and every runtime audit line. */
  runtimeLines: { requests: number; lines: number }
}

export function readServerLog(text: string): ServerLog {
  const events = new Map<string, number>()
  const linesByRequest = new Map<string, number>()
  const runtimeRequests = new Set<string>()
  let adminEvents = 0
  // The audit sink writes through the server's own logger, so an event's line
  // carries no request id: it is a runtime request's line by its plane.
  let runtimeAuditLines = 0
  let errorLines = 0
  text.split('\n').forEach((raw, index) => {
    if (raw.trim() === '') return
    let entry: { level?: number; reqId?: string; req?: { route?: string | null }; audit?: { plane?: string; operation?: string; form?: string | null; status?: number } }
    try {
      entry = JSON.parse(raw) as typeof entry
    } catch {
      throw new Error(`the server's log line ${String(index + 1)} is not JSON`)
    }
    if ((entry.level ?? 0) >= 50) errorLines += 1
    if (entry.reqId !== undefined) linesByRequest.set(entry.reqId, (linesByRequest.get(entry.reqId) ?? 0) + 1)
    if (entry.reqId !== undefined && typeof entry.req?.route === 'string' && RUNTIME_ROUTES.has(entry.req.route)) runtimeRequests.add(entry.reqId)
    const audit = entry.audit
    if (audit?.plane === 'admin') adminEvents += 1
    if (audit?.plane === 'runtime') {
      if (entry.reqId === undefined) runtimeAuditLines += 1
      const key = tallyKey(audit.operation ?? '', audit.form ?? '', audit.status ?? 0)
      events.set(key, (events.get(key) ?? 0) + 1)
    }
  })
  const lines = [...runtimeRequests].reduce((sum, id) => sum + (linesByRequest.get(id) ?? 0), runtimeAuditLines)
  return { runtimeEvents: tallyRows(events), adminEvents, errorLines, runtimeLines: { requests: runtimeRequests.size, lines } }
}
