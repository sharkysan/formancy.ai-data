import { EXPORT_MAX_BYTES, exportColumns, exportFileName, exportHeader, exportRecord, LIST_PAGE_SIZE, planList, recordPage, validateExportQuery } from '@formancy/data-core'
import type { ExportColumns, ExportLabels, FormRecord, ListRequest, RuntimeRefusal } from '@formancy/data-core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { EXPORT_DEADLINE_MS } from '../export-limits.js'
import { lookupDeadline } from '../lookup-deadline.js'
import { abandonment } from './abandoned.js'
import type { Abandonment } from './abandoned.js'
import { planRefusal } from './runtime-errors.js'
import type { ListRouteSteps } from './runtime-lists.js'
import { lookupScope } from './runtime-lookups.js'
import type { LookupScope } from './runtime-lookups.js'
import type { WriteAnswer } from './write-once.js'

/** What the export route borrows from the runtime plane: the list's steps, and how long a lookup statement may run (0061). */
export interface ExportRouteSteps extends ListRouteSteps {
  lookupDeadlineMs: number
}

type ExportRequest = FastifyRequest<{ Params: { id: string } }>

/** A refusal this route makes itself: a stable code and a sentence a person can be shown, naming no value (0011). */
const refused = (status: number, code: string, message: string): WriteAnswer => ({ status, body: { code, message } satisfies RuntimeRefusal })

const TOO_LARGE = refused(422, 'export-too-large', `The file would be larger than ${String(EXPORT_MAX_BYTES / (1024 * 1024))} MB. Search for fewer records and try again.`)
const TIMED_OUT = refused(503, 'export-timeout', `The file could not be made within ${String(EXPORT_DEADLINE_MS / 1000)} seconds. Search for fewer records and try again.`)
const BUSY = refused(503, 'export-busy', "Another file is being made from this form's database. Try again in a moment.")
const MOVED = refused(409, 'moved', 'The records changed while the file was made. Try again.')
const ABANDONED = refused(499, 'abandoned', 'The client closed the connection before the file was made; no further statement was sent.')
const UNLABELLED = refused(503, 'unavailable', 'The labels of the records could not be loaded, so no file was made.')

/** One export under way: what every page is asked and decided with. */
interface Making {
  request: ExportRequest
  bundle: PublishedBundle
  open: OpenConnection
  /** The first page's request; every page is it at the next offset. */
  first: ListRequest
  fields: string[]
  columns: ExportColumns
  /** Each readable lookup field's configuration and the person's read filter for it. */
  lookups: ReadonlyMap<string, Extract<LookupScope, { ok: true }>>
  abandoned: Abandonment
  /** When the export's deadline passes, by `Date.now()`. */
  deadline: number
}

type Step<T> = ({ ok: true } & T) | { ok: false; answer: WriteAnswer }

const stop = (answer: WriteAnswer): { ok: false; answer: WriteAnswer } => ({ ok: false, answer })

/** Whether the export must stop before its next statement: its client left, or its deadline passed. Said in the log, with how far it got. */
function stopped(making: Making): { ok: false; answer: WriteAnswer } | undefined {
  const { request } = making
  if (making.abandoned.signal.aborted) {
    request.log.info({ form: request.params.id, rows: request.auditTrail?.rows ?? 0 }, 'an export was abandoned by its client; no further statement was sent')
    return stop(ABANDONED)
  }
  if (Date.now() < making.deadline) return undefined
  request.log.warn({ form: request.params.id, rows: request.auditTrail?.rows ?? 0, deadlineMs: EXPORT_DEADLINE_MS }, 'an export passed its deadline; no further statement was sent')
  return stop(TIMED_OUT)
}

/** A record's token for the lookup `field`: none where it references nothing, or its key fits no token. */
function tokenOf(record: FormRecord, field: string): string[] {
  const token = record.answers[field]
  return typeof token === 'string' ? [token] : []
}

/**
 * The labels of one page's lookups: one resolve per lookup field, of the
 * page's tokens -- at most `LIST_PAGE_SIZE`, which 0044 holds to
 * `MAX_RESOLVE` -- under the person's read filter for that lookup, as the
 * host's grid resolves them. Each resolve has the lookup deadline, cut to
 * what is left of the export's, and stops when the client leaves (0061). A
 * resolve that fails refuses the file: written with empty labels it would
 * look whole.
 */
async function labelsOf(steps: ExportRouteSteps, making: Making, rows: readonly FormRecord[]): Promise<Step<{ labels: ExportLabels }>> {
  const labels = new Map<string, Map<string, string>>()
  for (const [field, scope] of making.lookups) {
    const resolved = new Map<string, string>()
    labels.set(field, resolved)
    const tokens = [...new Set(rows.flatMap((row) => tokenOf(row, field)))]
    if (tokens.length === 0) continue
    const halted = stopped(making)
    if (halted !== undefined) return halted
    const deadline = lookupDeadline(Math.min(steps.lookupDeadlineMs, making.deadline - Date.now()), making.abandoned.signal)
    const { signal } = deadline
    try {
      for (const row of await making.open.lookups.resolve(scope.config, tokens, scope.filters, signal)) resolved.set(row.token, row.label)
    } catch (error) {
      // The adapter stops a statement at its signal and rejects with the
      // reason itself (0061): the client left, the export's deadline
      // passed, or the lookup's did. Anything else is the database's.
      const ours = signal.aborted && error === signal.reason
      const halted = ours ? stopped(making) : undefined
      if (halted !== undefined) return halted
      if (ours) making.request.log.warn({ field, deadlineMs: steps.lookupDeadlineMs }, "an export's labels passed the lookup deadline; the database was told to stop it")
      else making.request.log.warn({ field, error: (error as Error).message }, "an export's labels could not be resolved")
      return stop(UNLABELLED)
    } finally {
      deadline.clear()
    }
  }
  return { ok: true, labels }
}

