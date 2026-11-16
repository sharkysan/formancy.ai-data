import { generateForm, planSave, planSaveList, recordPage, recordToken, rowsRequired } from '@formancy/data-core'
import type {
  DatabaseKind,
  FieldBinding,
  FormBindings,
  FormPolicy,
  MetadataSnapshot,
  PolicyContext,
  RecordAdapter,
  SaveBody,
  SaveBundle,
  SaveChildInput,
  SaveOutcome,
  SavePlan,
  SaveRequest,
  SaveStep,
} from '@formancy/data-core'

/*
 * A save of a record with the rows of its together children (0155), written
 * once for both adapters' `save.integration.test.ts`, their
 * `save-lost-answer.integration.test.ts` and their sized suites.
 *
 * Each suite starts its own fixture, discovers the parity schema as the
 * owner, generates the forms below over it, inserts what a case starts from
 * as the owner, plans each save as the server's route will (`plannedSave`:
 * the record's table described, the rows of a saved record listed with
 * `planSaveList`, `planSave`), sends it through its adapter, and reads what
 * is stored as the owner. The answer each case expects is below, rendered
 * by `saveAnswer`. Where the engines differ, the difference is named per
 * engine and written down in each adapter.
 *
 * The generator does not write `together` yet (0155's later parts), so the
 * bundles carry it by the hand edit the generator will make (`savedWith`):
 * the field written on create only, with its bounds.
 */

/** A save's answer as SAVE_PARITY writes it: `saved`, or the step it stopped at and why. */
export type SaveAnswer = string

/** One answer for both engines, or one per engine where they differ. */
export type SaveExpectation = SaveAnswer | Readonly<Record<DatabaseKind, SaveAnswer>>

/**
 * The shared expectations, by case. `saveCase(name)` is each one's id.
 *
 * - `new-numbered`: an order the database numbers, with three lines, all
 *   stored, the lines' foreign key the order's new key.
 * - `new-typed`: an account whose code the person types, with two entries.
 * - `existing`: a saved order's note changed, one line updated, one
 *   deleted and one created.
 * - `touched`: a saved order whose own fields the save leaves alone, a line
 *   created: the order's version moves all the same.
 * - `record-refused`: the order noted 'refused', which its own check
 *   refuses; nothing of the lines is stored.
 * - `within-refused`: a line created under an order of another tenant, which
 *   the order's own policy admits and the line lookup's filter does not.
 * - `first-row-refused`, `middle-row-refused`, `last-row-refused`: the
 *   first, second or third of three new lines refused by its check; the
 *   order's touch and the lines before it are rolled back.
 * - `stale-record`: the order changed after it was read.
 * - `stale-row`: a line changed after it was read.
 * - `other-record-row`: a line of another order, updated at its own true
 *   version through this order's save: not found, and untouched.
 * - `other-record-delete`: the same, deleted.
 * - `unique-violation`: a new line under a line number the order holds.
 * - `delete-then-create`: line 2 deleted and a new line 2 created, in one
 *   save.
 * - `at-max`, `past-max`: a third line where three are the most, and a
 *   fourth -- the count, once every step ran, held 4.
 * - `at-min`, `past-min`: an entry deleted where one is the least, leaving
 *   one, and the last deleted -- the count held 0.
 * - `child-moved`: the lines' table altered after it was described; nothing
 *   stored.
 * - `read-back`: the order as the lines' trigger left it -- its total, and
 *   the version the trigger moved it to after the order's own step.
 * - `lock-timeout`: another transaction holds the order's row past the
 *   deadline: the lock is not waited for longer.
 * - `past-deadline`: three slow marks, each under the deadline, together
 *   past it: stopped before the next statement, nothing stored.
 * - `slow-statement`: one mark whose trigger takes 2 s, under a deadline
 *   of 0.5 s. The engines differ, and each says what bounds a statement:
 *   PostgreSQL's statement timeout cancels it at its step, where SQL
 *   Server runs it to its end -- nothing bounds a statement there but
 *   mssql's request timeout -- and stops the save before its next step.
 *   Nothing stored on either.
 * - `row-declined`: the second of two marks refused by its trigger in words
 *   worded for the person (0156), declined at its step with
 *   SAVE_DECLINED_REASON; nothing stored.
 * - `race`: two saves each adding the last allowed mark, both waiting on a
 *   third transaction that holds the order's row: one saved, one stale, and
 *   the order holds `max` marks.
 * - `resend`: a save stored, sent again with the version it was read at.
 * - `lost-answer`: the connection cut once the save was sent.
 */
