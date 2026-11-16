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
} from '@formancy/data-core'

/*
 * A run of an action over the open record (0160), written once for both
 * adapters' `actions.integration.test.ts` and their
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
 *   description and the run. The engines differ: PostgreSQL's SECURITY
 *   DEFINER is part of the routine's definition, and the run refuses it;
 *   SQL Server's EXECUTE AS OWNER is not, since every procedure there
 *   already reaches its owner's tables by ownership chaining (0158).
 * - `execute-revoked`: EXECUTE taken from the account: `permission-denied`.
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
  'reach-changed': { postgres: 'schema-changed', sqlserver: 'done' },
  'execute-revoked': 'permission-denied',
  'held-lock': { postgres: 'action-timeout', sqlserver: 'unavailable' },
  'slow-routine': { postgres: 'action-timeout', sqlserver: 'unknown-outcome' },
  'lost-answer': 'unknown-outcome',
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

/** `close`: one value from each kind of source. `broken`: the key alone, to a routine whose body is broken. */
function orderActions(snapshot: MetadataSnapshot): ActionChoice[] {
  const kind = snapshot.kind
  return [
    {
      name: 'close',
      routine: routine(snapshot, 'close_order'),
      scope: 'record',
      parameters: [
        { parameter: named(kind, 'p_order'), from: { key: 'id' } },
        { parameter: named(kind, 'p_note'), from: { input: 'note' } },
        { parameter: named(kind, 'p_actor'), from: { actor: 'id' } },
        { parameter: named(kind, 'p_amount'), from: { field: 'amount' } },
        { parameter: named(kind, 'p_tenant'), from: { attribute: 'tenant' } },
      ],
    },
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
    orders: bundle('action-order', orders, throughCustomer(['id', 'customer', 'note', 'amount', 'status'], ['close', 'broken'])),
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

/** The token of a row of the actions schema by its id, as the API carries it. */
export function actionToken(id: number | string): string {
  const encoded = recordToken(['id'], { id: String(id) })
  if (!encoded.ok) throw new Error(`no token for ${String(id)}: ${encoded.message}`)
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
    { records: [{ record: body.record, version: body.version }], answers: body.answers ?? {} },
    { table: described.table, routine: described.routine },
  )
  if (!planned.ok) {
    const drift = 'drift' in planned ? ` ${planned.drift.map((change) => change.message).join(' ')}` : ''
    throw new Error(`the run was not planned: ${planned.code}: ${planned.message}${drift}`)
  }
  return planned.request
}
