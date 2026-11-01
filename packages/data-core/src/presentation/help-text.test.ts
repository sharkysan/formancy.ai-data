import type { FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import { column, dropColumn, ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import { applyPresentation } from './apply.js'
import { presentationOf } from './derive.js'
import { rebasePresentation } from './rebase.js'
import type { PresentationOverrides } from './types.js'
import { PRESENTATION_VERSION } from './types.js'

/*
 * A field's help text as presentation (0119): a person adds it, replaces
 * the comment the generator took it from (0118), or removes it, and a
 * regeneration carries that by what the field stands for, as it carries a
 * label (0030). The base is the drift fixture's order form; `notes` has a
 * comment where a case gives it one.
 */

const copy = (form: FormSchema): FormSchema => JSON.parse(JSON.stringify(form)) as FormSchema
const field = (form: FormSchema, key: string) => form.model.fields.find((entry) => entry.key === key) as unknown as Record<string, unknown>
const NOTES = { kind: 'column', column: 'notes' } as const
const commented =
  (comment: string | null) =>
  (objects: ObjectMeta[]): void => {
    column(objects, 'order', 'notes').comment = comment
  }

/** Generate from `before`, edit, derive: as the studio publishes. */
function publish(edit: (form: FormSchema) => void, before: (objects: ObjectMeta[]) => void = () => {}) {
  const { form, bindings } = generateForm(snapshot(before), ORDER)
  const edited = copy(form)
  edit(edited)
  const derived = presentationOf(form, edited, bindings)
  if (!derived.ok) throw new Error(derived.problems.join('; '))
  return { base: form, presentation: derived.presentation, bindings, edited }
}

/** Regenerate from `after` and carry the presentation; the merged form must be one formancy accepts. */
function regenerate(published: ReturnType<typeof publish>, after: (objects: ObjectMeta[]) => void = () => {}) {
  const next = generateForm(snapshot(after), ORDER)
  const rebased = rebasePresentation(published, { base: next.form, bindings: next.bindings })
  const valid = validateSchema(rebased.form)
  expect(valid.valid, JSON.stringify(valid.valid ? [] : valid.errors)).toBe(true)
  return rebased
}

describe("a field's help text as presentation (0119)", () => {
  // Added where the base has none, replaced where the base took its
  // column's comment, and removed: each derives exactly its entry, and
  // applying it gives the edited form back. Watched failing with help text
  // refused as before 0119: "only a field's label is presentation".
  test('added, replaced and removed, each derives its entry, and applying it gives the edited form back', () => {
    const added = publish((form) => {
      field(form, 'notes')['description'] = 'Anything the courier should know.'
    })
    expect(added.presentation.fields).toEqual([{ field: 'notes', anchor: NOTES, description: 'Anything the courier should know.' }])
    expect(field(added.edited, 'notes')['description']).toBe('Anything the courier should know.')
    const replaced = publish((form) => {
      field(form, 'notes')['description'] = 'Anything the courier should know.'
    }, commented('Free text; max 4000 on the old system.'))
    expect(replaced.presentation.fields).toEqual([{ field: 'notes', anchor: NOTES, description: 'Anything the courier should know.' }])
    const removed = publish((form) => {
      delete field(form, 'notes')['description']
    }, commented('Free text; max 4000 on the old system.'))
    expect(removed.presentation.fields).toEqual([{ field: 'notes', anchor: NOTES, description: null }])
    for (const published of [added, replaced, removed]) {
      expect(applyPresentation(published.base, published.presentation, published.bindings)).toEqual({ ok: true, form: published.edited })
    }
  })

  // One spelling for each meaning: help text equal to the base's, and a
  // removal where the base has none, say nothing and are refused; so is
  // help text that is not formancy's text.
  test('refuses help text equal to the base’s, a removal of none, and help text that is not text', () => {
    const { form, bindings } = generateForm(snapshot(commented('Free text.')), ORDER)
    const at = String(form.model.fields.findIndex((entry) => entry.key === 'notes'))
    // The presentation's own place for its one entry; the model's for the edited form.
    const presentation = (description: unknown): PresentationOverrides =>
      ({ version: PRESENTATION_VERSION, fields: [{ field: 'notes', anchor: NOTES, description }], sections: [] }) as PresentationOverrides
    expect(applyPresentation(form, presentation('Free text.'), bindings)).toEqual({
      ok: false,
      problems: ["/fields/0/description: equals the base's; leave it out"],
    })
    const bare = generateForm(snapshot(), ORDER)
    expect(applyPresentation(bare.form, presentation(null), bare.bindings)).toEqual({
      ok: false,
      problems: ['/fields/0/description: the base has no help text to remove; leave it out'],
    })
    expect(applyPresentation(form, presentation(7), bindings)).toMatchObject({
      ok: false,
      problems: ['/fields/0/description must be text, or null to remove the base’s'],
    })
    const edited = copy(form)
    field(edited, 'notes')['description'] = 7
    expect(presentationOf(form, edited, bindings)).toEqual({ ok: false, problems: [`/model/fields/${at}/description: not text`] })
  })

  // A version stored before 0118 has a spec 3 base, which holds no help
  // text: help text over it is refused with what to do, not left for the
  // server to refuse as a later spec's construct. Watched failing with the
  // spec left unasked: the form came back spec 3 holding a description.
  test('refuses help text over a spec 3 base, saying to generate the form again', () => {
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const old = { ...copy(form), specVersion: '3' } as FormSchema
    const presentation: PresentationOverrides = {
      version: PRESENTATION_VERSION,
      fields: [{ field: 'notes', anchor: NOTES, description: 'Help.' }],
      sections: [],
    }
    expect(applyPresentation(old, presentation, bindings)).toEqual({
      ok: false,
      problems: ['/fields/0/description: help text needs spec 5, and this base is spec "3"; generate the form again'],
    })
  })

  // A regeneration carries help text by the column: unchanged, it comes
  // through; the comment changed in the database, the person's is kept and
  // said (`both-changed`); the comment now saying what the person wrote,
  // the override goes without a word; a removal of a comment that is gone
  // goes too; and a column dropped takes its help text with it
  // (`field-gone`). Watched failing with help text left out of the
  // carried overrides: nothing came through.
  test('a regeneration carries help text by its column, keeping the person’s where the comment changed too', () => {
    const written = (form: FormSchema) => {
      field(form, 'notes')['description'] = 'Anything the courier should know.'
    }
    const published = publish(written, commented('Free text.'))
    const same = regenerate(published, commented('Free text.'))
    expect(same.conflicts).toEqual([])
    expect(field(same.form, 'notes')['description']).toBe('Anything the courier should know.')
    const changed = regenerate(published, commented('Free text, 4000 characters.'))
    expect(changed.conflicts).toEqual([
      expect.objectContaining({
        kind: 'both-changed',
        field: 'notes',
        property: 'description',
        yours: 'Anything the courier should know.',
        generator: 'Free text, 4000 characters.',
      }),
    ])
    expect(field(changed.form, 'notes')['description']).toBe('Anything the courier should know.')
    const agreed = regenerate(published, commented('Anything the courier should know.'))
    expect({ conflicts: agreed.conflicts, fields: agreed.presentation.fields }).toEqual({ conflicts: [], fields: [] })
    const removal = publish((form) => {
      delete field(form, 'notes')['description']
    }, commented('Free text.'))
    const uncommented = regenerate(removal, commented(null))
    expect({ conflicts: uncommented.conflicts, fields: uncommented.presentation.fields }).toEqual({ conflicts: [], fields: [] })
    const gone = regenerate(published, (objects) => dropColumn(objects, 'order', 'notes'))
    expect(gone.conflicts).toEqual([
      expect.objectContaining({ kind: 'field-gone', field: 'notes', property: 'description', yours: 'Anything the courier should know.' }),
    ])
  })
})