export const SAVE_PARITY = {
  'new-numbered': 'saved',
  'new-typed': 'saved',
  existing: 'saved',
  touched: 'saved',
  'record-refused': 'record: check-violation',
  'within-refused': 'child 0 within: rejected',
  'first-row-refused': 'child 0 create 0: check-violation',
  'middle-row-refused': 'child 0 create 1: check-violation',
  'last-row-refused': 'child 0 create 2: check-violation',
  'stale-record': 'record: stale',
  'stale-row': 'child 0 update 0: stale',
  'other-record-row': 'child 0 update 0: not-found',
  'other-record-delete': 'child 0 delete 0: not-found',
  'unique-violation': 'child 0 create 0: unique-violation',
  'delete-then-create': 'saved',
  'at-max': 'saved',
  'past-max': 'child 0 count: held 4',
  'at-min': 'saved',
  'past-min': 'child 0 count: held 0',
  'child-moved': 'child 0 create 0: schema-changed',
  'read-back': 'saved',
  'lock-timeout': 'record: unavailable',
  'past-deadline': 'save: unavailable',
  'slow-statement': { postgres: 'child 0 create 0: unavailable', sqlserver: 'save: unavailable' },
  'row-declined': 'child 0 create 1: declined',
  race: 'record: stale, saved',
  resend: 'record: stale',
  'lost-answer': 'save: unknown-outcome',
} as const satisfies Readonly<Record<string, SaveExpectation>>

export type SaveCase = keyof typeof SAVE_PARITY

/** What `name` answers on `engine`. */
export function saveExpected(name: SaveCase, engine: DatabaseKind): SaveAnswer {
  const expected: SaveExpectation = SAVE_PARITY[name]
  return typeof expected === 'string' ? expected : expected[engine]
}

/** A step of a save in words: `record`, `save`, or a child's `within`, row step or count. */
export function stepName(at: SaveStep): string {
  if (typeof at === 'string') return at
  if ('within' in at) return `child ${String(at.child)} within`
  if ('count' in at) return `child ${String(at.child)} count`
  if ('delete' in at) return `child ${String(at.child)} delete ${String(at.delete)}`
  if ('update' in at) return `child ${String(at.child)} update ${String(at.update)}`
  return `child ${String(at.child)} create ${String(at.create)}`
}

/** A save's answer as SAVE_PARITY writes it. */
export function saveAnswer(outcome: SaveOutcome): SaveAnswer {
  if (outcome.ok) return 'saved'
  if ('rejected' in outcome) return `${stepName(outcome.at)}: rejected`
  if ('held' in outcome) return `${stepName(outcome.at)}: held ${String(outcome.held)}`
  return `${stepName(outcome.at)}: ${outcome.failure.code}`
}

const CLERKS = ['clerk']
const READ = { read: CLERKS, write: [] }
const WRITE = { read: CLERKS, write: CLERKS }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]

/**
 * Clerks create and change orders of any tenant, and read every column: a
 * policy that narrows the order by nothing, so that a line's lookup filter
 * is what refuses a line under another tenant's order (`within-refused`).
 */
export const SAVED_ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: CLERKS, create: CLERKS, update: CLERKS },
  fields: { id: READ, tenant_id: WRITE, note: WRITE, total: READ },
  rowFilters: [],
  lookups: {},
}

/**
 * Clerks create, change and delete rows, each row's id read-only: of their
 * tenant's records, by the record lookup's filter and a through by it,
 * where `tenant` says so; otherwise of every record, since a through
 * compares no text key (0043), and a filtered lookup with no through would
 * let a delete reach another tenant's row by its token.
 */
