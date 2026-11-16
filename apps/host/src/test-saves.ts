import mssql from 'mssql'
import type postgres from 'postgres'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormPolicy, RecordAdapter } from '@formancy/data-core'
import { clerkPolicy, lookupsOf } from './test-forms.js'
import type { Proposed } from './test-forms.js'
import { ENGINES } from './test-plane.js'
import type { Engine } from './test-plane.js'

/*
 * What `startPlane({ saves: true })` publishes (0155): on each engine, an
 * order of the parity schema, its key numbered and its version a column,
 * and its lines saved with it, one to three, whose trigger keeps the
 * order's total and moves its version (the parity fixture's) -- and how a
 * suite writes and reads them as the database's owner, beside the page.
 */

/** Publishes each engine's saved order and its lines through the administrator's plane. */
export async function publishSaved(admin: (url: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<void> {
  for (const { parity: connection, savedOrder, savedLines } of ENGINES) {
    // An order of the clerk's tenant, its key numbered and its version a column on both engines, and its lines saved with it,
    // one to three, whose trigger keeps the order's total and moves its version (the parity fixture's).
    const orders = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'parity', name: 'saved_order' },
      formId: savedOrder,
      title: 'Order',
      lookups: [],
      versionColumn: 'version',
      pinned: ['tenant_id'],
    })
    const lines = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'parity', name: 'saved_line' },
      formId: savedLines,
      title: 'Order line',
      lookups: [{ foreignKey: 'fk_saved_line_order', display: ['note'], together: { min: 1, max: 3 } }],
      versionColumn: 'version',
    })
    const orderPolicy: FormPolicy = { ...clerkPolicy((orders['bindings'] as Proposed).fields), lookups: {} }
    // A line is read through its order, and deleted -- in a save of it alone -- by a remover, whom no other form names.
    const field = String(lookupsOf(lines['bindings'] as Proposed)[0]?.field)
    const linePolicy: FormPolicy = {
      ...clerkPolicy((lines['bindings'] as Proposed).fields),
      operations: { read: ['clerk', 'remover'], create: ['clerk'], update: ['clerk'], delete: ['remover'] },
      rowFilters: [],
      lookups: { [field]: [{ column: 'tenant_id', attribute: 'tenant' }] },
      through: [field],
    }
    for (const [formId, proposal, policy] of [
      [savedOrder, orders, orderPolicy],
      [savedLines, lines, linePolicy],
    ] as const) {
      const { form, bindings, snapshot, generation } = proposal
      await admin(`/v1/forms/${formId}/versions`, {
        expectedBase: null,
        bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
      })
    }
  }
}

/** What a suite asks of the saved orders as the owner. */
export interface SavedDb {
  /** An order of tenant 1's on the parity schema noted `note`, with `lines` lines numbered from 1, written by the owner as another application would: its token. */
  insertSavedOrder(connection: Engine['connection'], note: string, lines: number): Promise<string>
  /** The parity order's lines, as the owner reads them: each line's number and quantity, in number order. */
  savedLines(connection: Engine['connection'], record: string): Promise<Array<{ no: number; quantity: number }>>
  /** How many parity orders are noted `note`, asked of the owner. */
  countSavedOrders(connection: Engine['connection'], note: string): Promise<number>
}

export function savedDb(pgAdmin: postgres.Sql, msAdmin: mssql.ConnectionPool): SavedDb {
  return {
    insertSavedOrder: async (connection, note, lines) => {
      let id: string
      if (connection === 'pg') {
        const [row] = await pgAdmin<Array<{ id: string }>>`insert into parity.saved_order (tenant_id, note) values (1, ${note}) returning id::text as id`
        id = String(row?.id)
        for (let no = 1; no <= lines; no += 1) await pgAdmin`insert into parity.saved_line (order_id, line_no, quantity) values (${Number(id)}, ${no}, ${no})`
      } else {
        // Into a table variable: SQL Server refuses an OUTPUT without INTO on a table a trigger updates (334).
        const made = await msAdmin
          .request()
          .input('note', mssql.VarChar(50), note)
          .query<{ id: string }>(
            'declare @made table (id int); insert into parity.saved_order (tenant_id, note) output inserted.id into @made values (1, @note); select cast(id as nvarchar(20)) as id from @made',
          )
        id = String(made.recordset[0]?.id)
        for (let no = 1; no <= lines; no += 1)
          await msAdmin
            .request()
            .input('id', mssql.Int, Number(id))
            .input('no', mssql.Int, no)
            .query('insert into parity.saved_line (order_id, line_no, quantity) values (@id, @no, @no)')
      }
      return `k1:${id}`
    },
    savedLines: async (connection, record) => {
      const id = Number(record.slice('k1:'.length))
      if (connection === 'pg')
        return [
          ...(await pgAdmin<
            Array<{ no: number; quantity: number }>
          >`select line_no as no, quantity from parity.saved_line where order_id = ${id} order by line_no`),
        ]
      const result = await msAdmin
        .request()
        .input('id', mssql.Int, id)
        .query<{ no: number; quantity: number }>('select line_no as no, quantity from parity.saved_line where order_id = @id order by line_no')
      return result.recordset.map((row) => ({ no: row.no, quantity: row.quantity }))
    },
    countSavedOrders: async (connection, note) => {
      if (connection === 'pg') return (await pgAdmin<Array<{ n: number }>>`select count(*)::int as n from parity.saved_order where note = ${note}`)[0]?.n ?? 0
      const result = await msAdmin
        .request()
        .input('note', mssql.VarChar(50), note)
        .query<{ n: number }>('select count(*) as n from parity.saved_order where note = @note')
      return result.recordset[0]?.n ?? 0
    },
  }
}

/**
 * A connection's saves, the next of which loses its answer where `lose`
 * names the connection: `after` the transaction committed, or `before` it
 * began, the server told what a cut connection tells it (0031).
 */
export function losingSaves(records: RecordAdapter, id: string, lose: Map<string, 'after' | 'before'>): RecordAdapter['save'] {
  return async (request) => {
    const when = lose.get(id)
    if (when === undefined) return records.save(request)
    lose.delete(id)
    if (when === 'after') {
      const stored = await records.save(request)
      if (!stored.ok) throw new Error('the save whose answer was to be lost was refused')
    }
    return {
      ok: false,
      at: 'save',
      failure: { ok: false, code: 'unknown-outcome', message: 'The connection to the database closed before the answer arrived.' },
    }
  }
}
