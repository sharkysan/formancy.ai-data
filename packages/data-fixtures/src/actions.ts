import { generateForm, planAction, recordToken } from '@formancy/data-core'
import type {
  ActionAdapter,
  ActionChoice,
  ActionOutcome,
  ActionRequest,
  DatabaseKind,
  DiscoveryScope,
  FormBindings,
  FormPolicy,
  GenerationRequest,
  MetadataSnapshot,
  PolicyContext,
  RoutineOnNull,
} from '@formancy/data-core'

/*
 * A run of an action over the open record (0160), and over a selection
 * (0165), written once for both adapters' `actions.integration.test.ts`,
 * `actions-selection.integration.test.ts` and
 * `actions-lost-answer.integration.test.ts`.
 *
 * Each suite starts its own fixture, discovers the actions schema
 * (fixtures/*.actions.sql) as formancy_writer, the account a run goes as,
 * generates the forms below over it, inserts what a case starts from as the
 * owner, plans each run as the server's route will (`plannedAction`: the
 * root and the routine described, then `planAction`), sends it through its
 * adapter, and reads what is stored, and which calls the routines
 * received, as the owner. The answer each case expects is below, rendered
 * by `actionAnswer`. Where the engines differ, the difference is named per
 * engine and written down in each adapter.
 */

/** Where the actions schema lives, discovered with its routines. */
export const ACTION_SCOPE: DiscoveryScope = { schemas: ['actions'], routines: true }

/** A run's answer as ACTION_PARITY writes it: `done`, or the code it failed with. */
export type ActionAnswer = string

/** One answer for both engines, or one per engine where they differ. */
export type ActionExpectation = ActionAnswer | Readonly<Record<DatabaseKind, ActionAnswer>>

/**
 * The shared expectations, by case. `actionCase(name)` is each one's id.
 *
 * - `done`: `close` over an order of the clerk's tenant commits; the
 *   version moved by one, the order closed by the routine, which was given
 *   the key, the answer, the actor's id, the amount as stored and the
 *   tenant.
 * - `second-run`: two runs from one read: the first done, the second
 *   `stale`, and the routine called once.
 * - `other-tenant`: a token minted for another tenant's order: `not-found`,
 *   and the routine not called.
 * - `parent-moved`: the order's customer moved to another tenant while a
 *   run holds the order: the move waits for the run, which is done.
 * - `version-ended`: `reprice` of a price whose version has ended:
 *   `version-ended`, not called.
 * - `declined`: the routine raises the prefixed refusal: `declined`, with
 *   ACTION_DECLINED_REASON, and nothing kept.
 * - `refused`: the routine raises an error not worded for the person.
 * - `missing-column`: `broken`, whose body sets a column no table has:
 *   `refused`, never `schema-changed` or a thrown error.
 * - `recreated`: the routine dropped and created again between the
 *   description and the run: `schema-changed`, not called.
 * - `reach-changed`: the routine made to run as its owner between the
 *   description and the run -- PostgreSQL's SECURITY DEFINER, SQL Server's
 *   EXECUTE AS OWNER, which reaches what ownership chaining does not:
 *   `schema-changed`, not called.
 * - `execute-revoked`: EXECUTE taken from the account, the only permission
 *   it held on the routine, asked of the run and of a description after
 *   it. The engines differ: PostgreSQL's catalog shows the account the
 *   function still, and the call is refused, `permission-denied`; SQL
 *   Server shows an account only what it holds a permission on, so the
 *   procedure is out of its sight as one dropped would be, and nothing the
 *   account can ask tells the two apart: `schema-changed`, as drift review
 *   would find it gone.
 * - `held-lock`: another transaction holds the order's row past what the
 *   run waits for it. The engines differ: PostgreSQL's statement timeout,
 *   the deadline, stops the wait (`action-timeout`); SQL Server's lock
 *   timeout, half the deadline, ends it as 1222 (`unavailable`). Nothing
 *   kept on either.
 * - `slow-routine`: the routine runs past the deadline. PostgreSQL stops it
 *   in the server, rolled back; SQL Server's client stops waiting, after
 *   which it may have committed (0031 P3).
 * - `lost-answer`: the connection cut once the call was sent: unknown,
 *   sent once.
 *
 * Over a selection (0165), `close-all`, close over the records chosen:
 *
 * - `selection-done`: three orders, sent out of key order, commit in one
 *   run: each version moved by one, the routine called once for each, and
 *   each answered by its key in the order sent.
 * - `selection-crossed`: two runs over the same two orders, sent in
 *   opposite orders while a third transaction holds the lower key's row:
 *   both wait on it, and once it is let go one is done and the other
 *   stale, never a deadlock -- each locks in key order whatever the order
 *   sent. The answers sorted, `done, stale`.
 * - `selection-stale`: one order of three changed since it was read: the
 *   run is `stale`, naming that one, nothing called and nothing kept.
 * - `selection-declined`: the routine refuses one order of three, its
 *   amount 66.60: `declined` in its words, and nothing kept of any.
 * - `selection-page`: a selection of exactly a page, `LIST_PAGE_SIZE`
 *   orders, commits; one more is refused before any statement.
 * - `selection-as-locked`: each call raises the amount of the selection's
 *   other order, noted 'raise others': done, and each call was given the
 *   amount its own order held once locked, never what the other call
 *   wrote to it -- PostgreSQL reads every argument in one statement under
 *   one snapshot, and SQL Server's batch reads every record's before its
 *   first EXEC.
 */
