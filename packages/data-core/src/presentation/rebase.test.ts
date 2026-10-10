import type { FormSchema, LayoutNode } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import { addColumn, col, column, dropColumn, foreignKey, INT32, object, ORDER, retype, snapshot, table, text } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import type { GenerationRequest } from '../generate/types.js'
import type { ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { presentationOf } from './derive.js'
import { describeReassigned, grantsOnKey, reassignedKeys, rebasePresentation } from './rebase.js'
import { EMPTY_PRESENTATION } from './types.js'

/*
 * rebasePresentation carries what a person chose over one generated base to
 * the next, by what each field stands for (0030). Every case publishes the
 * way the studio does — generate, edit the form, derive the presentation —
 * and regenerates from a changed fixture snapshot with the same request, so
 * the bases are the generator's own and never a literal.
 *
 * The order base's sections: "Order" (customer, order_date, status, amount,
 * notes [all], created_by, paid) and "Record" (id).
 */

type Child = { kind: 'field'; path: string; span?: 'all' }
const copy = (form: FormSchema): FormSchema => JSON.parse(JSON.stringify(form)) as FormSchema
const sections = (form: FormSchema) => (form.layouts?.[0]?.nodes ?? []) as Array<{ kind: 'section'; label: string; children: LayoutNode[] }>
const grid = (form: FormSchema, at: number) => (sections(form)[at]?.children[0] as { children: Child[] }).children
const keys = (form: FormSchema, at: number) => grid(form, at).map((entry) => entry.path)
const labelOf = (form: FormSchema, key: string) => form.model.fields.find((entry) => entry.key === key)?.label

const relabel = (key: string, label: string) => (form: FormSchema) => {
  const found = form.model.fields.find((entry) => entry.key === key)
  if (found !== undefined) found.label = label
}
const move = (at: number, key: string, to: number) => (form: FormSchema) => {
  const children = grid(form, at)
  const [moved] = children.splice(children.findIndex((entry) => entry.path === key), 1)
  children.splice(to, 0, moved as Child)
}
const both = (...edits: Array<(form: FormSchema) => void>) => (form: FormSchema) => {
  for (const edit of edits) edit(form)
}

/** Generate, edit and derive, as the studio publishes. */
function publish(edit: (form: FormSchema) => void, before: (objects: ObjectMeta[]) => void = () => {}, request: GenerationRequest = ORDER) {
  const { form, bindings } = generateForm(snapshot(before), request)
  const edited = copy(form)
  edit(edited)
  const derived = presentationOf(form, edited, bindings)
  if (!derived.ok) throw new Error(derived.problems.join('; '))
  return { base: form, presentation: derived.presentation, bindings, edited }
}

/** Regenerate from a changed snapshot and carry the presentation; every merged form must be one formancy accepts. */
function regenerate(published: ReturnType<typeof publish>, after: (objects: ObjectMeta[]) => void = () => {}, request: GenerationRequest = ORDER) {
  const next = generateForm(snapshot(after), request)
  const rebased = rebasePresentation(published, { base: next.form, bindings: next.bindings })
  const valid = validateSchema(rebased.form)
  expect(valid.valid, JSON.stringify(valid.valid ? [] : valid.errors)).toBe(true)
  return { ...rebased, next }
}

const reference = (objects: ObjectMeta[]) => addColumn(objects, 'order', col('reference', 'nvarchar(40)', text(40), { nullable: true }))
/** A second column whose key collides with order_date's, so the generator numbers it order_date_2. */
const orderDate2 = (objects: ObjectMeta[]) => addColumn(objects, 'order', col('order date', 'date', { kind: 'date' }, { nullable: true }))

describe('rebasePresentation', () => {
  // The fast path every regeneration of an unchanged database takes: all
  // four edits come through untouched and nobody is told about anything.
  test('identical bases carry everything, with no conflict', () => {
    const published = publish(both(relabel('notes', 'Delivery notes'), (form) => { (sections(form)[0] as { label: string }).label = 'Order details' }, move(0, 'notes', 3), (form) => { (grid(form, 0)[2] as Child).span = 'all' }))
    const rebased = regenerate(published)
    expect(rebased.conflicts).toEqual([])
    expect(rebased.presentation).toEqual(published.presentation)
    expect(canonicalize(rebased.form)).toBe(canonicalize(published.edited))
  })

  // A compatible change adds a column. It goes where the generator would
  // put it relative to its neighbours, here after `paid`, which the person
  // moved first — not appended, and not where an index said.
  test('a new nullable column lands after its generated predecessor, and the rest of the order is kept', () => {
    const published = publish(move(0, 'paid', 0))
    const rebased = regenerate(published, reference)
    expect(keys(rebased.next.form, 0)).toEqual(['customer', 'order_date', 'status', 'amount', 'notes', 'created_by', 'paid', 'reference'])
    expect(keys(rebased.form, 0)).toEqual(['paid', 'reference', 'customer', 'order_date', 'status', 'amount', 'notes', 'created_by'])
    expect(rebased.conflicts).toEqual([])
  })

  // A dropped column takes its label with it, and the person is told which
  // label was lost and for which column. The same column in an order only
  // is not reported: drift reports the drop, and the other fields keep
  // their order (reconciliation item 4) — a conflict per dropped key of a
  // reordered section would bury the one that matters.
  test('a dropped column with a label is field-gone; one only in an order is not a conflict', () => {
    const labelled = publish(relabel('paid', 'Settled'))
    const gone = regenerate(labelled, (objects) => dropColumn(objects, 'order', 'paid'))
    expect(gone.conflicts).toEqual([
      { kind: 'field-gone', field: 'paid', anchor: { kind: 'column', column: 'paid' }, property: 'label', yours: 'Settled', resolution: 'dropped', message: expect.stringContaining('paid') },
    ])
    expect(gone.presentation).toEqual(EMPTY_PRESENTATION)

    const ordered = publish(both(move(0, 'paid', 0), move(0, 'notes', 4)))
    const dropped = regenerate(ordered, (objects) => dropColumn(objects, 'order', 'paid'))
    expect(dropped.conflicts).toEqual([])
    expect(keys(dropped.form, 0)).toEqual(['customer', 'order_date', 'status', 'notes', 'amount', 'created_by'])
  })

  // Watched failing with key-only anchors. Two columns sanitise to
  // order_date; dropping the first renumbers the second's key from
  // order_date_2 to order_date. Carried by key, the label chosen for the
  // dropped column would land on the other one, and the label chosen for
  // the other would be lost.
  test('a dropped colliding column renumbers a key: the label follows the column, and is not given to the key\'s new holder', () => {
    const published = publish(both(relabel('order_date', 'Ordered on'), relabel('order_date_2', 'Ship date')), orderDate2)
    const after = (objects: ObjectMeta[]) => {
      orderDate2(objects)
      dropColumn(objects, 'order', 'order_date')
    }
    const rebased = regenerate(published, after)
    expect(rebased.conflicts).toEqual([
      expect.objectContaining({ kind: 'field-gone', field: 'order_date', property: 'label', yours: 'Ordered on' }),
      { kind: 'field-rekeyed', field: 'order_date', from: 'order_date_2', anchor: { kind: 'column', column: 'order date' }, resolution: 'followed', message: expect.stringContaining('order_date_2') },
    ])
    expect(labelOf(rebased.form, 'order_date')).toBe('Ship date')
    expect(rebased.presentation.fields).toEqual([{ field: 'order_date', anchor: { kind: 'column', column: 'order date' }, label: 'Ship date' }])
    // And grants written for order_date now name another column.
    expect(reassignedKeys(published.bindings, rebased.next.bindings)).toEqual([{ field: 'order_date', was: { kind: 'column', column: 'order_date' }, now: { kind: 'column', column: 'order date' } }])
  })

  // The same foreign key now references another table: the key and the
  // generated label follow the table's name. The person's label is kept,
  // because they chose it, and they are told the generator also changed it.
  test('a lookup re-pointed to another table is field-rekeyed and both-changed, keeping yours', () => {
    const published = publish(relabel('customer', 'Buyer'))
    const rebased = regenerate(published, (objects) => {
      objects.push({ ...(JSON.parse(JSON.stringify(object(objects, 'customer'))) as ObjectMeta), ref: { schema: 'crm', name: 'client' } })
      foreignKey(objects, 'fk_order_customer').references = { table: { schema: 'crm', name: 'client' }, columns: ['tenant_id', 'customer_no'] }
    })
    expect(rebased.conflicts).toEqual([
      expect.objectContaining({ kind: 'field-rekeyed', field: 'client', from: 'customer', anchor: { kind: 'lookup', foreignKey: 'fk_order_customer' } }),
      expect.objectContaining({ kind: 'both-changed', field: 'client', property: 'label', yours: 'Buyer', generator: 'Client', resolution: 'kept-yours' }),
    ])
    expect(labelOf(rebased.form, 'client')).toBe('Buyer')
  })

  // A label equal to what the generator now writes is no longer an
  // override, and is dropped without a word: there is nothing to decide.
  test('an override the generator now agrees with is dropped silently', () => {
    const published = publish(relabel('customer', 'Client'))
    const rebased = regenerate(published, (objects) => {
      objects.push({ ...(JSON.parse(JSON.stringify(object(objects, 'customer'))) as ObjectMeta), ref: { schema: 'crm', name: 'client' } })
      foreignKey(objects, 'fk_order_customer').references = { table: { schema: 'crm', name: 'client' }, columns: ['tenant_id', 'customer_no'] }
    })
    expect(rebased.conflicts.map((conflict) => conflict.kind)).toEqual(['field-rekeyed'])
    expect(rebased.presentation.fields).toEqual([])
  })

  // A column the database now computes is a system field, and the
  // generator puts it in Record. The person's order of Order cannot hold
  // it, and they are told it went where the generator put it.
  test('a column that became generated is moved-section when the main section had an order', () => {
    const published = publish(move(0, 'notes', 3))
    const rebased = regenerate(published, (objects) => {
      column(objects, 'order', 'created_by').generated = 'computed'
    })
    expect(rebased.conflicts).toEqual([
      { kind: 'moved-section', field: 'created_by', from: { label: 'Order', occurrence: 0 }, to: { label: 'Record', occurrence: 0 }, resolution: 'followed', message: expect.stringContaining('Record') },
    ])
    expect(keys(rebased.form, 0)).toEqual(['customer', 'order_date', 'status', 'notes', 'amount', 'paid'])
    expect(keys(rebased.form, 1)).toEqual(['id', 'created_by'])
  })

  // Record exists because a generated column does. When the last one goes,
  // so does the section, and the label chosen for it is reported dropped
  // rather than given to some other section.
  test('the last generated column dropped is section-gone for Record', () => {
    const published = publish((form) => { (sections(form)[1] as { label: string }).label = 'Bookkeeping' })
    const rebased = regenerate(published, (objects) => {
      dropColumn(objects, 'order', 'id')
      object(objects, 'order').primaryKey = null
    })
    expect(rebased.conflicts).toEqual([
      { kind: 'section-gone', section: { label: 'Record', occurrence: 0 }, property: 'label', yours: 'Bookkeeping', resolution: 'dropped', message: expect.stringContaining('Record') },
    ])
    expect(sections(rebased.form).map((entry) => entry.label)).toEqual(['Order'])
  })

  // A root called `record` has two sections labelled Record: its own and
  // the system one. Anchored by label alone, the two would be one, and a
  // label chosen for either would land on both or on the wrong one.
  test('a root named record keeps its two sections apart by occurrence', () => {
    const request: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'record' }, formId: 'sales-record', title: 'Record', lookups: [] }
    const records = (objects: ObjectMeta[]) => {
      objects.push(table('record', [col('id', 'int', INT32, { generated: 'identity-always' }), col('name', 'nvarchar(50)', text(50))], { primaryKey: { name: 'pk_record', columns: ['id'] } }))
    }
    const published = publish((form) => { (sections(form)[1] as { label: string }).label = 'Bookkeeping' }, records, request)
    expect(sections(published.base).map((entry) => entry.label)).toEqual(['Record', 'Record'])
    expect(published.presentation.sections).toEqual([{ anchor: { label: 'Record', occurrence: 1 }, label: 'Bookkeeping' }])
    const rebased = regenerate(published, (objects) => {
      records(objects)
      addColumn(objects, 'record', col('code', 'int', INT32, { nullable: true }))
    }, request)
    expect(sections(rebased.form).map((entry) => entry.label)).toEqual(['Record', 'Bookkeeping'])
    expect(rebased.conflicts).toEqual([])
  })

  // Occurrence tells a record root's two sections apart only while both are
  // there. When one of them comes or goes, the occurrences shift: matched by
  // them, the main section's label lands on the system section, and the
  // conflict names a section that is still there while the order the person
  // chose goes unreported. Nothing in the form or the bindings says which
  // section a lone "Record" is, so neither override may be carried, and both
  // are said.
  test('a record root whose sections change in number carries neither section, and says so', () => {
    const request: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'record' }, formId: 'sales-record', title: 'Record', lookups: [] }
    const records = (readable: boolean) => (objects: ObjectMeta[]) => {
      objects.push(table('record', [
        col('id', 'int', INT32, { generated: 'identity-always' }),
        col('stamp', 'int', INT32, { generated: 'computed' }),
        col('name', 'nvarchar(50)', text(50), { access: { select: readable, insert: readable, update: readable } }),
        col('note', 'nvarchar(50)', text(50), { nullable: true, access: { select: readable, insert: readable, update: readable } }),
      ], { primaryKey: { name: 'pk_record', columns: ['id'] } }))
    }

    // The main section goes: its label and order must not reach the system section.
    const twice = publish(both(
      (form) => { (sections(form)[0] as { label: string }).label = 'Details' },
      (form) => { (sections(form)[1] as { label: string }).label = 'System' },
      move(0, 'note', 0),
    ), records(true), request)
    expect(sections(twice.base).map((entry) => entry.label)).toEqual(['Record', 'Record'])
    const vanished = regenerate(twice, records(false), request)
    expect(sections(vanished.form).map((entry) => entry.label)).toEqual(['Record'])
    expect(vanished.presentation).toEqual(EMPTY_PRESENTATION)
    expect(vanished.conflicts).toEqual([
      { kind: 'section-gone', section: { label: 'Record', occurrence: 0 }, property: 'label', yours: 'Details', resolution: 'dropped', message: expect.stringContaining('cannot be told apart') },
      { kind: 'section-gone', section: { label: 'Record', occurrence: 0 }, property: 'order', yours: ['note', 'name'], resolution: 'dropped', message: expect.stringContaining('cannot be told apart') },
      { kind: 'section-gone', section: { label: 'Record', occurrence: 1 }, property: 'label', yours: 'System', resolution: 'dropped', message: expect.stringContaining('cannot be told apart') },
    ])

    // The main section appears: the system section's label and order must
    // not reach it, and no field is said to have moved, because none did.
    const once = publish(both((form) => { (sections(form)[0] as { label: string }).label = 'Identity' }, move(0, 'stamp', 0)), records(false), request)
    expect(sections(once.base).map((entry) => entry.label)).toEqual(['Record'])
    const appeared = regenerate(once, records(true), request)
    expect(sections(appeared.form).map((entry) => entry.label)).toEqual(['Record', 'Record'])
    expect(appeared.presentation).toEqual(EMPTY_PRESENTATION)
    expect(appeared.conflicts).toEqual([
      expect.objectContaining({ kind: 'section-gone', section: { label: 'Record', occurrence: 0 }, property: 'label', yours: 'Identity' }),
      expect.objectContaining({ kind: 'section-gone', section: { label: 'Record', occurrence: 0 }, property: 'order', yours: ['stamp', 'id'] }),
    ])
  })

  // A field that joins an ordered section ahead of every field the person
  // placed has no predecessor to follow, and goes first, where the
  // generator put it; an order that comes out equal to the new base's is no
  // longer an override.
  test('a field new to an ordered section with no generated predecessor goes first', () => {
    const published = publish(move(0, 'notes', 3))
    const rebased = regenerate(published, (objects) => {
      column(objects, 'order', 'id').generated = 'none'
    })
    expect(keys(rebased.form, 0)).toEqual(['id', 'customer', 'order_date', 'status', 'notes', 'amount', 'created_by', 'paid'])
    expect(sections(rebased.form)).toHaveLength(1)

    const paidFirst = publish(move(0, 'paid', 0))
    const equal = regenerate(paidFirst, (objects) => dropColumn(objects, 'order', 'paid'))
    expect(equal.presentation).toEqual(EMPTY_PRESENTATION)
    expect(equal.conflicts).toEqual([])
  })

  // A span is a label's sibling: gone with its column and said, or no
  // longer an override once the generator spans the field itself.
  test("a span goes with its column, and one the generator now agrees with is dropped silently", () => {
    const narrowed = publish((form) => { delete (grid(form, 0).find((entry) => entry.path === 'notes') as Child).span })
    const gone = regenerate(narrowed, (objects) => dropColumn(objects, 'order', 'notes'))
    expect(gone.conflicts).toEqual([expect.objectContaining({ kind: 'field-gone', field: 'notes', property: 'span', yours: 'one', message: expect.stringContaining("'one'") })])

    const widened = publish((form) => { (grid(form, 0).find((entry) => entry.path === 'status') as Child).span = 'all' })
    const agreed = regenerate(widened, (objects) => retype(objects, 'order', 'status', 'nvarchar(max)', text(null)))
    expect(agreed.conflicts).toEqual([])
    expect(agreed.presentation).toEqual(EMPTY_PRESENTATION)
    expect(grid(agreed.form, 0).find((entry) => entry.path === 'status')?.span).toBe('all')
  })

  // An order chosen for Record is dropped with Record, and the field that
  // left it for the main section is said to have moved, because its old
  // section's order named it.
  test('an order on a section that is gone is section-gone, and its field moved-section', () => {
    const computed = (objects: ObjectMeta[]) => {
      column(objects, 'order', 'created_by').generated = 'computed'
    }
    const published = publish(move(1, 'created_by', 0), computed)
    expect(published.presentation.sections).toEqual([{ anchor: { label: 'Record', occurrence: 0 }, order: ['created_by', 'id'] }])
    const rebased = regenerate(published, (objects) => {
      dropColumn(objects, 'order', 'id')
      object(objects, 'order').primaryKey = null
    })
    expect(rebased.conflicts).toEqual([
      expect.objectContaining({ kind: 'moved-section', field: 'created_by', from: { label: 'Record', occurrence: 0 }, to: { label: 'Order', occurrence: 0 } }),
      expect.objectContaining({ kind: 'section-gone', section: { label: 'Record', occurrence: 0 }, property: 'order', yours: ['created_by', 'id'] }),
    ])
  })

  // A person reviews the result, and a regeneration of an unchanged input
  // must not show a different one: no clock, no map iteration order leaking.
  test('two runs are byte-identical', () => {
    const published = publish(both(relabel('order_date', 'Ordered on'), relabel('order_date_2', 'Ship date'), move(0, 'paid', 0)), orderDate2)
    const after = (objects: ObjectMeta[]) => {
      orderDate2(objects)
      dropColumn(objects, 'order', 'order_date')
      reference(objects)
    }
    const once = regenerate(published, after)
    const twice = regenerate(published, after)
    expect(JSON.stringify({ ...twice, next: undefined })).toBe(JSON.stringify({ ...once, next: undefined }))
  })

  // A presentation that does not apply to its own base was never derived
  // from it; carrying it anyway would guess at what it meant.
  test('refuses to carry a presentation that does not apply to its own base', () => {
    const published = publish(() => {})
    const next = generateForm(snapshot(), ORDER)
    const broken = { ...published, presentation: { ...EMPTY_PRESENTATION, fields: [{ field: 'ghost', anchor: { kind: 'column' as const, column: 'ghost' }, label: 'x' }] } }
    expect(() => rebasePresentation(broken, { base: next.form, bindings: next.bindings })).toThrow(/the published presentation does not apply to its base: \/fields\/0\/field/)
  })
})