function rowPolicy(field: string, fields: readonly string[], tenant: boolean): FormPolicy {
  return {
    version: 1,
    operations: { read: CLERKS, create: CLERKS, update: CLERKS, delete: CLERKS },
    fields: Object.fromEntries<{ read: string[]; write: string[] }>([
      ['id', READ],
      [field, WRITE],
      ...fields.map((name): [string, typeof WRITE] => [name, WRITE]),
    ]),
    rowFilters: [],
    lookups: { [field]: tenant ? TENANT : [] },
    ...(tenant ? { through: [field] } : {}),
  }
}

/** An order's lines: their number, quantity and note. */
export const SAVED_LINE_POLICY: FormPolicy = rowPolicy('saved_order', ['line_no', 'quantity', 'note'], true)
/** An order's marks: their number and note. */
export const SAVED_MARK_POLICY: FormPolicy = rowPolicy('saved_order', ['mark_no', 'note'], true)

/** Clerks create and change accounts of their tenant, the tenant pinned. */
export const SAVED_ACCOUNT_POLICY: FormPolicy = {
  version: 1,
  operations: { read: CLERKS, create: CLERKS, update: CLERKS },
  fields: { code: WRITE, tenant_id: READ, note: WRITE },
  rowFilters: TENANT,
  lookups: {},
}

/** An account's entries: their number and amount. */
export const SAVED_ENTRY_POLICY: FormPolicy = rowPolicy('saved_account', ['entry_no', 'amount'], false)

/** Clara, a clerk of tenant 1. */
export const SAVE_CLERK: PolicyContext = { actor: { id: 'clara', roles: CLERKS }, attributes: { tenant: '1' } }

/** The bounds each child is saved with: lines and marks 0 to 3, entries 1 to 3. */
export const SAVED_BOUNDS = { lines: { min: 0, max: 3 }, marks: { min: 0, max: 3 }, entries: { min: 1, max: 3 } } as const

/** The application lock a race's saves wait for, shared, while a suite holds it exclusively: PostgreSQL's advisory key, SQL Server's resource. */
export const SAVE_RACE_LOCK = { postgres: 155, sqlserver: 'parity.saved_mark' } as const

/** What the marks' trigger says to the person of a mark noted 'declined', after the prefix both parity SQL files raise it with (0156). */
export const SAVE_DECLINED_REASON = 'This mark is not taken.'

/**
 * `bindings` with `field` saved with its record, between `bounds`: the hand
 * edit the generator will make once it writes `together` -- the bounds on
 * the lookup, and the field written on create only (0155).
 */
export function savedWith(bindings: FormBindings, field: string, bounds: { min: number; max: number }): FormBindings {
  const copy = structuredClone(bindings)
  const binding = copy.fields.find((candidate) => candidate.field === field) as Extract<FieldBinding, { kind: 'lookup' }> | undefined
  if (binding === undefined || binding.kind !== 'lookup') throw new Error(`${field} is not a lookup of ${copy.root.name}`)
  binding.together = { ...bounds }
  binding.writes = { create: true, update: false }
  return copy
}

/** The parity forms a save is planned over, each with its policy, its rows' forms saved with their record. */
export interface SavedForms {
  orders: SaveBundle & { id: string }
  lines: SaveBundle & { id: string }
  marks: SaveBundle & { id: string }
  accounts: SaveBundle & { id: string }
  entries: SaveBundle & { id: string }
}

function form(snapshot: MetadataSnapshot, name: string, lookups: Array<{ foreignKey: string; display: string[] }>): FormBindings {
  return generateForm(snapshot, {
    connection: 'parity',
    root: { schema: 'parity', name },
    formId: name.replaceAll('_', '-'),
    title: name,
    lookups,
    versionColumn: 'version',
  }).bindings
}