export const ACTION_PARITY = {
  done: 'done',
  'second-run': 'stale',
  'other-tenant': 'not-found',
  'parent-moved': 'done',
  'version-ended': 'version-ended',
  declined: 'declined',
  refused: 'refused',
  'missing-column': 'refused',
  recreated: 'schema-changed',
  'reach-changed': 'schema-changed',
  'execute-revoked': { postgres: 'permission-denied', sqlserver: 'schema-changed' },
  'held-lock': { postgres: 'action-timeout', sqlserver: 'unavailable' },
  'slow-routine': { postgres: 'action-timeout', sqlserver: 'unknown-outcome' },
  'lost-answer': 'unknown-outcome',
  'selection-done': 'done',
  'selection-crossed': 'done, stale',
  'selection-stale': 'stale',
  'selection-declined': 'declined',
  'selection-page': 'done',
  'selection-as-locked': 'done',
} as const satisfies Readonly<Record<string, ActionExpectation>>

export type ActionCase = keyof typeof ACTION_PARITY

/** What `name` answers on `engine`. */
export function actionExpected(name: ActionCase, engine: DatabaseKind): ActionAnswer {
  const expected: ActionExpectation = ACTION_PARITY[name]
  return typeof expected === 'string' ? expected : expected[engine]
}

/** A run's answer as ACTION_PARITY writes it. */
export function actionAnswer(outcome: ActionOutcome): ActionAnswer {
  return outcome.ok ? 'done' : outcome.code
}

/**
 * Whether the engine calls each routine both editions of the actions schema
 * create when an argument is NULL, as discovery records it (0167), one
 * expectation for both engines: weigh_order is PostgreSQL's STRICT function
 * and SQL Server's scalar function declared RETURNS NULL ON NULL INPUT,
 * which each engine answers NULL for without running it; every other is
 * called. `actionOnNull` reads a snapshot the same way.
 */
export const ACTION_ON_NULL = {
  broken_order: 'called',
  close_order: 'called',
  reprice: 'called',
  weigh_order: 'not-called',
} as const satisfies Readonly<Record<string, RoutineOnNull>>

/** What `snapshot` records of each routine ACTION_ON_NULL names, by name: `null` where it does not say, and `missing` where it records no routine of that name. */
export function actionOnNull(snapshot: MetadataSnapshot): Record<string, RoutineOnNull | null | 'missing'> {
  return Object.fromEntries(
    Object.keys(ACTION_ON_NULL).map((name) => {
      const found = (snapshot.routines ?? []).find((routine) => routine.ref.schema === 'actions' && routine.ref.name === name)
      return [name, found === undefined ? 'missing' : (found.onNull ?? null)]
    }),
  )
}

/** What close_order says to the person of an order noted 'refuse', after the prefix both fixture files raise it with (0156). */
export const ACTION_DECLINED_REASON = 'This order cannot be closed now.'

const CLERKS = ['clerk']
const READ = { read: CLERKS, write: [] }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]

/** Clara, a clerk of tenant 1, who may read and run, and update nothing. */
export const ACTION_CLERK: PolicyContext = { actor: { id: 'clara', roles: CLERKS }, attributes: { tenant: '1' } }

/** A form's bundle as a run is planned over it: what the route will read from the store. */
export interface ActionBundle {
  id: string
  connection: string
  snapshot: MetadataSnapshot
  bindings: FormBindings
  policy: FormPolicy
}

/** The forms over the actions schema: orders and prices on both engines, and SQL Server's tickets. */
export interface ActionForms {
  orders: ActionBundle
  prices: ActionBundle
  /** SQL Server's alone: a rowversion form. */
  tickets: ActionBundle | undefined
}