describe('reassignedKeys', () => {
  // Nothing renumbered, nothing to confirm: a list that always held every
  // key would teach the administrator to confirm without reading.
  test('is empty when every key still names what it named', () => {
    const before = generateForm(snapshot(), ORDER).bindings
    expect(reassignedKeys(before, generateForm(snapshot(reference), ORDER).bindings)).toEqual([])
  })
})

describe('grantsOnKey', () => {
  const policy = (fields: FormPolicy['fields'], lookups: FormPolicy['lookups'] = {}): FormPolicy => ({ version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields, rowFilters: [], lookups })

  // A role, read or write, is a grant. A lookup's filter is not one by
  // itself: every lookup field has one, so counting it left no way to
  // remove a lookup key's grants, and nobody without a role on the field
  // may search its options. An entry with no roles grants nothing.
  test('is a read or write role on the key’s field, and nothing else', () => {
    expect(grantsOnKey(policy({ customer: { read: ['clerk'], write: [] } }), 'customer')).toBe(true)
    expect(grantsOnKey(policy({ customer: { read: [], write: ['clerk'] } }), 'customer')).toBe(true)
    expect(grantsOnKey(policy({}, { customer: [] }), 'customer')).toBe(false)
    expect(grantsOnKey(policy({ customer: { read: [], write: [] } }, { customer: [{ column: 'tenant_id', attribute: 'tenant' }] }), 'customer')).toBe(false)
    // A key is a field's, not a property every object has.
    expect(grantsOnKey(policy({}), 'constructor')).toBe(false)
  })
})

describe('describeReassigned', () => {
  // The server's refusal and the studio's lists say a reassigned key in this
  // one sentence, so they cannot say it differently; a lookup is said as a
  // lookup, not as a column called undefined.
  test('names what the grants were written for and what the key stands for now, column or lookup', () => {
    expect(describeReassigned({ field: 'order_date', was: { kind: 'column', column: 'order_date' }, now: { kind: 'column', column: 'order date' } })).toBe(
      'Grants for order_date were written for column order_date; it now stands for column order date.',
    )
    expect(describeReassigned({ field: 'customer', was: { kind: 'column', column: 'customer' }, now: { kind: 'lookup', foreignKey: 'fk_order_customer' } })).toBe(
      'Grants for customer were written for column customer; it now stands for the lookup over fk_order_customer.',
    )
  })
})
