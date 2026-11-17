import mssql from 'mssql'
import type postgres from 'postgres'
import { applyPresentation, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { ActionAdapter, ActionOutcome, FormBindings, FormPolicy, PresentationOverrides } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import type { Engine } from './test-plane.js'

/*
 * What `startPlane({ actions: true })` publishes (0162): on each engine an
 * order of the actions schema every fixture loads (data-fixtures'
 * fixtures/*.actions.sql, 0160), with close_order bound as `close` -- one
 * value from each kind of source, the note asked in its dialog, as
 * data-client's plane binds it -- and worded by its presentation; and
 * bound again as `stamp`, the note the order's own, so it asks no dialog,
 * and its presentation gives it a label alone, so the page says its own
 * confirmation and its own "Done."; and bound a third time as `close-all`,
 * over a selection (0165), with a label of its own, which the open
 * record's header never offers. The clerk reads the order, changes its
 * note and amount, and may run all three, within their tenant through the
 * order's customer (0043). And how a suite writes and reads those orders
 * as the database's owner, beside the page, and loses a run's answer.
 */

/** The action order's form on `engine`. */
export const actionForm = ({ connection }: Pick<Engine, 'connection'>): string => `${connection}-action-order`

/** What close's presentation says: its label, the sentence its confirmation asks, and the one said once it ran. */
export const CLOSE_WORDS = {
  label: 'Close the order',
  confirm: 'It closes the order, and the database keeps the note with it.',
  done: 'The order is closed.',
} as const

/** What stamp's presentation says: its label, and nothing else. */
export const STAMP_LABEL = 'Close as noted'

/** What close-all's presentation says: its label, which no control of the open record's header may carry (0165). */
export const CLOSE_ALL_LABEL = 'Close the chosen orders'

/**
 * What close_order says to the person of an order noted `refuse`, after the
 * refusal prefix both fixture files raise it with (0156): data-fixtures'
 * ACTION_DECLINED_REASON, which a jsdom worker cannot import -- the package
 * brings testcontainers -- so a sentence that drifts from it fails the page.
 */
export const CLOSE_DECLINED = 'This order cannot be closed now.'

/** close_order as each engine's catalog names it -- PostgreSQL by its argument types, SQL Server by its name alone -- with a source for every parameter. */
const CLOSE = {
  pg: {
    name: 'close',
    routine: { schema: 'actions', name: 'close_order', signature: 'pg_catalog.int8, pg_catalog.text, pg_catalog.text, pg_catalog."numeric", pg_catalog.int4' },
    scope: 'record',
    parameters: [
      { parameter: 'p_order', from: { key: 'id' } },
      { parameter: 'p_note', from: { input: 'note' } },
      { parameter: 'p_actor', from: { actor: 'id' } },
      { parameter: 'p_amount', from: { field: 'amount' } },
      { parameter: 'p_tenant', from: { attribute: 'tenant' } },
    ],
  },
  ms: {
    name: 'close',
    routine: { schema: 'actions', name: 'close_order', signature: '' },
    scope: 'record',
    parameters: [
      { parameter: '@p_order', from: { key: 'id' } },
      { parameter: '@p_note', from: { input: 'note' } },
      { parameter: '@p_actor', from: { actor: 'id' } },
      { parameter: '@p_amount', from: { field: 'amount' } },
      { parameter: '@p_tenant', from: { attribute: 'tenant' } },
    ],
  },
} as const

/** close_order again, the note the order's own: an action with no dialog. */
const STAMP = {
  pg: {
    ...CLOSE.pg,
    name: 'stamp',
    parameters: CLOSE.pg.parameters.map((given) => (given.parameter === 'p_note' ? { parameter: 'p_note', from: { field: 'note' } } : given)),
  },
  ms: {
    ...CLOSE.ms,
    name: 'stamp',
    parameters: CLOSE.ms.parameters.map((given) => (given.parameter === '@p_note' ? { parameter: '@p_note', from: { field: 'note' } } : given)),
  },
}

/** close_order over a selection (0165): close's sources, over every record chosen. */
const CLOSE_ALL = {
  pg: { ...CLOSE.pg, name: 'close-all', scope: 'selection' },
  ms: { ...CLOSE.ms, name: 'close-all', scope: 'selection' },
} as const

/** The fields of an order the clerk changes: every other they read. */
const WRITTEN = new Set(['note', 'amount'])

/** Publishes each engine's action order through the administrator's plane, on its connection to the actions schema. */
export async function publishActions(
  admin: (url: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
  engines: readonly Pick<Engine, 'connection'>[],
): Promise<void> {
  for (const { connection } of engines) {
    const formId = actionForm({ connection })
    const proposal = await admin('/v1/form-proposals', {
      connection: `${connection}-actions`,
      root: { schema: 'actions', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      versionColumn: 'version',
      actions: [CLOSE[connection], STAMP[connection], CLOSE_ALL[connection]],
    })
    const bindings = proposal['bindings'] as FormBindings
    if ((bindings.actions ?? []).length !== 3)
      throw new Error(`the generator did not bind close, stamp and close-all on ${connection}: ${JSON.stringify(proposal['notes'])}`)
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: [], update: ['clerk'] },
      fields: Object.fromEntries(
        bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: WRITTEN.has(binding.field) && binding.writes.update ? ['clerk'] : [] }]),
      ),
      rowFilters: [],
      lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
      through: ['customer'],
      actions: { close: { roles: ['clerk'] }, stamp: { roles: ['clerk'] }, 'close-all': { roles: ['clerk'] } },
    }
    const presentation: PresentationOverrides = {
      ...EMPTY_PRESENTATION,
      actions: [
        { action: 'close', ...CLOSE_WORDS },
        { action: 'stamp', label: STAMP_LABEL },
        { action: 'close-all', label: CLOSE_ALL_LABEL },
      ],
    }
    const base = proposal['form'] as FormSchema
    const presented = applyPresentation(base, presentation, bindings)
    if (!presented.ok) throw new Error(`close's words do not apply: ${presented.problems.join('; ')}`)
    const { snapshot, generation } = proposal
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection: `${connection}-actions`, generation, base, presentation, form: presented.form, bindings, policy, snapshot },
    })
  }
}