/** The forms over the parity schema as `snapshot` discovered it, with `bounds` on each child. */
export function savedForms(snapshot: MetadataSnapshot, bounds: typeof SAVED_BOUNDS = SAVED_BOUNDS): SavedForms {
  const bundle = (id: string, bindings: FormBindings, policy: FormPolicy) => ({ id, connection: 'parity', snapshot, bindings, policy })
  const ordered = (name: string, key: string) => form(snapshot, name, [{ foreignKey: key, display: ['note'] }])
  return {
    orders: bundle('saved-order', form(snapshot, 'saved_order', []), SAVED_ORDER_POLICY),
    lines: bundle('saved-line', savedWith(ordered('saved_line', 'fk_saved_line_order'), 'saved_order', bounds.lines), SAVED_LINE_POLICY),
    marks: bundle('saved-mark', savedWith(ordered('saved_mark', 'fk_saved_mark_order'), 'saved_order', bounds.marks), SAVED_MARK_POLICY),
    accounts: bundle('saved-account', form(snapshot, 'saved_account', []), SAVED_ACCOUNT_POLICY),
    entries: bundle(
      'saved-entry',
      savedWith(form(snapshot, 'saved_entry', [{ foreignKey: 'fk_saved_entry_account', display: ['note'] }]), 'saved_account', bounds.entries),
      SAVED_ENTRY_POLICY,
    ),
  }
}

/** The token of a parity row by its key's values, as the API carries it. */
export function savedToken(identity: readonly string[], values: Record<string, string | number>): string {
  const encoded = recordToken(identity, Object.fromEntries(Object.entries(values).map(([name, value]) => [name, String(value)])))
  if (!encoded.ok) throw new Error(`no token for ${JSON.stringify(values)}: ${encoded.message}`)
  return encoded.token
}

/**
 * A save planned as the server's route will plan one (0155): the record's
 * table described; over a saved record, each changed child's rows listed by
 * `planSaveList` through `records`, as this person reads them, and its
 * table as that list described it; under a new one, each child's table
 * described, and the children that require rows of it found by
 * `rowsRequired`; then `planSave`. Throws on any refusal before the
 * transaction, which is the planner's suites' to hold, so a case reaches
 * the adapter with exactly the request the route would send.
 */
export async function plannedSave(
  records: RecordAdapter,
  parent: SavedForms[keyof SavedForms],
  children: ReadonlyArray<SavedForms[keyof SavedForms]>,
  body: SaveBody,
  deadlineMs: number,
  context: PolicyContext = SAVE_CLERK,
): Promise<SavePlan> {
  const described = await records.describe(parent.bindings.root)
  if (!described.ok) throw new Error(`the record's table was not described: ${described.code}`)
  const inputs: SaveChildInput[] = []
  for (const rows of body.rows) {
    const bundle = children.find((child) => child.id === rows.form)
    if (bundle === undefined) throw new Error(`no child form ${rows.form}`)
    if ('update' in body.record) {
      const list = planSaveList(bundle, body.record.update.record, context)
      if (!list.ok) throw new Error(`the rows were not planned: ${list.code}: ${list.message}`)
      const page = await records.list(list.request)
      if (!page.ok) throw new Error(`the rows were not listed: ${page.code}: ${page.message}`)
      inputs.push({
        form: rows.form,
        field: rows.field,
        bundle,
        changes: rows.changes,
        read: { rows: recordPage(bundle.bindings, list, page.rows).rows, described: page.described },
      })
    } else {
      const child = await records.describe(bundle.bindings.root)
      if (!child.ok) throw new Error(`the rows' table was not described: ${child.code}`)
      inputs.push({ form: rows.form, field: rows.field, bundle, changes: rows.changes, read: { rows: [], described: child.described } })
    }
  }
  const record =
    'update' in body.record
      ? { update: { ...body.record.update, asRead: undefined, described: described.described } }
      : {
          create: {
            answers: body.record.create.answers,
            described: described.described,
            required: rowsRequired(parent, children).map(({ form: child, field, min, max }) => ({ form: child.id, field, min, max })),
          },
        }
  const plan = planSave({ parent, record, children: inputs, deadlineMs }, context)
  if (!plan.ok) throw new Error(`the save was not planned: ${plan.code}: ${plan.message}`)
  return plan
}