/** Read and run, nothing else: of the clerk's tenant, by the customer each record is scoped through (0043). */
function throughCustomer(fields: readonly string[], actions: readonly string[]): FormPolicy {
  return {
    version: 1,
    operations: { read: CLERKS, create: [], update: [] },
    fields: Object.fromEntries(fields.map((field) => [field, READ])),
    rowFilters: [],
    lookups: { customer: TENANT },
    through: ['customer'],
    actions: Object.fromEntries(actions.map((action) => [action, { roles: CLERKS }])),
  }
}

/** A parameter's name as `kind`'s catalog spells it: SQL Server's with its `@`. */
const named = (kind: DatabaseKind, name: string): string => (kind === 'sqlserver' ? `@${name}` : name)

/** A routine of the actions schema as the snapshot records it: one of each name, before any case makes an overload. */
function routine(snapshot: MetadataSnapshot, name: string): ActionChoice['routine'] {
  const found = (snapshot.routines ?? []).filter((entry) => entry.ref.schema === 'actions' && entry.ref.name === name)
  if (found.length !== 1) throw new Error(`the snapshot records ${String(found.length)} routines actions.${name}`)
  return { ...(found[0] as (typeof found)[number]).ref }
}

/**
 * `close`: one value from each kind of source. `close-all`: the same, over
 * a selection (0165). `broken`: the key alone, to a routine whose body is
 * broken.
 */
function orderActions(snapshot: MetadataSnapshot): ActionChoice[] {
  const kind = snapshot.kind
  const close: ActionChoice['parameters'] = [
    { parameter: named(kind, 'p_order'), from: { key: 'id' } },
    { parameter: named(kind, 'p_note'), from: { input: 'note' } },
    { parameter: named(kind, 'p_actor'), from: { actor: 'id' } },
    { parameter: named(kind, 'p_amount'), from: { field: 'amount' } },
    { parameter: named(kind, 'p_tenant'), from: { attribute: 'tenant' } },
  ]
  return [
    { name: 'close', routine: routine(snapshot, 'close_order'), scope: 'record', parameters: close },
    { name: 'close-all', routine: routine(snapshot, 'close_order'), scope: 'selection', parameters: close },
    {
      name: 'broken',
      routine: routine(snapshot, 'broken_order'),
      scope: 'record',
      parameters: [{ parameter: named(kind, 'p_order'), from: { key: 'id' } }],
    },
  ]
}

function form(snapshot: MetadataSnapshot, request: Omit<GenerationRequest, 'connection'>): FormBindings {
  const generated = generateForm(snapshot, { connection: 'actions', ...request })
  const actions = new Set((generated.bindings.actions ?? []).map((action) => action.name))
  const missing = (request.actions ?? []).filter((choice) => !actions.has(choice.name))
  if (missing.length > 0) {
    const notes = generated.notes.filter((note) => note.kind === 'blocked').map((note) => note.message)
    throw new Error(`the generator bound no ${missing.map((choice) => choice.name).join(', ')}: ${notes.join(' ')}`)
  }
  return generated.bindings
}

/** The forms over the actions schema as `snapshot` discovered it, each action bound by the generator. */
export function actionForms(snapshot: MetadataSnapshot): ActionForms {
  const kind = snapshot.kind
  const bundle = (id: string, bindings: FormBindings, policy: FormPolicy): ActionBundle => ({ id, connection: 'actions', snapshot, bindings, policy })
  const customer = [{ foreignKey: 'fk_order_customer', display: ['name'] }]
  const orders = form(snapshot, {
    root: { schema: 'actions', name: 'order' },
    formId: 'action-order',
    title: 'Order',
    lookups: customer,
    versionColumn: 'version',
    actions: orderActions(snapshot),
  })
  const prices = form(snapshot, {
    root: { schema: 'actions', name: 'price' },
    formId: 'action-price',
    title: 'Price',
    lookups: [{ foreignKey: 'fk_price_customer', display: ['name'] }],
    versionColumn: 'version',
    validity: { from: 'valid_from', to: 'valid_to' },
    actions: [
      { name: 'reprice', routine: routine(snapshot, 'reprice'), scope: 'record', parameters: [{ parameter: named(kind, 'p_price'), from: { key: 'id' } }] },
    ],
  })
  const tickets =
    kind === 'sqlserver'
      ? form(snapshot, {
          root: { schema: 'actions', name: 'ticket' },
          formId: 'action-ticket',
          title: 'Ticket',
          lookups: [],
          touchColumn: 'note',
          actions: [
            {
              name: 'label',
              routine: routine(snapshot, 'label_ticket'),
              scope: 'record',
              parameters: [
                { parameter: '@p_ticket', from: { key: 'id' } },
                { parameter: '@p_label', from: { field: 'label' } },
                { parameter: '@p_remark', from: { input: 'remark' } },
                { parameter: '@p_actor', from: { actor: 'id' } },
              ],
            },
          ],
        })
      : undefined
  return {
    orders: bundle('action-order', orders, throughCustomer(['id', 'customer', 'note', 'amount', 'status'], ['close', 'close-all', 'broken'])),
    prices: bundle('action-price', prices, throughCustomer(['id', 'customer', 'product_no', 'valid_from', 'valid_to', 'amount'], ['reprice'])),
    tickets:
      tickets === undefined
        ? undefined
        : bundle('action-ticket', tickets, {
            version: 1,
            operations: { read: CLERKS, create: [], update: [] },
            fields: { id: READ, note: READ, label: READ },
            rowFilters: [],
            lookups: {},
            actions: { label: { roles: CLERKS } },
          }),
  }
}

