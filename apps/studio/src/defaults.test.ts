// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. What the studio's Generate
// step previews and notes is what the generator makes of these snapshots.
import { generateForm } from '@formancy/data-core'
import type { GeneratedForm, MetadataSnapshot } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { OWNER_SNAPSHOT, READER_SNAPSHOT, SQLSERVER_READER_SNAPSHOT, SQLSERVER_SNAPSHOT, SQLSERVER_WRITER_SNAPSHOT, WRITER_SNAPSHOT } from './test-server.js'

/*
 * A new record starts with its column's constant default (0149), over the
 * databases the studio's suite discovers: the snapshots captured from the
 * shared fixture on both engines, which spell each default as the engine's
 * catalog does -- 'draft'::character varying and ('draft'), true and ((1)),
 * now() and (sysdatetimeoffset()). The generator reads each engine's
 * spelling, so the same table starts with the same answers on both.
 */

function generated(snapshot: MetadataSnapshot, table: string): GeneratedForm {
  return generateForm(snapshot, { connection: 'fixture', root: { schema: 'sales', name: table }, formId: `sales-${table}`, title: table, lookups: [] })
}

/** Each field's default, by key; a field that starts empty is left out. */
function defaultsOf(form: GeneratedForm): Record<string, unknown> {
  return Object.fromEntries(form.form.model.fields.flatMap((field) => (field.default === undefined ? [] : [[field.key, field.default]])))
}

/** The notes that say what a field starts with. */
function startNotes(form: GeneratedForm): Array<{ subject: string; message: string }> {
  return form.notes.filter((note) => note.message.startsWith('Starts')).map(({ subject, message }) => ({ subject, message }))
}

const ENGINES = [
  ['PostgreSQL', OWNER_SNAPSHOT],
  ['SQL Server', SQLSERVER_SNAPSHOT],
] as const

describe("a new record starts with its column's constant default (0149)", () => {
  // The order's status and the customer's active flag have a constant
  // default on both engines, each spelled as its catalog spells it; the
  // customer's created_at, the delivery's key and the shipment's have a
  // function, a sequence or an identity, which a person never sees as an
  // answer. Watched failing with the generator's defaults left out: no
  // field had one, and no note said so.
  test.each(ENGINES)('%s: the owner starts a new order at draft and a new customer with Active ticked, and says so', (_engine, snapshot) => {
    const order = generated(snapshot, 'order')
    const customer = generated(snapshot, 'customer')
    expect(defaultsOf(order)).toEqual({ status: 'draft' })
    expect(startNotes(order)).toEqual([{ subject: 'status', message: "Starts with the column's default, draft." }])
    expect(defaultsOf(customer)).toEqual({ active: true })
    expect(startNotes(customer)).toEqual([{ subject: 'active', message: "Starts with the column's default, true." }])
    for (const table of ['delivery', 'shipment']) {
      expect({ table, defaults: defaultsOf(generated(snapshot, table)), notes: startNotes(generated(snapshot, table)) }).toEqual({
        table,
        defaults: {},
        notes: [],
      })
    }
  })

  // The order form's own account may INSERT the status, so its form starts
  // there too; the getting-started guide's `ms` connection is this account
  // on SQL Server.
  test.each([
    ['PostgreSQL', WRITER_SNAPSHOT],
    ['SQL Server', SQLSERVER_WRITER_SNAPSHOT],
  ] as const)("%s: the order form's own account starts a new order at draft", (_engine, snapshot) => {
    expect(defaultsOf(generated(snapshot, 'order'))).toEqual({ status: 'draft' })
  })

  // PostgreSQL's reader sees the default and may not INSERT the status, so
  // a create never sends it: a default there would be a value the person
  // cannot give. SQL Server's reader sees that a default exists and not its
  // definition (0007), so there is nothing to read. Both start empty and
  // say nothing. Watched failing with every field given its default: the
  // PostgreSQL reader's status started at draft.
  test.each([
    ['PostgreSQL', READER_SNAPSHOT],
    ['SQL Server', SQLSERVER_READER_SNAPSHOT],
  ] as const)('%s: a reader that may not insert the status, or cannot see its default, starts it empty', (_engine, snapshot) => {
    const order = generated(snapshot, 'order')
    expect(order.bindings.fields.find((binding) => binding.field === 'status')?.writes.create).toBe(false)
    expect({ defaults: defaultsOf(order), notes: startNotes(order) }).toEqual({ defaults: {}, notes: [] })
  })
})