/**
 * How many line changes a sized suite saves at once (0155): the sizes the
 * design measures, the largest past what one together child may hold
 * (`TOGETHER_MAX_ROWS`), so the measurement says where a save stops
 * fitting rather than stopping where the bound does.
 */
export const SAVE_SIZES = [1, 10, 50, 100, 200, 500] as const

/** Clerks of tenant 1 change their orders, the notes alone: what a save of lines needs of its order. */
export const SIZED_ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: CLERKS, create: [], update: CLERKS },
  fields: { id: READ, order_date: READ, amount: READ, notes: WRITE },
  rowFilters: TENANT,
  lookups: { customer: TENANT, employee: TENANT },
}

/** Clerks create and change the lines of their tenant's orders, through the order. */
export const SIZED_LINE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: CLERKS, create: CLERKS, update: CLERKS },
  fields: { order: WRITE, line_no: WRITE, quantity: WRITE, unit_price: WRITE, line_total: READ },
  rowFilters: [],
  lookups: { order: TENANT },
  through: ['order'],
}

/**
 * The order and its lines in `sales` as the sized suites save them, over
 * what `snapshot` discovered of the fixture: the lines saved with their
 * order up to `TOGETHER_MAX_ROWS`; on PostgreSQL both versioned by their
 * `row_version` column, on SQL Server by their rowversion, the order's
 * touch column its `notes`, confirmed by the hand edit the studio will
 * make (0155).
 */
export function sizedSaveForms(snapshot: MetadataSnapshot, max: number): { orders: SavedForms['orders']; lines: SavedForms['lines'] } {
  const versioned = snapshot.kind === 'postgres' ? { versionColumn: 'row_version' } : {}
  const order = generateForm(snapshot, {
    connection: 'erp',
    root: { schema: 'sales', name: 'order' },
    formId: 'sales-order',
    title: 'Order',
    lookups: [
      { foreignKey: 'fk_order_customer', display: ['name'] },
      { foreignKey: 'fk_order_created_by', display: ['name'] },
    ],
    ...versioned,
  }).bindings
  if (snapshot.kind === 'sqlserver' && order.concurrency !== null) order.concurrency.touch = 'notes'
  const lines = generateForm(snapshot, {
    connection: 'erp',
    root: { schema: 'sales', name: 'order_line' },
    formId: 'sales-order-line',
    title: 'Order line',
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
    ...versioned,
  }).bindings
  return {
    orders: { id: 'sales-order', connection: 'erp', snapshot, bindings: order, policy: SIZED_ORDER_POLICY },
    lines: { id: 'sales-order-line', connection: 'erp', snapshot, bindings: savedWith(lines, 'order', { min: 0, max }), policy: SIZED_LINE_POLICY },
  }
}

/**
 * `request`, a save planned with one line created, with `n` lines created
 * instead -- each its planned line's step under the next line number from
 * 1 -- and the count held to `n`: what the planner makes up to
 * `TOGETHER_MAX_ROWS` and only this makes past it, so a sized suite can
 * measure a save larger than any together child may declare.
 */
export function withLines(request: SaveRequest, n: number): SaveRequest {
  const child = request.children[0]
  const line = child?.creates[0]
  if (child === undefined || line === undefined) throw new Error('the save creates no line to repeat')
  const creates = Array.from({ length: n }, (_, index) => ({
    ...line,
    values: line.values.map((value) => (value.name === 'line_no' ? { ...value, value: String(index + 1) } : value)),
  }))
  return { ...request, children: [{ ...child, creates, count: { ...child.count, max: n } }] }
}

/** A sample's p50, p95 and p99 by nearest rank, and its largest: what a sized suite reports of its timings. */
export function percentiles(sample: readonly number[]): { p50: number; p95: number; p99: number; max: number } {
  const sorted = [...sample].sort((left, right) => left - right)
  const rank = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] as number
  return { p50: rank(50), p95: rank(95), p99: rank(99), max: sorted.at(-1) as number }
}