/**
 * SQL Server's tag form (0165): a rowversion form keyed by text under a
 * case-insensitive collation, `touch` over a selection of it. Apart from
 * `actionForms`, which every action suite asks, so that only the suite it
 * is for depends on it.
 */
export function actionTagForm(snapshot: MetadataSnapshot): ActionBundle {
  if (snapshot.kind !== 'sqlserver') throw new Error('the actions schema has a tag table on SQL Server alone')
  const tags = form(snapshot, {
    root: { schema: 'actions', name: 'tag' },
    formId: 'action-tag',
    title: 'Tag',
    lookups: [],
    touchColumn: 'note',
    actions: [{ name: 'touch', routine: routine(snapshot, 'touch_tag'), scope: 'selection', parameters: [{ parameter: '@p_code', from: { key: 'code' } }] }],
  })
  return {
    id: 'action-tag',
    connection: 'actions',
    snapshot,
    bindings: tags,
    policy: {
      version: 1,
      operations: { read: CLERKS, create: [], update: [] },
      fields: { code: READ, note: READ },
      rowFilters: [],
      lookups: {},
      actions: { touch: { roles: CLERKS } },
    },
  }
}

/** The token of a row of the actions schema by its id, as the API carries it. */
export function actionToken(id: number | string): string {
  const encoded = recordToken(['id'], { id: String(id) })
  if (!encoded.ok) throw new Error(`no token for ${String(id)}: ${encoded.message}`)
  return encoded.token
}

/** The token of a tag, SQL Server's text key, as the API carries it: spelled as given, which the case-insensitive key collation may make another's. */
export function tagToken(code: string): string {
  const encoded = recordToken(['code'], { code })
  if (!encoded.ok) throw new Error(`no token for ${code}: ${encoded.message}`)
  return encoded.token
}

/**
 * A run planned as the server's route will plan one (0160): the root and
 * the routine described by the adapter in one statement, then `planAction`
 * with the body the browser sends. Throws on any refusal before the
 * transaction, which is the planner's suites' to hold, so a case reaches
 * the adapter with exactly the request the route would send.
 */
export async function plannedAction(
  actions: ActionAdapter,
  bundle: ActionBundle,
  name: string,
  body: { record: string; version: string; answers?: Record<string, unknown> },
  context: PolicyContext = ACTION_CLERK,
): Promise<ActionRequest> {
  return plannedSelection(actions, bundle, name, { records: [{ record: body.record, version: body.version }], answers: body.answers ?? {} }, context)
}

/**
 * A run over the records `body` names, planned as `plannedAction` plans
 * one: for an action over a selection, every record chosen, in the order
 * sent (0165).
 */
export async function plannedSelection(
  actions: ActionAdapter,
  bundle: ActionBundle,
  name: string,
  body: { records: Array<{ record: string; version: string }>; answers?: Record<string, unknown> },
  context: PolicyContext = ACTION_CLERK,
): Promise<ActionRequest> {
  const action = (bundle.bindings.actions ?? []).find((candidate) => candidate.name === name)
  if (action === undefined) throw new Error(`${bundle.id} binds no action ${name}`)
  const described = await actions.describe(bundle.bindings.root, action.routine)
  if (!described.ok) throw new Error(`the root and the routine were not described: ${described.code}: ${described.message}`)
  const planned = planAction(
    bundle.snapshot,
    bundle.bindings,
    bundle.policy,
    context,
    name,
    { records: body.records, answers: body.answers ?? {} },
    { table: described.table, routine: described.routine },
  )
  if (!planned.ok) {
    const drift = 'drift' in planned ? ` ${planned.drift.map((change) => change.message).join(' ')}` : ''
    throw new Error(`the run was not planned: ${planned.code}: ${planned.message}${drift}`)
  }
  return planned.request
}
