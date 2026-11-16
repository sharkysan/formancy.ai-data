import { authorizeOperation, formMenu, intendedRecord, offeredFor, planSave, planSaveList, recordPage } from '@formancy/data-core'
import type {
  DescribedTable,
  FieldError,
  FormRecord,
  MembershipCheck,
  MenuBundle,
  PlanRefusal,
  PolicyContext,
  RecordFailure,
  SaveBody,
  SaveChange,
  SaveChildInput,
  SaveInput,
  SavePart,
  SavePlan,
  SaveRefusal,
} from '@formancy/data-core'
import { canonicalize } from '@formancy/spec'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { planRefusal, recordFailure } from './runtime-errors.js'
import { requiredOf } from './runtime-menu.js'
import type { ServedForm } from './runtime-menu.js'
import { FORMS_UNREAD, memberships, withoutEchoes } from './runtime-writes.js'
import type { readForWrite } from './runtime-writes.js'
import { at, failedAnswer, planAnswer, savedAnswer } from './save-answers.js'
import type { SaveForms } from './save-answers.js'
import { saveBodyOf } from './save-body.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/*
 * `POST /v1/forms/:id/records/save` (0155): a record -- a create, or an
 * update that may change nothing -- and the rows of its together children,
 * in one transaction, sent once per write id and never again.
 *
 * In this order, each stage answering alone:
 *
 * 1. the body's shape (400), before the write id is read (`save-body.ts`);
 * 2. each child it names is a together child of this form in the person's
 *    menu, through that field (400), every bundle read as the menu reads
 *    them;
 * 3. the policy, for every part, before anything is read: the record's
 *    create or update, each child's create, update or delete in the save
 *    (403, at the part);
 * 4. the reads -- the record, or the record's table described; each
 *    changed child's rows of the record, or its table described -- and the
 *    plan (`planSave`), every part's field errors at once (422), a row the
 *    list does not hold not found (404), a bound broken before any
 *    statement (422), and the field that names the record the server's:
 *    over-posting where a row's answers carry another value (403);
 * 5. each selection's membership check (422, at its part);
 * 6. the one transaction (`RecordAdapter.save`), answered at the step it
 *    stopped at, or with the record and every row as stored.
 *
 * Abandonment stops nothing, as for every write (0031): the browser's own
 * resend would otherwise be answered "not saved". A lost answer is 502,
 * naming the record and the version sent.
 */

export interface SaveRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** Every published form as served, with this person's menu entry, or `null` when the store cannot list them (`servedForms`). */
  served(request: FastifyRequest): Promise<ServedForm[] | null>
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: 'save',
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }>
  /** A write sent whose answer was lost: said in the log, answered 502 with what was addressed, never sent again. */
  lost(request: FastifyRequest<{ Params: { id: string } }>, operation: 'save', record: string | null, version: string | null, failure: string): WriteAnswer
  /** A planner's refusal as the answer, its drift said in the log first, under the operation of its part. */
  refusal(request: FastifyRequest<{ Params: { id: string } }>, operation: 'create' | 'update' | 'delete', plan: PlanRefusal): WriteAnswer
  /** The root as the catalog describes it now, or the answer when it cannot be described. */
  describedRoot(bundle: PublishedBundle, open: OpenConnection): Promise<{ ok: true; described: DescribedTable } | { ok: false; answer: WriteAnswer }>
  /** The record an update decides over, as this person reads it, and the description that read carried. */
  readForWrite(bundle: PublishedBundle, open: OpenConnection, actor: PolicyContext, record: string): ReturnType<typeof readForWrite>
  /** A write's answer, sent, with what the audit names. */
  answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply>
  /** How long each membership check may run before the server stops it (0061). */
  lookupDeadlineMs: number
  /** How long the save may wait for a lock, and after which none of its steps starts (0155). */
  saveDeadlineMs: number
}

/** A child the body names, as the menu reads it. */
interface NamedChild {
  form: string
  field: string
  bundle: MenuBundle
  changes: readonly SaveChange[]
}

type Answered<T> = { ok: true; value: T } | { ok: false; answer: WriteAnswer }

const refused = (answer: WriteAnswer): { ok: false; answer: WriteAnswer } => ({ ok: false, answer })