/** An order of the actions schema as the owner reads it: what close_order sets, the version, the amount as stored, and how many of its calls over the order were kept. */
export interface ActionOrder {
  status: string
  version: number
  note: string | null
  amount: string
  closes: number
}

/** What a suite asks of the action orders as the owner. */
export interface ActionDb {
  /** An open order of tenant 1's in the actions schema, for a customer of its own, at version 1, as the owner inserts it: its token. */
  insertActionOrder(connection: Engine['connection']): Promise<string>
  actionOrder(connection: Engine['connection'], record: string): Promise<ActionOrder>
}

export function actionDb(pgAdmin: postgres.Sql, msAdmin: mssql.ConnectionPool): ActionDb {
  return {
    insertActionOrder: async (connection) => {
      if (connection === 'pg') {
        const [customer] = await pgAdmin<
          Array<{ id: string }>
        >`insert into actions.customer (tenant_id, name) values (1, 'Host customer') returning id::text as id`
        const [row] = await pgAdmin<
          Array<{ id: string }>
        >`insert into actions."order" (customer_id, amount) values (${customer?.id ?? ''}::bigint, 12.50) returning id::text as id`
        return `k1:${String(row?.id)}`
      }
      const customer = await msAdmin
        .request()
        .query<{ id: string }>("insert into actions.customer (tenant_id, name) output cast(inserted.id as nvarchar(20)) as id values (1, N'Host customer')")
      const row = await msAdmin
        .request()
        .input('customer', mssql.BigInt, customer.recordset[0]?.id)
        .query<{ id: string }>('insert into actions.[order] (customer_id, amount) output cast(inserted.id as nvarchar(20)) as id values (@customer, 12.50)')
      return `k1:${String(row.recordset[0]?.id)}`
    },
    actionOrder: async (connection, record) => {
      const id = record.slice('k1:'.length)
      if (connection === 'pg') {
        const [row] = await pgAdmin<ActionOrder[]>`
          select o.status, o.version, o.note, o.amount::text as amount,
            (select count(*)::int from actions.call c where c.record_id = o.id and c.routine = 'close_order') as closes
          from actions."order" o where o.id = ${id}::bigint`
        return { ...(row as ActionOrder) }
      }
      const result = await msAdmin
        .request()
        .input('id', mssql.BigInt, id)
        .query<ActionOrder>(
          "select o.status, o.version, o.note, cast(o.amount as nvarchar(20)) as amount, (select count(*) from actions.call c where c.record_id = o.id and c.routine = N'close_order') as closes from actions.[order] o where o.id = @id",
        )
      return { ...(result.recordset[0] as ActionOrder) }
    },
  }
}

/**
 * What the next run on a connection does with its answer: `after`, lost
 * once the run committed; `late`, lost before the run was sent, which is
 * held in `late` and committed only when the suite runs it -- as a
 * PostgreSQL transaction orphaned by a cut can commit after its client
 * gave up (0031), after a check found nothing of it. The server is told
 * what a cut connection tells it, `unknown-outcome`, and answers 502
 * naming the action and the record with its version (0161). The fault is
 * the network's, around a real run: data-server's e2e-lost-answer proves
 * the adapters say `unknown-outcome` when a TCP hop really drops it.
 */
export interface LosingRuns {
  lose: Map<string, 'after' | 'late'>
  late: Array<() => Promise<ActionOutcome>>
}

export function losingRuns(actions: ActionAdapter, id: string, losing: LosingRuns): ActionAdapter {
  return {
    describe: (table, routine) => actions.describe(table, routine),
    run: async (request, deadlineMs) => {
      const when = losing.lose.get(id)
      if (when === undefined) return actions.run(request, deadlineMs)
      losing.lose.delete(id)
      if (when === 'after') {
        const ran = await actions.run(request, deadlineMs)
        if (!ran.ok) throw new Error(`the run whose answer was to be lost was refused: ${ran.code}`)
      } else losing.late.push(() => actions.run(request, deadlineMs))
      return { ok: false, code: 'unknown-outcome', message: 'The connection to the database closed before the answer arrived.' }
    },
  }
}
