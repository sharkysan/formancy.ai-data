import { describe, expect, test } from 'vitest'
import { dropColumn, ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import { listColumns } from '../records/list.js'
import { applyPresentation, presentationShapeProblems } from './apply.js'
import { rebasePresentation } from './rebase.js'
import type { PresentationOverrides } from './types.js'
import { EMPTY_PRESENTATION } from './types.js'
import { carryUnfiltered, unfilteredProblems } from './unfiltered.js'

/*
 * The fields a form's Filter panel does not offer (0123): an administrator's
 * choice, kept in the presentation beside its list views, as field keys --
 * the panel offers every other field a list is filtered by. The base is the
 * drift fixture's order form: customer is a lookup, which no list filters
 * by, and every other field is a column one does.
 */

const { form, bindings } = generateForm(snapshot(), ORDER)
const all = bindings.fields.map((binding) => binding.field)
const offered = (unfiltered: readonly string[]) =>
  listColumns(bindings, all, [], unfiltered).filterable.map((field) => `${field.field}:${String(field.offered)}`)

describe('the fields the Filter panel does not offer (0123)', () => {
  // The list says, per field it is filtered by, whether the panel offers
  // it: what the administrator left out is still filterable -- a view of
  // theirs may filter on it -- and is not offered. Watched failing with
  // every field offered: notes and paid said true.
  test('a list marks every field it is filtered by offered, but the ones left out', () => {
    expect(offered([])).toEqual(expect.arrayContaining(['notes:true', 'paid:true', 'status:true']))
    expect(offered(['notes', 'paid'])).toEqual(expect.arrayContaining(['notes:false', 'paid:false', 'status:true']))
    expect(offered(['notes', 'paid']).length).toBe(offered([]).length)
  })

  // One spelling: none left out is the property left out, a field once,
  // and only keys. A field must be one the list filters by: a lookup, or a
  // key the form does not have, is refused as the server refuses it at a
  // write. Watched failing with the fit unasked: customer was stored.
  test('is a list of field keys the list filters by, each once, never empty', () => {
    const shaped = (unfiltered: unknown) => presentationShapeProblems({ ...EMPTY_PRESENTATION, unfiltered })
    expect(shaped(['notes'])).toEqual([])
    expect(shaped([])).toEqual(['unfiltered: leaves out none; leave it out'])
    expect(shaped(['notes', 'notes'])).toEqual(['/unfiltered/1: notes appears twice'])
    expect(shaped('notes')).toEqual(['unfiltered must be a list of field keys'])
    expect(shaped([7])).toEqual(['unfiltered must be a list of field keys'])
    expect(unfilteredProblems(['notes', 'paid'], bindings)).toEqual([])
    expect(unfilteredProblems(['customer', 'ghost'], bindings)).toEqual([
      '/unfiltered/0: customer is not a field this list is filtered by.',
      '/unfiltered/1: ghost is not a field this list is filtered by.',
    ])
  })

  // The choice is no part of the form's document, so applying the
  // presentation leaves the form as it was; it reaches the person through
  // the list.
  test('applying the presentation leaves the form as it was', () => {
    const presentation: PresentationOverrides = { ...EMPTY_PRESENTATION, unfiltered: ['notes'] }
    expect(applyPresentation(form, presentation, bindings)).toEqual({ ok: true, form })
  })

  // A regeneration carries it by the column, as a label: a key that moved
  // follows its column, and one whose column is gone, or that the list no
  // longer filters by, goes without a word -- the panel cannot offer it
  // either way. Watched failing with the keys carried as they were: the
  // gone column's key was kept.
  test('a regeneration carries it by the column, and drops a field that is gone', () => {
    const published = { base: form, presentation: { ...EMPTY_PRESENTATION, unfiltered: ['notes', 'paid'] }, bindings }
    const same = generateForm(snapshot(), ORDER)
    expect(rebasePresentation(published, { base: same.form, bindings: same.bindings }).presentation.unfiltered).toEqual(['notes', 'paid'])
    const dropped = generateForm(
      snapshot((objects: ObjectMeta[]) => dropColumn(objects, 'order', 'notes')),
      ORDER,
    )
    const rebased = rebasePresentation(published, { base: dropped.form, bindings: dropped.bindings })
    expect(rebased.presentation.unfiltered).toEqual(['paid'])
    expect(rebased.conflicts).toEqual([])
    const neither = generateForm(
      snapshot((objects: ObjectMeta[]) => {
        dropColumn(objects, 'order', 'notes')
        dropColumn(objects, 'order', 'paid')
      }),
      ORDER,
    )
    expect(rebasePresentation(published, { base: neither.form, bindings: neither.bindings }).presentation).not.toHaveProperty('unfiltered')
    // A key followed to one the list does not filter by goes too.
    expect(carryUnfiltered(['notes'], (key) => (key === 'notes' ? 'customer' : undefined), bindings)).toEqual([])
  })
})