/**
 * Rule 2: each child the body names is one of this form's children in the
 * person's menu, through that field, whose rows are saved with the record
 * -- the menu's own answer (`formMenu`), so the route and the menu cannot
 * disagree about a child. Anything else is 400, naming the form and the
 * field the body sent, never a value.
 */
function namedChildren(id: string, body: SaveBody, served: readonly ServedForm[]): Answered<NamedChild[]> {
  const entry = formMenu(served.map((form) => form.form)).forms.find((form) => form.id === id)
  const children: NamedChild[] = []
  for (const { form, field, changes } of body.rows) {
    const shown = entry?.children.some((child) => child.form === form && child.field === field && child.together !== undefined) ?? false
    const bundle = served.find((candidate) => candidate.bundle.id === form)?.bundle
    if (!shown || bundle === undefined) {
      return refused({ status: 400, body: { code: 'invalid-request', message: `${form} is not saved with this form's records through ${field}.` } })
    }
    children.push({ form, field, bundle, changes })
  }
  return { ok: true, value: children }
}

/** The operations the body asks of one child, once each, in the order it first asks them. */
function operationsOf(changes: readonly SaveChange[]): Array<'create' | 'update' | 'delete'> {
  return [...new Set(changes.map((change) => ('create' in change ? 'create' : 'update' in change ? 'update' : 'delete')))]
}

/**
 * Rule 3: every `(form, operation)` the body names, before anything is
 * read or decoded (0044): the record's create or update, as a write alone
 * offers it, and each child's create, update or delete, as a save offers
 * it (`offeredFor`), each then granted by its own form's policy. The first
 * refusal answers alone, at its part; a person refused anywhere is told
 * only that, and no field error is worked out for them.
 */
function policyRefusal(parent: PublishedBundle, body: SaveBody, children: readonly NamedChild[], actor: PolicyContext): WriteAnswer | undefined {
  const asked: Array<{ part: SavePart; bundle: Pick<MenuBundle, 'bindings' | 'policy'>; operation: 'create' | 'update' | 'delete'; save: string | null }> = [
    { part: { record: true }, bundle: parent, operation: 'create' in body.record ? 'create' : 'update', save: null },
    ...children.flatMap((child) =>
      operationsOf(child.changes).map((operation) => ({ part: { form: child.form, field: child.field }, bundle: child.bundle, operation, save: child.field })),
    ),
  ]
  for (const { part, bundle, operation, save } of asked) {
    if (!offeredFor(bundle.bindings, operation, save === null ? null : { save })) {
      const message = save === null ? `This form does not offer ${operation}.` : `This form does not offer ${operation} in a save of ${save}.`
      return at(planRefusal('operation-unavailable', message), part)
    }
    const decided = authorizeOperation(bundle.policy, actor, operation)
    if (!decided.ok) return at(planRefusal(decided.code, decided.message), part)
  }
  return undefined
}

/** The record as the save decides over it: a create's answers and its table described, or an update's record as read, its version and the description that read carried. */
async function recordInput(
  steps: SaveRouteSteps,
  parent: PublishedBundle,
  open: OpenConnection,
  actor: PolicyContext,
  body: SaveBody,
  served: readonly ServedForm[],
): Promise<Answered<{ record: SaveInput['record']; unread: RecordFailure | undefined }>> {
  if ('create' in body.record) {
    const root = await steps.describedRoot(parent, open)
    if (!root.ok) return refused(at(root.answer, { record: true }))
    const required = (requiredOf(parent, served) ?? []).map(({ form, field, min, max }) => ({ form: form.id, field, min, max }))
    const answers = withoutEchoes(parent, actor, 'create', body.record.create.answers)
    return { ok: true, value: { record: { create: { answers, described: root.described, required } }, unread: undefined } }
  }
  const { record, version, answers } = body.record.update
  const read = await steps.readForWrite(parent, open, actor, record)
  if (!read.ok) return refused(at(read.answer, { record: true }))
  const { current, unread, described } = read
  // The record as read now is newer than the one the person saved over: the database will answer stale, and an echo the change moved is not theirs (0098).
  const behind = current !== undefined && current.version !== null && current.version !== version
  const echoless = withoutEchoes(parent, actor, 'update', answers, current?.answers, behind)
  return { ok: true, value: { record: { update: { record, version, answers: echoless, asRead: current, described } }, unread } }
}