/**
 * The whole file, page after page: each page the list's own request at the
 * next offset, one guarded statement (0015), decided over the description
 * it carried as a list page is (0041, 0044), then its labels, then each
 * record written and counted. Refused at the first thing that stops it,
 * with nothing of what was written: a byte past `EXPORT_MAX_BYTES`, a key
 * already written -- the rows moved between two statements -- or text a
 * CSV file cannot carry.
 *
 * A record is known again by its key's values as the page read them, not
 * by its token: a key that needs more characters as a token than a token
 * holds is listed with none (`recordPage`) and written all the same, and a
 * check on tokens would pass it twice. Every listed row has its key, since
 * `listable` refuses a key that can be NULL; the page's rows and the
 * statement's line up by index, the one row past the page left off.
 */
async function made(steps: ExportRouteSteps, making: Making, header: string): Promise<Step<{ text: string }>> {
  const { request, bundle, open, columns } = making
  const parts = [header]
  let bytes = Buffer.byteLength(header, 'utf8')
  const key = making.first.target.identity.map((column) => column.name)
  const written = new Set<string>()
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const halted = stopped(making)
    if (halted !== undefined) return halted
    const outcome = await open.records.list({ ...making.first, offset })
    if (!outcome.ok) return stop(await steps.unread(request, bundle, open, outcome, 'list'))
    const drifted = steps.undecided(request, bundle, outcome.described, 'list')
    if (drifted !== undefined) return stop(drifted)
    const page = recordPage(bundle.bindings, making.fields, outcome.rows, LIST_PAGE_SIZE)
    const labelled = await labelsOf(steps, making, page.rows)
    if (!labelled.ok) return labelled
    for (const [index, record] of page.rows.entries()) {
      const values = (outcome.rows[index] as (typeof outcome.rows)[number]).values
      const known = JSON.stringify(key.map((name) => values[name] ?? null))
      if (written.has(known)) return stop(MOVED)
      written.add(known)
      const line = exportRecord(columns, record, labelled.labels)
      if (!line.ok) return stop(refused(409, line.code, line.message))
      bytes += Buffer.byteLength(line.text, 'utf8')
      if (bytes > EXPORT_MAX_BYTES) return stop(TOO_LARGE)
      parts.push(line.text)
      if (request.auditTrail !== undefined) request.auditTrail.rows = (request.auditTrail.rows ?? 0) + 1
    }
    if (!page.hasMore) return { ok: true, text: parts.join('') }
  }
}

/**
 * `POST /v1/forms/:id/records/export` (0079): one CSV file of every record
 * a list would page through for the same search, sort, parent and filter
 * (0104), under the read right a list has and no other -- `listable`
 * decides.
 *
 * Everything the policy decides is decided first, before any statement and
 * before the gate: the body, the plan -- the person's filter among it,
 * planned once and carried by every page's request -- the file's columns
 * and every lookup's read filter, whose refusal refuses the file where the
 * grid would show tokens. Then one export at a time per connection in this
 * server (`export-busy`), so an export holds at most one of the pool's
 * connections, and that only while a page runs.
 *
 * Buffered, never streamed: the file is answered 200 only once it is
 * whole, with its length, and anything that stops it is a JSON refusal
 * with its own code -- so no truncated file is ever sent. Not a snapshot:
 * each page is its own statement, and a row deleted meanwhile before the
 * offset is skipped, unseen; a record that would appear twice refuses the
 * file. A page refused for drift is said in the log as a list, the
 * decision it is; the audit names the request `export`, with the records
 * written and nothing the person sent (0023).
 */
export function registerExportRoute(app: FastifyInstance, steps: ExportRouteSteps): void {
  /** The connections an export is being made from, in this server. */
  const busy = new Set<string>()

  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/export', async (request, reply) => {
    const deadline = Date.now() + EXPORT_DEADLINE_MS
    const query = validateExportQuery(request.body === undefined ? {} : request.body)
    if (!query.ok) return reply.code(400).send({ code: query.code, message: query.message })
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const context = steps.context(request)
    const plan = planList(bundle.snapshot, bundle.bindings, bundle.policy, context, { ...query.query, offset: 0, limit: LIST_PAGE_SIZE })
    if (!plan.ok) return steps.answered(reply, planRefusal(plan.code, plan.message))
    const columns = exportColumns(bundle.form, bundle.bindings, plan.fields)
    const header = exportHeader(columns)
    if (!header.ok) return steps.answered(reply, refused(409, header.code, header.message))
    const lookups = new Map<string, Extract<LookupScope, { ok: true }>>()
    for (const { binding } of columns.fields) {
      if (binding.kind !== 'lookup') continue
      const scope = lookupScope(bundle, context, 'read', binding.field)
      if (!scope.ok) return steps.answered(reply, scope.refusal)
      lookups.set(binding.field, scope)
    }
    if (busy.has(bundle.connection)) return steps.answered(reply, BUSY)
    const abandoned = abandonment(request, reply)
    // Taken last, with nothing between it and the try that gives it back.
    busy.add(bundle.connection)
    try {
      const open = await steps.connection(bundle, reply)
      if (open === undefined) return reply
      const file = await made(steps, { request, bundle, open, first: plan.request, fields: plan.fields, columns, lookups, abandoned, deadline }, header.text)
      if (!file.ok) return steps.answered(reply, file.answer)
      return reply
        .code(200)
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${exportFileName(request.params.id)}"`)
        .send(Buffer.from(file.text, 'utf8'))
    } finally {
      abandoned.settle()
      busy.delete(bundle.connection)
    }
  })
}
