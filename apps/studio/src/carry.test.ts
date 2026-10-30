// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. The draft carried from one
// proposal to the next, with proposals the real server generated.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createBuilderSession } from '@formancy/builder-core'
import type { FormBindings, FormPolicy, ListView, PresentationConflict } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Proposal, ProposalRequest } from './api.js'
import { asked, carriedAgain, carryDraft, freshFields } from './carry.js'
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

const ORDER: ProposalRequest = {
  connection: 'fixture',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'row_version',
}

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
    const carried = carryDraft({ proposal: before, edited: session.exportDocument(), views: [] }, await propose())
    if (!carried.ok) throw new Error(carried.message)
    expect(carried.form.model.fields.find((field) => field.key === 'order_date')?.label).toBe('Ordered on')
    expect(carried.conflicts.map((conflict) => [conflict.kind, 'field' in conflict ? conflict.field : null])).toEqual([['field-gone', 'notes']])
    expect(carried.fresh).toEqual(['remarks'])
  })

  // A draft's list views (0105) go through the same rebase as its labels:
  // carried to a proposal of the same database unchanged, and the one
  // naming a column the new proposal does not have dropped whole and said,
  // its default with it. Watched failing with the views left out of the
  // carry: "Generate again" came back with none, and said nothing.
  test('carries the draft’s list views, and drops and reports one whose column is gone', async () => {
    const before = await propose()
    const edited = createBuilderSession(before.form).exportDocument()
    const noted: ListView = { name: 'Noted', filter: [{ field: 'notes', op: 'not-null' }], sort: [], default: true }
    const placed: ListView = {
      name: 'Placed',
      filter: [{ field: 'status', op: 'equals', value: 'placed' }],
      sort: [{ field: 'order_date', direction: 'desc' }],
    }
    const same = carryDraft({ proposal: before, edited, views: [noted, placed] }, await propose())
    expect(same.ok && same.views).toEqual([noted, placed])
    expect(same.ok && same.conflicts).toEqual([])
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const carried = carryDraft({ proposal: before, edited, views: [noted, placed] }, await propose())
    if (!carried.ok) throw new Error(carried.message)
    expect(carried.views).toEqual([placed])
    expect(carried.conflicts).toEqual([
      {
        kind: 'view-dropped',
        view: 'Noted',
        resolution: 'dropped',
        message: 'View “Noted” names notes, which is not in the regenerated form, so it was dropped.',
      },
    ])
  })

  // builder-core accepts a required flag, which is not presentation. A draft
  // holding one cannot be carried, and says why, in presentationOf's words:
  // carried anyway, the flag would be lost without a word, and dropping the
  // whole draft would lose the labels with it.
  test('refuses a draft that is not only presentation, saying why', async () => {
    const before = await propose()
    const session = createBuilderSession(before.form)
    expect(session.setFieldProperty(['notes'], 'required', true).ok).toBe(true)
    const carried = carryDraft({ proposal: before, edited: session.exportDocument(), views: [] }, before)
    expect(carried.ok).toBe(false)
    expect(!carried.ok && carried.message).toMatch(/^the draft holds edits that are not presentation: \/model\/fields\/\d+\/required: /)
  })
})

describe('the keys a draft still asks about', () => {
  const ORDER_KEY = { field: 'order', was: { kind: 'lookup', foreignKey: 'fk_line_order' }, now: { kind: 'lookup', foreignKey: 'fk_line_quote' } } as const
  const removed: Carried = { from: 'version 1', version: 1, conflicts: [], fresh: [], undecided: [], kept: [], removed: [ORDER_KEY] }
  const policy = (through: string[]): FormPolicy => ({
    version: 1,
    operations: { read: ['clerk'], create: [], update: [] },
    fields: {},
    rowFilters: [],
    lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] },
    through,
  })

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

describe('what "Generate again" keeps', () => {
  const NO_FIELDS = { fields: [] } as unknown as FormBindings
  const moveDropped: PresentationConflict = {
    kind: 'move-dropped',
    field: 'customer',
    anchor: { kind: 'lookup', foreignKey: 'fk_order_customer' },
    section: { label: 'Record', occurrence: 0 },
    to: { label: 'Order', occurrence: 0 },
    resolution: 'dropped',
    message: 'The move of customer to section "Record" was dropped.',
  }
  const sectionGone: PresentationConflict = {
    kind: 'field-gone',
    field: 'notes',
    anchor: { kind: 'column', column: 'notes' },
    property: 'section',
    yours: { label: 'Record', occurrence: 0 },
    resolution: 'dropped',
    message: 'The section "Record" you chose for notes was dropped.',
  }
  const followed: PresentationConflict = {
    kind: 'field-rekeyed',
    field: 'client',
    from: 'customer',
    anchor: { kind: 'lookup', foreignKey: 'fk_order_customer' },
    resolution: 'followed',
    message: 'customer is now client.',
  }

  // What a regeneration dropped is no longer in the draft for the next
  // rebase to report, so "Generate again" keeps every conflict that dropped
  // something -- a move whose section went (0075) as much as a label -- and
  // the rebase reports again what it still follows. Watched failing with the
  // list of kinds kept before 0075, which forgot the dropped move.
  test('keeps every conflict that dropped something, a dropped move and a moved field gone included', () => {
    const earlier: Carried = { from: 'version 1', version: 1, conflicts: [moveDropped, sectionGone, followed], fresh: [], undecided: [], kept: [], removed: [] }
    expect(carriedAgain(earlier, NO_FIELDS, { conflicts: [], fresh: [] }, NO_FIELDS).conflicts).toEqual([moveDropped, sectionGone])
  })

  // A list view a regeneration dropped (0105) is no longer in the draft
  // for the next rebase to report either: kept with the rest of what was
  // dropped, or the carried panel would say everything was carried after
  // "Generate again" while the view was gone. Watched failing with the
  // conflicts kept by a list of kinds that left view-dropped out.
  test('keeps a dropped list view reported', () => {
    const viewDropped: PresentationConflict = {
      kind: 'view-dropped',
      view: 'Noted',
      resolution: 'dropped',
      message: 'View “Noted” names notes, which is not in the regenerated form, so it was dropped.',
    }
    const earlier: Carried = { from: 'version 1', version: 1, conflicts: [viewDropped], fresh: [], undecided: [], kept: [], removed: [] }
    expect(carriedAgain(earlier, NO_FIELDS, { conflicts: [], fresh: [] }, NO_FIELDS).conflicts).toEqual([viewDropped])
  })
})
