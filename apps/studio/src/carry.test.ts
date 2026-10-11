// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. The draft carried from one
// proposal to the next, with proposals the real server generated.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createBuilderSession } from '@formancy/builder-core'
import type { FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Proposal, ProposalRequest } from './api.js'
import { asked, carryDraft, freshFields } from './carry.js'
import type { Carried } from './carry.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS, withColumn, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

let plane: TestPlane
let admin: AdminClient

beforeEach(async () => {
  plane = await startPlane()
  admin = createAdminClient({ token: TOKENS.admin, fetch: plane.fetch })
})

afterEach(async () => {
  await plane.close()
})

const ORDER: ProposalRequest = { connection: 'fixture', root: { schema: 'sales', name: 'order' }, formId: 'sales-order', title: 'Order', lookups: [], pinned: [], versionColumn: 'row_version' }

async function propose(request: ProposalRequest = ORDER): Promise<Proposal> {
  const outcome = await admin.propose(request)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value
}

/** `notes` renamed to `remarks`: the same column to a person, a new one to the catalog. */
function notesRenamed() {
  const notes = OWNER_SNAPSHOT.objects.find((object) => object.ref.name === 'order')?.columns.find((column) => column.name === 'notes')
  if (notes === undefined) throw new Error('the captured order has no notes')
  return withColumn(withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'), 'order', { ...notes, name: 'remarks' })
}

describe('carrying a draft to a new proposal', () => {
  // A field is new when what it stands for is: remarks is offered a label a
  // dropped notes left behind, and order_date -- the same column as before --
  // is not, or a label could be moved onto a field that already had its own.
  test('names as fresh only the fields whose column or lookup is new', async () => {
    const before = await propose()
    plane.databases.set('fixture', notesRenamed())
    const after = await propose()
    expect(freshFields(before.bindings, after.bindings)).toEqual(['remarks'])
    expect(freshFields(before.bindings, before.bindings)).toEqual([])
  })

  // The label set on a draft survives a new proposal; a label on a field the
  // new one does not have is reported, not silently dropped.
  test('keeps the draft’s labels and reports what it cannot carry', async () => {
    const before = await propose()
    const session = createBuilderSession(before.form)
    expect(session.setFieldProperty(['notes'], 'label', 'Delivery notes').ok).toBe(true)
    expect(session.setFieldProperty(['order_date'], 'label', 'Ordered on').ok).toBe(true)
    plane.databases.set('fixture', notesRenamed())
    const carried = carryDraft({ proposal: before, edited: session.exportDocument() }, await propose())
    if (!carried.ok) throw new Error(carried.message)
    expect(carried.form.model.fields.find((field) => field.key === 'order_date')?.label).toBe('Ordered on')
    expect(carried.conflicts.map((conflict) => [conflict.kind, 'field' in conflict ? conflict.field : null])).toEqual([['field-gone', 'notes']])
    expect(carried.fresh).toEqual(['remarks'])
  })

  // builder-core accepts a required flag, which is not presentation. A draft
  // holding one cannot be carried, and says why, in presentationOf's words:
  // carried anyway, the flag would be lost without a word, and dropping the
  // whole draft would lose the labels with it.
  test('refuses a draft that is not only presentation, saying why', async () => {
    const before = await propose()
    const session = createBuilderSession(before.form)
    expect(session.setFieldProperty(['notes'], 'required', true).ok).toBe(true)
    const carried = carryDraft({ proposal: before, edited: session.exportDocument() }, before)
    expect(carried.ok).toBe(false)
    expect(!carried.ok && carried.message).toMatch(/^the draft holds edits that are not presentation: \/model\/fields\/\d+\/required: /)
  })
})

describe('the keys a draft still asks about', () => {
  const ORDER_KEY = { field: 'order', was: { kind: 'lookup', foreignKey: 'fk_line_order' }, now: { kind: 'lookup', foreignKey: 'fk_line_quote' } } as const
  const removed: Carried = { from: 'version 1', version: 1, conflicts: [], fresh: [], undecided: [], kept: [], removed: [ORDER_KEY] }
  const policy = (through: string[]): FormPolicy => ({ version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: {}, rowFilters: [], lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through })

  // A removed key is asked about again once the policy grants on it again,
  // by the server's test (0039). A through is such a grant (0043): ticked
  // again over a key that now names another foreign key, it scopes the rows
  // through another parent, with no role on the field. Not asked, the
  // publish would be refused with the server's sentences and no Keep to
  // answer them with (watched failing: a through counted as nothing).
  test('asks again about a removed key that a through names again, with no role on its field', () => {
    expect(asked(removed, policy([]))).toEqual([])
    expect(asked(removed, policy(['order']))).toEqual([ORDER_KEY])
  })
})
