import type { FormSchema, LayoutNode } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import { applyPresentation } from './apply.js'
import { presentationOf } from './derive.js'
import { EMPTY_PRESENTATION } from './types.js'

/*
 * presentationOf turns an edited form into the patch 0030 stores, and refuses
 * every difference that is not one of the studio's four edits. The base is
 * real generateForm output over the drift fixture's order table: sections
 * "Order" (customer, order_date, status, amount, notes [all], created_by,
 * paid) and "Record" (id). Edits are made by JSON, as the studio's
 * builder-core session makes them (probed on 0.3.0, PD2).
 */

const generated = generateForm(snapshot(), ORDER)
const base = generated.form
const bindings = generated.bindings

const copy = (form: FormSchema): FormSchema => JSON.parse(JSON.stringify(form)) as FormSchema
type Child = { kind: 'field'; path: string; span?: number | 'all' }
type Grid = { kind: 'table'; columns: number; children: Child[] }
const section = (form: FormSchema, at: number) => form.layouts?.[0]?.nodes[at] as { kind: 'section'; label: string; children: LayoutNode[] }
const grid = (form: FormSchema, at: number) => section(form, at).children[0] as Grid
const node = (form: FormSchema, path: string) => (grid(form, 0).children.find((entry) => entry.path === path) ?? grid(form, 1).children.find((entry) => entry.path === path)) as Child
const field = (form: FormSchema, key: string) => form.model.fields.find((entry) => entry.key === key) as unknown as Record<string, unknown>
const index = (key: string) => String(base.model.fields.findIndex((entry) => entry.key === key))

function problems(edited: FormSchema): string[] {
  const outcome = presentationOf(base, edited, bindings)
  expect(outcome.ok, 'the edit should have been refused').toBe(false)
  return outcome.ok ? [] : outcome.problems
}

