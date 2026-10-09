import { describe, expect, test } from 'vitest'
import { ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import { applyPresentation, presentationShapeProblems } from './apply.js'
import type { PresentationOverrides } from './types.js'
import { EMPTY_PRESENTATION } from './types.js'

/*
 * applyPresentation is what the server runs on every read of a format-2
 * bundle: the stored form must be the base with its presentation applied.
 * So it refuses anything a hand edit could put in a presentation that the
 * studio's four edits could not, and anything that is not the one spelling
 * of what it says.
 */

const { form: base, bindings } = generateForm(snapshot(), ORDER)

const presentation = (fields: unknown[] = [], sections: unknown[] = []) => ({ version: 1, fields, sections }) as PresentationOverrides
const problems = (value: PresentationOverrides) => {
  const outcome = applyPresentation(base, value, bindings)
  expect(outcome.ok, 'the presentation should have been refused').toBe(false)
  return outcome.ok ? [] : outcome.problems
}
const NOTES = { kind: 'column', column: 'notes' }

describe('applyPresentation', () => {
  // The empty presentation is the base itself, which is what every bundle
  // the generator proposed and nobody edited holds.
  test('the empty presentation gives the base back', () => {
    expect(applyPresentation(base, EMPTY_PRESENTATION, bindings)).toEqual({ ok: true, form: base })
  })

  // A key the base lacks is a presentation for another form; applied, it
  // would be silently ignored and the person's edit lost without a word.
  test('refuses an unknown key', () => {
    expect(problems(presentation([{ field: 'ghost', anchor: { kind: 'column', column: 'ghost' }, label: 'Ghost' }]))).toEqual(['/fields/0/field: the base has no field ghost'])
  })

  // The anchor is what a regeneration carries the override by. One naming
  // another column than the key's binding would carry the label to that
  // column at the next regeneration, onto a field nobody labelled.
  test('refuses an anchor naming another column than the key stands for', () => {
    expect(problems(presentation([{ field: 'notes', anchor: { kind: 'column', column: 'status' }, label: 'Delivery notes' }]))).toEqual([
      '/fields/0/anchor: notes stands for column notes, not column status',
    ])
  })

  // An order is the section's own fields rearranged. One that drops a field
  // would publish a form that places it nowhere; one that adds a field from
  // another section is a move between sections, which is not presentation.
  test('refuses an order that is not a permutation of its section', () => {
    const anchor = { label: 'Order', occurrence: 0 }
    expect(problems(presentation([], [{ anchor, order: ['customer', 'order_date'] }]))).toEqual([
      "/sections/0/order: not an order of that section's fields (customer, order_date, status, amount, notes, created_by, paid)",
    ])
    expect(problems(presentation([], [{ anchor, order: ['id', 'order_date', 'status', 'amount', 'notes', 'created_by', 'paid'] }]))).toHaveLength(1)
  })

  // A section the base does not have is an override with nowhere to go.
  test('refuses an unmatched section', () => {
    expect(problems(presentation([], [{ anchor: { label: 'Order', occurrence: 1 }, label: 'Again' }]))).toEqual(['/sections/0/anchor: the base has no section labelled "Order" at occurrence 1'])
  })

  // One presentation, one spelling: an entry equal to the base, or empty,
  // would make two stored files that mean the same thing differ, and a
  // check that compares them canonically would call them different.
  test('refuses a non-minimal entry', () => {
    expect(problems(presentation([{ field: 'notes', anchor: NOTES, label: 'Notes' }]))).toEqual(["/fields/0/label: equals the base's; leave it out"])
    expect(problems(presentation([{ field: 'notes', anchor: NOTES, span: 'all' }]))).toEqual(["/fields/0/span: equals the base's; leave it out"])
    expect(problems(presentation([{ field: 'notes', anchor: NOTES }]))).toEqual(['/fields/0: says nothing; leave the field out'])
    const anchor = { label: 'Order', occurrence: 0 }
    expect(problems(presentation([], [{ anchor, label: 'Order' }]))).toEqual(["/sections/0/label: equals the base's; leave it out"])
    expect(problems(presentation([], [{ anchor, order: ['customer', 'order_date', 'status', 'amount', 'notes', 'created_by', 'paid'] }]))).toEqual(["/sections/0/order: equals the base's; leave it out"])
    expect(problems(presentation([], [{ anchor }]))).toEqual(['/sections/0: says nothing; leave the section out'])
    // And entries out of the base's order are a second spelling of the same patch.
    const STATUS = { kind: 'column', column: 'status' }
    expect(problems(presentation([{ field: 'notes', anchor: NOTES, label: 'N' }, { field: 'status', anchor: STATUS, label: 'S' }]))).toEqual(["/fields: not in the base's field order"])
  })

  // What a hand edit of the file could put there, each named: a version
  // this release does not read, a property it does not know (which would be
  // stored and never applied), a span or label of the wrong type.
  test('refuses an unknown version or property, and values of the wrong shape', () => {
    expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, version: 2 })).toEqual(['version must be 1'])
    expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, help: [] })).toEqual(['help is not a property of a presentation'])
    expect(presentationShapeProblems(null)).toEqual(['a presentation is an object'])
    expect(presentationShapeProblems(presentation([{ field: 'notes', anchor: NOTES, label: 'N', help: 'x', span: 2 }]))).toEqual([
      '/fields/0/help is not a property of a field presentation',
      "/fields/0/span must be 'all' or 'one'",
    ])
    expect(presentationShapeProblems(presentation([{ field: 'notes', anchor: { kind: 'column' }, label: 7 }]))).toEqual([
      '/fields/0/anchor must be { kind: column, column } or { kind: lookup, foreignKey }',
      '/fields/0/label must be text',
    ])
    expect(presentationShapeProblems(presentation([], [{ anchor: { label: 'Order', occurrence: -1 }, order: ['a', 1] }]))).toEqual([
      '/sections/0/anchor must be { label, occurrence } with a whole occurrence of at least 0',
      '/sections/0/order must be field keys',
    ])
    expect(problems({ ...EMPTY_PRESENTATION, version: 2 } as unknown as PresentationOverrides)).toEqual(['version must be 1'])
    expect(presentationShapeProblems({ version: 1, fields: {}, sections: 'x' })).toEqual(['fields must be a list', 'sections must be a list'])
    expect(presentationShapeProblems(presentation(['notes'], [null]))).toEqual(['/fields/0 must be an object', '/sections/0 must be an object'])
    expect(presentationShapeProblems(presentation([{ field: 7, anchor: { kind: 'table', name: 'x' } }]))).toEqual([
      '/fields/0/field must be a field key',
      '/fields/0/anchor must be { kind: column, column } or { kind: lookup, foreignKey }',
    ])
    expect(presentationShapeProblems(presentation([], [{ anchor: { label: 'Order', occurrence: 0 }, label: 7, width: 2 }]))).toEqual([
      '/sections/0/width is not a property of a section presentation',
      '/sections/0/label must be text',
    ])
    // A lookup's anchor and a translated label are both well formed.
    expect(presentationShapeProblems(presentation([{ field: 'customer', anchor: { kind: 'lookup', foreignKey: 'fk_order_customer' }, label: { $t: 'buyer' } }]))).toEqual([])
  })

  // What the presentation is applied to must be a base this release
  // generated, and every key it names must be bound: otherwise there is no
  // anchor to check the entry's against.
  test('refuses a base of another shape, and a key the bindings do not name', () => {
    const odd = { ...base, layouts: [] }
    expect(applyPresentation(odd, EMPTY_PRESENTATION, bindings)).toEqual({ ok: false, problems: ['a base this release did not generate (/layouts)'] })
    const unbound = { ...bindings, fields: bindings.fields.filter((entry) => entry.field !== 'notes') }
    expect(applyPresentation(base, presentation([{ field: 'notes', anchor: NOTES, label: 'N' }]), unbound)).toEqual({ ok: false, problems: ['/fields/0/field: notes has no binding'] })
  })

  // Sections out of the base's order are a second spelling of one patch, as fields are.
  test("refuses sections out of the base's order", () => {
    const record = { anchor: { label: 'Record', occurrence: 0 }, label: 'Bookkeeping' }
    const order = { anchor: { label: 'Order', occurrence: 0 }, label: 'Order details' }
    expect(applyPresentation(base, presentation([], [order, record]), bindings)).toMatchObject({ ok: true })
    expect(problems(presentation([], [record, order]))).toEqual(["/sections: not in the base's section order"])
  })

  // Two entries for one field, or one section, would leave which applies to
  // the order they happen to be read in.
  test('refuses duplicates', () => {
    expect(presentationShapeProblems(presentation([{ field: 'notes', anchor: NOTES, label: 'A' }, { field: 'notes', anchor: NOTES, span: 'one' }]))).toEqual(['/fields/1: notes appears twice'])
    const anchor = { label: 'Order', occurrence: 0 }
    expect(presentationShapeProblems(presentation([], [{ anchor, label: 'A' }, { anchor, label: 'B' }]))).toEqual(['/sections/1: section "Order" (0) appears twice'])
    expect(presentationShapeProblems(presentation([], [{ anchor, order: ['notes', 'notes'] }]))).toEqual(['/sections/0/order: notes appears twice'])
  })
})