/** A row's change less what it echoes back unchanged (0022, 0098): a new row's against nothing, a row's update against the row as the record's list read it. */
function echoless(child: NamedChild, actor: PolicyContext, rows: readonly FormRecord[], change: SaveChange): SaveChange {
  if ('create' in change) {
    return { create: { ref: change.create.ref, answers: withoutEchoes(child.bundle, actor, 'create', change.create.answers) as Record<string, unknown> } }
  }
  if (!('update' in change)) return change
  const { record, version, answers } = change.update
  const row = rows.find((candidate) => candidate.record === record)
  const behind = row !== undefined && row.version !== null && row.version !== version
  return { update: { record, version, answers: withoutEchoes(child.bundle, actor, 'update', answers, row?.answers, behind) as Record<string, unknown> } }
}

/**
 * Each child the save changes as the plan needs it: over a saved record,
 * its rows of the record as this person reads them, `max + 1` of them in
 * one statement that also describes its table (`planSaveList`); under a
 * new record, which has none, its table described. A child the body names
 * with no change is read not at all.
 */
async function childInputs(
  steps: SaveRouteSteps,
  request: FastifyRequest<{ Params: { id: string } }>,
  open: OpenConnection,
  actor: PolicyContext,
  body: SaveBody,
  children: readonly NamedChild[],
): Promise<Answered<SaveChildInput[]>> {
  const inputs: SaveChildInput[] = []
  for (const child of children) {
    if (child.changes.length === 0) continue
    const part: SavePart = { form: child.form, field: child.field }
    let read: SaveChildInput['read']
    if ('update' in body.record) {
      const list = planSaveList(child.bundle, body.record.update.record, actor)
      if (!list.ok) return refused(at(steps.refusal(request, 'update', list), part))
      const page = await open.records.list(list.request)
      if (!page.ok) return refused(at(recordFailure(child.bundle.bindings, page), part))
      read = { rows: recordPage(child.bundle.bindings, list, page.rows).rows, described: page.described }
    } else {
      const found = await open.records.describe(child.bundle.bindings.root)
      if (!found.ok) return refused(at(recordFailure(child.bundle.bindings, found), part))
      read = { rows: [], described: found.described }
    }
    const changes = child.changes.map((change) => echoless(child, actor, read.rows, change))
    inputs.push({ form: child.form, field: child.field, bundle: child.bundle, changes, read })
  }
  return { ok: true, value: inputs }
}

/**
 * Rule 5: every lookup selection's membership check, each with a lookup
 * deadline of its own, by the one function a write alone asks
 * (`memberships`), grouped by the part they belong to: a selection that is
 * not an option is a field error at its part, every part's at once; a
 * check that cannot answer refuses the save, nothing sent.
 */
async function membershipAnswer(
  steps: SaveRouteSteps,
  request: FastifyRequest,
  open: OpenConnection,
  checks: ReadonlyArray<{ at: SavePart; check: MembershipCheck }>,
): Promise<WriteAnswer | undefined> {
  const grouped = new Map<string, { part: SavePart; checks: MembershipCheck[] }>()
  for (const { at: part, check } of checks) {
    const key = canonicalize(part)
    const group = grouped.get(key) ?? { part, checks: [] }
    group.checks.push(check)
    grouped.set(key, group)
  }
  const parts: Array<{ at: SavePart; fieldErrors: FieldError[] }> = []
  for (const { part, checks: own } of grouped.values()) {
    const answer = await memberships(open, own, request.log, steps.lookupDeadlineMs)
    if (answer === undefined) continue
    if (answer.status !== 422) return answer
    parts.push({ at: part, fieldErrors: (answer.body as { fieldErrors: FieldError[] }).fieldErrors })
  }
  if (parts.length === 0) return undefined
  return { status: 422, body: { code: 'invalid-values', message: 'A selection is not one of the options.', parts } satisfies SaveRefusal }
}