describe('presentationOf', () => {
  // The baseline: nothing edited is nothing stored. A derive that recorded
  // the whole document would store a copy of the base and carry the
  // generator's own choices as if a person had made them.
  test('an unedited form derives the empty presentation', () => {
    expect(base.layouts?.[0]?.nodes.map((entry) => (entry as { label: string }).label)).toEqual(['Order', 'Record'])
    expect(presentationOf(base, copy(base), bindings)).toEqual({ ok: true, presentation: EMPTY_PRESENTATION })
  })

  // An edit and its reversal leave nothing behind (PD2: builder-core's
  // reversals are canonically equal to the base). A derive that remembered
  // "edited once" would carry an override equal to the base forever.
  test('an edit undone derives the empty presentation', () => {
    const edited = copy(base)
    field(edited, 'notes')['label'] = 'Delivery notes'
    field(edited, 'notes')['label'] = 'Notes'
    const children = grid(edited, 0).children
    children.reverse()
    children.reverse()
    expect(presentationOf(base, edited, bindings)).toEqual({ ok: true, presentation: EMPTY_PRESENTATION })
  })

  // Each of the four edits derives exactly its own entry, anchored by what
  // the field stands for — the lookup by its foreign key, a column by its
  // name — and nothing else. `span: 'one'` is the removal of a generated
  // full width, which is an edit too.
  test('each of the four edits derives exactly its entry, and applying it gives the edited form back', () => {
    const edited = copy(base)
    field(edited, 'customer')['label'] = 'Buyer'
    section(edited, 0).label = 'Order details'
    const children = grid(edited, 0).children
    const [notes] = children.splice(4, 1)
    children.splice(3, 0, notes as Child)
    node(edited, 'status').span = 'all'
    delete node(edited, 'notes').span
    const outcome = presentationOf(base, edited, bindings)
    expect(outcome).toEqual({
      ok: true,
      presentation: {
        version: 1,
        fields: [
          { field: 'customer', anchor: { kind: 'lookup', foreignKey: 'fk_order_customer' }, label: 'Buyer' },
          { field: 'status', anchor: { kind: 'column', column: 'status' }, span: 'all' },
          { field: 'notes', anchor: { kind: 'column', column: 'notes' }, span: 'one' },
        ],
        sections: [{ anchor: { label: 'Order', occurrence: 0 }, label: 'Order details', order: ['customer', 'order_date', 'status', 'notes', 'amount', 'created_by', 'paid'] }],
      },
    })
    // Derive then apply is the edited form: the patch loses nothing.
    if (!outcome.ok) return
    const applied = applyPresentation(base, outcome.presentation, bindings)
    expect(applied.ok && canonicalize(applied.form)).toBe(canonicalize(edited))
  })

  // A removed field and a changed key are model changes, a data migration
  // and not presentation; carried as a patch they would publish a form whose
  // bindings name a field it no longer has.
  test('refuses a removed field and a changed key, naming where', () => {
    const removed = copy(base)
    removed.model.fields.splice(Number(index('paid')), 1)
    expect(problems(removed)).toContainEqual('/model/fields: paid was removed')
    const rekeyed = copy(base)
    field(rekeyed, 'paid')['key'] = 'settled'
    expect(problems(rekeyed)).toEqual(['/model/fields: paid was removed', `/model/fields/${index('paid')}: settled is not a field of the base`])
  })

  // Watched failing against a naive derive that kept the whole difference
  // as presentation: `required`, a pattern, a length and an options source
  // are what the database will accept, and the generator decides them from
  // the column. A person who relaxed one would publish a form the database
  // refuses, and a regeneration would carry the edit over a changed column.
  test('refuses a changed required, pattern, maxLength or optionsSource, naming each path', () => {
    const edited = copy(base)
    field(edited, 'order_date')['required'] = false
    field(edited, 'status')['pattern'] = '^[a-z]+$'
    field(edited, 'status')['maxLength'] = 4000
    field(edited, 'customer')['optionsSource'] = 'elsewhere'
    expect(problems(edited)).toEqual([
      `/model/fields/${index('customer')}/optionsSource: changed, and only a field's label is presentation`,
      `/model/fields/${index('order_date')}/required: changed, and only a field's label is presentation`,
      `/model/fields/${index('status')}/maxLength: changed, and only a field's label is presentation`,
      `/model/fields/${index('status')}/pattern: changed, and only a field's label is presentation`,
    ])
  })

  // builder-core accepts each of these (PD2), and none is one of the four
  // edits: a field moved into the Record section would be placed by the
  // person, not by what the database generates; a new section has no
  // anchor; `span: 2` is not "full width" and would be lost in a wider grid.
  test('refuses a move between sections, a new section and a numeric span', () => {
    const moved = copy(base)
    const paid = grid(moved, 0).children.pop()
    grid(moved, 1).children.push(paid as Child)
    expect(problems(moved)).toEqual([
      '/layouts/0/nodes/0/children/0/children: paid is missing',
      '/layouts/0/nodes/1/children/0/children/1/path: paid moved between sections',
    ])

    const added = copy(base)
    added.layouts?.[0]?.nodes.push({ kind: 'section', label: 'More', children: [] })
    expect(problems(added)).toEqual(['/layouts/0/nodes: a section was added or removed'])

    const numeric = copy(base)
    node(numeric, 'status').span = 2
    expect(problems(numeric)).toEqual(["/layouts/0/nodes/0/children/0/children/2/span: a numeric span is not one of the four edits; full width is 'all'"])
  })

  // The title, the logic and the translations are the document's, not its
  // presentation's: a changed title would be lost on the next regeneration
  // without anyone being told, and an edited rule could make a field
  // writable that the database refuses.
  test('refuses a changed title, logic or i18n', () => {
    const edited = copy(base)
    edited.title = 'Their order'
    edited.logic = { rules: [] }
    edited.i18n = { defaultLocale: 'en', messages: { en: {} } }
    expect(problems(edited)).toEqual([
      '/title: changed, and only labels, order and full width are presentation',
      '/logic: changed, and only labels, order and full width are presentation',
      '/i18n: changed, and only labels, order and full width are presentation',
    ])
  })

  // A base this release did not generate has no anchors to read, and a
  // derive that guessed would anchor sections by labels nobody generated.
  test('refuses a base of another shape', () => {
    const odd = copy(base)
    section(odd, 0).children.push({ kind: 'field', path: 'paid' })
    expect(presentationOf(odd, copy(odd), bindings)).toEqual({ ok: false, problems: ['a base this release did not generate (/layouts/0/nodes/0/children)'] })

    // Each other way a document can differ from what layoutFor writes, by the path it is refused at.
    const bases: Array<[string, (form: FormSchema) => void]> = [
      ['/layouts', (form) => form.layouts?.push({ name: 'print', nodes: [] })],
      ['/layouts/0', (form) => { (form.layouts?.[0] as { name: string }).name = 'web' }],
      ['/layouts/0/nodes/1', (form) => { (section(form, 1) as { kind: string }).kind = 'row' }],
      ['/layouts/0/nodes/0/children/0', (form) => { grid(form, 0).columns = 3 }],
      ['/layouts/0/nodes/0/children/0/children/2', (form) => { node(form, 'status').span = 2 }],
      ['/layouts/0/nodes/1/children/0/children/1', (form) => { grid(form, 1).children.push({ kind: 'field', path: 'paid' }) }],
      ['/layouts/0/nodes/0/children/0/children/0', (form) => { (grid(form, 0).children[0] as unknown as Record<string, unknown>)['help'] = 'x' }],
      ['/layouts/0/nodes', (form) => { grid(form, 0).children.pop() }],
    ]
    for (const [path, change] of bases) {
      const other = copy(base)
      change(other)
      expect(presentationOf(other, copy(other), bindings), path).toEqual({ ok: false, problems: [`a base this release did not generate (${path})`] })
    }
  })

  // A hand-written or damaged document is refused at the first place it is
  // not the generated one plus the four edits, and that place is named, so
  // the person can find it; a guess would publish something nobody chose.
  test('refuses an edited document of any other shape, naming where', () => {
    expect(presentationOf(base, null as unknown as FormSchema, bindings)).toEqual({ ok: false, problems: ['/: the edited form is not an object'] })
    const at = (key: string) => `/model/fields/${index(key)}`
    const grid0 = '/layouts/0/nodes/0/children/0'
    const cases: Array<[string[], (form: FormSchema) => void]> = [
      [['/model: the edited form has no fields'], (form) => { (form as unknown as { model: unknown }).model = {} }],
      [['/model/extra: changed, and only labels, order and full width are presentation'], (form) => { (form.model as unknown as Record<string, unknown>)['extra'] = 1 }],
      [['/model/fields: the fields are in another order, and the model order is not presentation'], (form) => { form.model.fields.reverse() }],
      [[`${at('notes')}/label: a label may change, not be removed`], (form) => { delete field(form, 'notes')['label'] }],
      [[`${at('notes')}/label: not text`], (form) => { field(form, 'notes')['label'] = 7 }],
      [['/layouts: the form keeps the one layout it was generated with'], (form) => { delete form.layouts }],
      [['/layouts/0: changed, and only labels, order and full width are presentation', '/layouts/0/name: changed, and only labels, order and full width are presentation'], (form) => {
        (form.layouts as unknown as Array<Record<string, unknown>>)[0] = { name: 'web', nodes: form.layouts?.[0]?.nodes, label: 'x' }
      }],
      [['/layouts/0/nodes/0: a section may change its label, and is otherwise the generated one'], (form) => { (section(form, 0) as { kind: string }).kind = 'row' }],
      [['/layouts/0/nodes/0/label: not text'], (form) => { (section(form, 0) as unknown as { label: unknown }).label = 7 }],
      [['/layouts/0/nodes/0/children: a section holds the one grid it was generated with'], (form) => { section(form, 0).children.push(section(form, 0).children[0] as LayoutNode) }],
      [[`${grid0}/columns: changed, and only labels, order and full width are presentation`], (form) => { grid(form, 0).columns = 3 }],
      [[`${grid0}/children/0: a grid holds the fields it was generated with, and nothing else`, `${grid0}/children: customer is missing`], (form) => {
        (grid(form, 0).children as unknown[])[0] = { kind: 'static', path: 'customer' }
      }],
      [[`${grid0}/children/2/span: full width is 'all'`], (form) => { (node(form, 'status') as unknown as { span: string }).span = 'half' }],
      [[`${grid0}/children/1/path: customer is placed twice`, `${grid0}/children: order_date is missing`], (form) => { node(form, 'order_date').path = 'customer' }],
      [[`${grid0}/children/1/path: ghost is not a field of the base`, `${grid0}/children: order_date is missing`], (form) => { node(form, 'order_date').path = 'ghost' }],
    ]
    for (const [expected, change] of cases) {
      const edited = copy(base)
      change(edited)
      expect(problems(edited), expected[0]).toEqual(expected)
    }
  })

  // A field the bindings do not name has nothing to anchor its presentation
  // to, so a label on it could never be carried; refused rather than stored
  // under an anchor nobody can check.
  test('refuses an edit to a field the bindings do not name', () => {
    const edited = copy(base)
    field(edited, 'paid')['label'] = 'Settled'
    const unbound = { ...bindings, fields: bindings.fields.filter((entry) => entry.field !== 'paid') }
    expect(presentationOf(base, edited, unbound)).toEqual({ ok: false, problems: [`/model/fields/${index('paid')}: paid has no binding, so nothing anchors its presentation`] })
  })
})