/** The operation a planner's refusal at `part` is said in the log under, for drift. */
function operationAt(body: SaveBody, part: SavePart | undefined): 'create' | 'update' | 'delete' {
  if (part === undefined || 'record' in part) return 'create' in body.record ? 'create' : 'update'
  const change = body.rows.find((child) => child.form === part.form && child.field === part.field)?.changes[0]
  return change === undefined || 'update' in change ? 'update' : 'create' in change ? 'create' : 'delete'
}

/** The planned save sent once, and its outcome as the answer: what was addressed on a lost answer, never a second sending. */
async function sent(
  steps: SaveRouteSteps,
  request: FastifyRequest<{ Params: { id: string } }>,
  open: OpenConnection,
  forms: SaveForms,
  body: SaveBody,
  plan: SavePlan,
): Promise<WriteAnswer> {
  const outcome = await open.records.save(plan.request)
  if (!outcome.ok && 'failure' in outcome && outcome.failure.code === 'unknown-outcome') {
    const own = plan.request.record
    const record = 'update' in body.record ? body.record.update.record : own.kind === 'insert' ? intendedRecord(own.request) : null
    return steps.lost(request, 'save', record, 'update' in body.record ? body.record.update.version : null, outcome.failure.message)
  }
  if (!outcome.ok) return failedAnswer(forms, plan, outcome)
  const answer = savedAnswer(forms, plan, body, outcome)
  return { status: 200, body: answer, record: answer.record.record ?? undefined }
}

/**
 * One save, from its children and its policy to the transaction, answered
 * rather than sent: the route runs it once per sending, so a write id that
 * arrives again is answered with this answer and asks the database
 * nothing (0031).
 */
async function saved(
  steps: SaveRouteSteps,
  request: FastifyRequest<{ Params: { id: string } }>,
  parent: PublishedBundle,
  open: OpenConnection,
  body: SaveBody,
): Promise<WriteAnswer> {
  const actor = steps.context(request)
  const served = await steps.served(request)
  if (served === null) return FORMS_UNREAD
  const named = namedChildren(request.params.id, body, served)
  if (!named.ok) return named.answer
  const denied = policyRefusal(parent, body, named.value, actor)
  if (denied !== undefined) return denied

  const record = await recordInput(steps, parent, open, actor, body, served)
  if (!record.ok) return record.answer
  const children = await childInputs(steps, request, open, actor, body, named.value)
  if (!children.ok) return children.answer
  const plan = planSave({ parent, record: record.value.record, children: children.value, deadlineMs: steps.saveDeadlineMs }, actor)
  if (!plan.ok) {
    const { unread } = record.value
    return planAnswer(plan, (refusal) => {
      const part = 'at' in refusal ? refusal.at : undefined
      if (refusal.code === 'record-not-read' && unread !== undefined) return at(recordFailure(parent.bindings, unread), part)
      return at(steps.refusal(request, operationAt(body, part), refusal as PlanRefusal), part)
    })
  }
  if (request.auditTrail !== undefined) request.auditTrail.moved = plan.moved
  const rejected = await membershipAnswer(steps, request, open, plan.memberships)
  if (rejected !== undefined) return rejected
  const forms: SaveForms = { parent: parent.bindings, children: new Map(named.value.map((child) => [child.form, child.bundle.bindings])) }
  return sent(steps, request, open, forms, body, plan)
}

/**
 * Registers the route. The body is checked first, and the audit trail
 * counts its row changes -- a number, never which rows -- and names an
 * update's record; then the write id, the published form and its
 * connection, and the save itself, once per sending of its write id.
 */
export function registerSaveRoute(app: FastifyInstance, steps: SaveRouteSteps): void {
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/save', async (request, reply) => {
    const shaped = saveBodyOf(request.body)
    if (request.auditTrail !== undefined) request.auditTrail.rows = shaped.ok ? shaped.changes : 0
    if (!shaped.ok) return reply.code(400).send({ code: shaped.code, message: shaped.message })
    const { body } = shaped
    if ('update' in body.record && request.auditTrail !== undefined) request.auditTrail.record = body.record.update.record
    const id = writeId(request)
    if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
    const parent = await steps.published(request.params.id, reply)
    if (parent === undefined) return reply
    const open = await steps.connection(parent, reply)
    if (open === undefined) return reply
    return steps.answered(reply, await steps.sendOnce(request, 'save', id, () => saved(steps, request, parent, open, body)))
  })
}
