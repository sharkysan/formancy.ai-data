import { acceptsDefault, createFormEngine } from '@formancy/core'
import type { FieldDef, FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import { addColumn, col, column, decimal, dropColumn, INT64, ORDER, restrict, retype, snapshot, text } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import type { NormalizedType, ObjectMeta } from '../metadata.js'
import { createStates, startingDefaults } from '../policy/starting.js'
import type { FormPolicy } from '../policy/types.js'
import { applyPresentation } from './apply.js'
import { presentationOf } from './derive.js'
import { rebasePresentation } from './rebase.js'
import { noStartingValue, startingStateProblem, startingStateProblems, startingValue } from './starting-value.js'
import type { FieldPresentation, PresentationOverrides, StartingValue } from './types.js'
import { PRESENTATION_VERSION } from './types.js'

/*
 * A field's starting value as presentation (0150): an administrator gives
 * a field another answer to start a new record with than its column's
 * constant default (0149), or one where it has none, never none where it
 * has one, and a regeneration carries that by what the field stands for,
 * as it carries help text (0119). The base is the drift fixture's order form on SQL Server:
 * status, an nvarchar(20), starts at its column's `('placed')`; amount is a
 * decimal(18,4) held as text, notes unbounded text, created_by a whole
 * number, paid a yes or no, order_date a date, customer a lookup and id a
 * key the database numbers.
 */

const copy = (form: FormSchema): FormSchema => JSON.parse(JSON.stringify(form)) as FormSchema
const field = (form: FormSchema, key: string) => form.model.fields.find((entry) => entry.key === key) as unknown as Record<string, unknown>
const STATUS = { kind: 'column', column: 'status' } as const
const CAPABILITIES = { now: () => 0, today: () => '2026-11-11', random: () => 0.5 }
/** A nullable yes or no, which the generator draws as a select of 'true' and 'false' (0095). */
const rush = (objects: ObjectMeta[]) => addColumn(objects, 'order', col('rush', 'bit', { kind: 'boolean' }, { nullable: true }))
/** Three characters of PostgreSQL's, which an emoji counts as one of and the field's box as two (0026). */
const code = (objects: ObjectMeta[]) => addColumn(objects, 'order', col('code', 'varchar(3)', text(3, false, 'code-points'), { nullable: true }))
const both =
  (...edits: Array<(objects: ObjectMeta[]) => void>) =>
  (objects: ObjectMeta[]) => {
    for (const edit of edits) edit(objects)
  }
const startsAt = (value: string | null) => (objects: ObjectMeta[]) => {
  Object.assign(column(objects, 'order', 'status'), { hasDefault: value !== null, defaultExpression: value === null ? null : `('${value}')` })
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

/** Regenerate from `after` and carry the presentation; the merged form must be one formancy accepts and its engine opens. */
function regenerate(published: ReturnType<typeof publish>, after: (objects: ObjectMeta[]) => void = () => {}) {
  const next = generateForm(snapshot(after), ORDER)
  const rebased = rebasePresentation(published, { base: next.form, bindings: next.bindings })
  const valid = validateSchema(rebased.form)
  expect(valid.valid, JSON.stringify(valid.valid ? [] : valid.errors)).toBe(true)
  createFormEngine({ schema: rebased.form, capabilities: CAPABILITIES })
  return rebased
}

/** A presentation of one field entry, as a client other than the studio could send it. */
function one(key: string, anchor: FieldPresentation['anchor'], value: unknown): PresentationOverrides {
  return { version: PRESENTATION_VERSION, fields: [{ field: key, anchor, default: value }], sections: [] } as PresentationOverrides
}

/** The problems applying `value` as `key`'s starting value meets, over the order form generated after `before`. */
function refusals(key: string, value: unknown, before: (objects: ObjectMeta[]) => void = () => {}): string[] {
  const { form, bindings } = generateForm(snapshot(before), ORDER)
  const binding = bindings.fields.find((entry) => entry.field === key)
  if (binding === undefined) throw new Error(`no binding ${key}`)
  const anchor = binding.kind === 'column' ? { kind: 'column' as const, column: binding.column } : { kind: 'lookup' as const, foreignKey: binding.foreignKey }
  const applied = applyPresentation(form, one(key, anchor, value), bindings)
  return applied.ok ? [] : applied.problems
}

describe("a field's starting value as presentation (0150)", () => {
  // Replaced where the column gave one, and added where it gave none --
  // text, unbounded text, a whole number, a yes or no, an exact decimal:
  // each derives exactly its entry, applying it gives the edited form back,
  // and the released engine opens that form starting each field there.
  // Watched failing with the starting value refused as before 0150: each
  // field's default "changed, and only a field's label, help text ... are
  // presentation".
  test('set and added, each derives its entry, and applying it gives the edited form back, which the engine starts with', () => {
    const set = publish((form) => {
      field(form, 'status')['default'] = 'draft'
      field(form, 'amount')['default'] = '9.5000'
      field(form, 'notes')['default'] = 'None so far.'
      field(form, 'created_by')['default'] = 7
      field(form, 'paid')['default'] = true
    })
    expect(set.presentation.fields).toEqual([
      { field: 'status', anchor: STATUS, default: 'draft' },
      { field: 'amount', anchor: { kind: 'column', column: 'amount' }, default: '9.5000' },
      { field: 'notes', anchor: { kind: 'column', column: 'notes' }, default: 'None so far.' },
      { field: 'created_by', anchor: { kind: 'column', column: 'created_by' }, default: 7 },
      { field: 'paid', anchor: { kind: 'column', column: 'paid' }, default: true },
    ])
    expect(applyPresentation(set.base, set.presentation, set.bindings)).toEqual({ ok: true, form: set.edited })
    const checked = validateSchema(set.edited)
    expect(checked.valid ? [] : checked.errors).toEqual([])
    expect(createFormEngine({ schema: set.edited, capabilities: CAPABILITIES }).value()).toEqual({
      status: 'draft',
      amount: '9.5000',
      notes: 'None so far.',
      created_by: 7,
      paid: true,
    })
    // An edit and its reversal leave nothing behind, as every other edit's does.
    const reverted = publish((form) => {
      field(form, 'status')['default'] = 'draft'
      field(form, 'status')['default'] = 'placed'
    })
    expect(reverted.presentation.fields).toEqual([])
  })

  // A field left empty is left out of a create (`planCreate`), and the
  // database stores the column's default: a form whose field starts empty
  // over a column's default would show nothing where the record will hold
  // draft, which 0149 exists to end. So the column's default is never taken
  // away -- refused on derive and on apply, saying why -- and another value
  // replaces it instead. Watched failing with removals taken as help text's
  // are: status derived `default: null`, and a fresh form started empty.
  test('refuses taking the column’s default away, on derive and on apply, saying why', () => {
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const edited = copy(form)
    delete field(edited, 'status')['default']
    const at = String(form.model.fields.findIndex((entry) => entry.key === 'status'))
    expect(presentationOf(form, edited, bindings)).toEqual({
      ok: false,
      problems: [
        `/model/fields/${at}/default: removed, and a field left empty is left out of a create, which stores the column's default unseen by the person filling the form in; give another starting value instead`,
      ],
    })
    for (const key of ['status', 'notes'])
      expect(refusals(key, null)).toEqual([
        "/fields/0/default is null, and a starting value is never taken away: a field left empty is left out of a create, which stores the column's default unseen by the person filling the form in; give a value, or leave it out",
      ])
  })

  // One spelling for each meaning, as help text has (0119): a starting
  // value equal to the base's says nothing and is refused; a base older than spec 5 holds no default and
  // is told to be generated again; and a value of no shape spec 5's
  // `default` takes on a generated field is refused by shape, on apply and
  // on derive. Watched failing with the base's value unasked: status's
  // "placed" was taken, and the presentation had two spellings.
  test('refuses a value equal to the base’s, one over spec 3, and one of no starting value’s shape', () => {
    expect(refusals('status', 'placed')).toEqual(["/fields/0/default: equals the base's; leave it out"])
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const old = { ...copy(form), specVersion: '3' } as FormSchema
    delete (old.model.fields.find((entry) => entry.key === 'status') as FieldDef).default
    expect(applyPresentation(old, one('status', STATUS, 'draft'), bindings)).toEqual({
      ok: false,
      problems: ['/fields/0/default: a starting value needs spec 5, and this base is spec "3"; generate the form again'],
    })
    for (const shape of [['draft'], { value: 'draft' }, Number.NaN])
      expect(refusals('status', shape)).toEqual(['/fields/0/default must be text, a finite number or true or false'])
    const edited = copy(form)
    field(edited, 'status')['default'] = ['draft']
    const at = String(form.model.fields.findIndex((entry) => entry.key === 'status'))
    expect(presentationOf(form, edited, bindings)).toEqual({ ok: false, problems: [`/model/fields/${at}/default: not text, a finite number or true or false`] })
  })

  // A lookup's answer is a record token, the record a value names may be
  // one this person may not choose (0149); a field the create does not
  // write is never sent by a new record; and a date is a kind no case
  // here creates and reads back a starting answer of. Each is refused with
  // its own reason, and the studio offers each no control,
  // saying that reason. Watched failing with the kind left unasked:
  // order_date took 2026-01-01.
  test('refuses a starting value on a lookup, a field the create does not write and a date, each with its reason', () => {
    expect(refusals('customer', 'k1:x')).toEqual([
      "/fields/0/default: customer takes no starting value: a lookup's answer is a record, and the one a starting value names may be one the person filling the form in may not choose",
    ])
    expect(refusals('id', '1')).toEqual(['/fields/0/default: id takes no starting value: a create does not write it, so the database fills it'])
    expect(refusals('order_date', '2026-01-01')).toEqual([
      '/fields/0/default: order_date takes no starting value: one is offered for text, a whole or exact number and yes or no, and this is a date',
    ])
    const restricted = generateForm(
      snapshot((objects) => restrict(objects, 'order', 'notes', { insert: false })),
      ORDER,
    ).bindings.fields.find((entry) => entry.field === 'notes')
    expect(restricted === undefined ? 'no notes' : noStartingValue(restricted)).toBe('a create does not write it, so the database fills it')
  })

  // A value the field does not take is refused in the words its column's
  // codec or its box refuses it in, as 0149 refuses a column's constant: too
  // long, out of range, a fraction for a whole number, text for a number,
  // a number for text, words for a yes or no, an answer the select does not
  // offer, text the column holds and the box does not, and an empty one.
  // One spelled otherwise than a record holding it reads back is refused
  // with the spelling to give, so a presentation has one. Watched failing
  // with the spelling unasked: amount took “9.5”, which it stores as 9.5000;
  // and with the values printed alike: "reads “7” back as “7”".
  test('refuses a value the field does not take in its column’s words, and one spelled otherwise than it reads back', () => {
    const reason = (key: string, value: unknown, before?: (objects: ObjectMeta[]) => void) =>
      refusals(key, value, before)[0]?.replace('/fields/0/default: ', '')
    expect(reason('status', 'x'.repeat(21))).toBe(`“${'x'.repeat(21)}” is not an answer status takes (at most 20 characters, counting an emoji as two)`)
    expect(reason('status', 7)).toBe('the number 7 is not an answer status takes (expected text)')
    expect(reason('created_by', 2147483648)).toBe(
      'the number 2147483648 is not an answer created_by takes (enter a whole number from -2147483648 to 2147483647)',
    )
    expect(reason('created_by', 1.5)).toBe('the number 1.5 is not an answer created_by takes (its control holds a whole number)')
    expect(reason('created_by', '7')).toBe('“7” is not an answer created_by takes (its control holds a whole number)')
    expect(reason('paid', 'true')).toBe('“true” is not an answer paid takes (expected true or false)')
    expect(reason('amount', '1e3')).toMatch(/^“1e3” is not an answer amount takes \(enter a number such as 1234\.56/)
    expect(reason('amount', '9.5')).toBe('amount reads “9.5” back as “9.5000”; give that')
    expect(reason('notes', '')).toBe('“” is not an answer notes takes (it is empty, which is how the field starts without one)')
    expect(reason('rush', 'yes', rush)).toBe('“yes” is not an answer rush takes (its control is a select of “true” and “false”)')
    expect(reason('rush', true, rush)).toBe('the boolean true is not an answer rush takes (its control is a select of “true” and “false”)')
    // Two values that print alike say which is which: a bigint is held as text, so 7 is a number it reads back as text.
    const bigint = (objects: ObjectMeta[]) => retype(objects, 'order', 'created_by', 'bigint', INT64)
    expect(reason('created_by', 7, bigint)).toBe('created_by reads the number 7 back as the text “7”; give that')
    expect(reason('code', '😀😀', code)).toBe('“😀😀” is not an answer code takes (longer than the 3 UTF-16 code units the field holds)')
    expect(reason('status', 'a\tb')).toBe(
      '“a\tb” is not an answer status takes (it holds a line break, a tab or another control character, which a one-line box draws otherwise)',
    )
    expect(reason('notes', 'a\rb')).toBe(
      '“a\rb” is not an answer notes takes (it holds a control character other than a line feed or a tab, which a box draws otherwise)',
    )
    expect(refusals('notes', 'a\nb\tc')).toEqual([])
    expect(refusals('rush', 'true', rush)).toEqual([])
    expect(refusals('code', 'abc', code)).toEqual([])
  })

  // The kinds the generator starts a field at its column's constant of
  // (0149) and the kinds a starting value is offered for are one list: a
  // reader taught a kind the presentation does not offer would give the
  // base a default every publish of a presentation over it then refuses.
  // A column of every kind with a constant spelled as SQL Server spells it;
  // each field the generator starts somewhere is one whose start is taken.
  // Watched failing with 0149's reader taught a float alone: weight started
  // at 1.5, and its starting value was refused as a floating-point number.
  test('every field the generator starts at its column’s constant takes a starting value there, of every kind', () => {
    const kinds = [
      ['words', 'nvarchar(20)', text(20), "('x')"],
      ['count', 'int', { kind: 'integer', min: '-2147483648', max: '2147483647' }, '((1))'],
      ['price', 'decimal(9,2)', decimal(9, 2), '((1.5))'],
      ['flag', 'bit', { kind: 'boolean' }, '((1))'],
      ['weight', 'float', { kind: 'float', bits: 64 }, '((1.5))'],
      ['day', 'date', { kind: 'date' }, "('2026-01-01')"],
      ['hour', 'time', { kind: 'time' }, "('10:00')"],
      ['moment', 'datetimeoffset', { kind: 'timestamp', withTimeZone: true }, "('2026-01-01T00:00:00Z')"],
      ['token', 'uniqueidentifier', { kind: 'uuid' }, "('8b3c0c4e-1f2a-4b5c-9d6e-7f8091a2b3c4')"],
    ] as const
    const { form, bindings } = generateForm(
      snapshot((objects) => {
        for (const [name, databaseType, type, expression] of kinds)
          addColumn(objects, 'order', col(name, databaseType, type as NormalizedType, { nullable: true, hasDefault: true, defaultExpression: expression }))
      }),
      ORDER,
    )
    const started = form.model.fields.filter((entry) => entry.default !== undefined).map((entry) => entry.key)
    for (const key of started) {
      const entry = form.model.fields.find((candidate) => candidate.key === key) as FieldDef
      const binding = bindings.fields.find((candidate) => candidate.field === key)
      expect({ key, taken: binding === undefined ? 'no binding' : startingValue(binding, entry, entry.default as StartingValue) }).toEqual({
        key,
        taken: { ok: true, answer: entry.default },
      })
    }
    // The kinds 0149 reads a constant of, and no other.
    expect(started).toEqual(['status', 'words', 'count', 'price', 'flag'])
  })

  // The question 0150 asks of its own check: if it and formancy's engine
  // ever disagreed, would anybody find out? Every candidate below is put
  // through applyPresentation; each one it takes is one the released
  // validator and engine take too, and a fresh form starts the field at it.
  // A value only the engine would take -- the server refusing more than the
  // browser, as 0008 lets it -- is not asked about. Watched failing with
  // the box's length left unasked: the engine refused ab😀 for code, three
  // characters the column holds and four UTF-16 code units its box does not.
  test('every starting value it takes is one formancy’s validator and engine take, and a fresh form starts at it', () => {
    const candidates: Record<string, unknown[]> = {
      status: ['draft', 'x'.repeat(20), 'x'.repeat(21), ' ', 'ü', '😀', 7, true, 'a\tb', 'a\nb', 'a\u007fb'],
      amount: ['9.5000', '-0.0001', '99999999999999.9999', '0.0000', '9.5', '100000000000000.0000', '1e3', 9.5],
      notes: ['None so far.', 'x'.repeat(5000), '', false, 'a\nb', 'a\tb', 'a\r\nb', 'a\u0001b'],
      created_by: [0, -2147483648, 2147483647, 2147483648, 1.5, '7'],
      paid: [true, false, 'true', 1],
      rush: ['true', 'false', true, 'yes'],
      code: ['abc', 'ab😀', '😀😀', 'abcd'],
    }
    const { form, bindings } = generateForm(snapshot(both(rush, code)), ORDER)
    let taken = 0
    for (const [key, values] of Object.entries(candidates)) {
      const binding = bindings.fields.find((entry) => entry.field === key)
      if (binding?.kind !== 'column') throw new Error(`no column field ${key}`)
      for (const value of values) {
        const applied = applyPresentation(form, one(key, { kind: 'column', column: binding.column }, value), bindings)
        if (!applied.ok) continue
        taken += 1
        const checked = validateSchema(applied.form)
        const started = applied.form.model.fields.find((entry) => entry.key === key) as FieldDef
        expect({ key, value, valid: checked.valid ? [] : checked.errors, accepts: acceptsDefault(started) }).toEqual({ key, value, valid: [], accepts: true })
        const fresh = createFormEngine({ schema: applied.form, capabilities: CAPABILITIES }).value() as Record<string, unknown>
        expect(fresh[key]).toEqual(value)
      }
    }
    // The candidates are worth asking: most are taken, and the rest are not.
    expect(taken).toBe(21)
  })

  // The one decision the studio asks before it sets a value, applyPresentation
  // after: the canonical answer, which may be spelled otherwise, or the
  // refusal applyPresentation says it in. Watched failing with the value
  // handed back as given: 9.5, which the studio would then set and the
  // publish refuse.
  test('startingValue gives the canonical answer, or the refusal a publish says', () => {
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const of = (key: string) => [bindings.fields.find((entry) => entry.field === key), form.model.fields.find((entry) => entry.key === key)] as const
    const [amount, amountField] = of('amount')
    const [status, statusField] = of('status')
    if (amount === undefined || amountField === undefined || status === undefined || statusField === undefined) throw new Error('no amount or status')
    expect(startingValue(amount, amountField, '9.5')).toEqual({ ok: true, answer: '9.5000' })
    expect(startingValue(status, statusField, 'x'.repeat(21))).toEqual({
      ok: false,
      problem: `“${'x'.repeat(21)}” is not an answer status takes (at most 20 characters, counting an emoji as two)`,
    })
  })

  // A regeneration carries a starting value by its column: unchanged, it
  // comes through; the column's default changed in the database, the
  // person's is kept and said (`both-changed`); the column's default now
  // the person's, the override goes without a word; a column dropped takes its
  // starting value with it (`field-gone`). Watched failing with the
  // starting value left out of the carried overrides: nothing came through.
  test('a regeneration carries a starting value by its column, keeping the person’s where the column’s default changed too', () => {
    const drafted = publish((form) => {
      field(form, 'status')['default'] = 'draft'
    })
    const same = regenerate(drafted)
    expect({ conflicts: same.conflicts, fields: same.presentation.fields }).toEqual({ conflicts: [], fields: drafted.presentation.fields })
    const changed = regenerate(drafted, startsAt('open'))
    expect(changed.conflicts).toEqual([
      {
        kind: 'both-changed',
        field: 'status',
        property: 'default',
        yours: 'draft',
        generator: 'open',
        resolution: 'kept-yours',
        message: 'You started status at “draft”, and the generator now starts it at “open”; yours is kept.',
      },
    ])
    expect(field(changed.form, 'status')['default']).toBe('draft')
    const agreed = regenerate(drafted, startsAt('draft'))
    expect({ conflicts: agreed.conflicts, fields: agreed.presentation.fields }).toEqual({ conflicts: [], fields: [] })
    // The column's default gone, the person's stands, and nothing is said: the field starts where it did.
    const gone = regenerate(drafted, startsAt(null))
    expect({ conflicts: gone.conflicts, fields: gone.presentation.fields }).toEqual({ conflicts: [], fields: drafted.presentation.fields })
    const dropped = regenerate(drafted, (objects) => dropColumn(objects, 'order', 'status'))
    expect(dropped.conflicts).toEqual([
      expect.objectContaining({
        kind: 'field-gone',
        field: 'status',
        property: 'default',
        yours: 'draft',
        message: 'The starting value “draft” you chose for status was dropped: column status is not in the regenerated form.',
      }),
    ])
  })

  // A key renumbers when a colliding column goes (0030): the starting value
  // follows the column, under its new key. Watched failing with the value
  // carried only where the key stayed: note_text started empty.
  test('a starting value follows its column to the key it now has', () => {
    const twice = (objects: ObjectMeta[]) => {
      addColumn(objects, 'order', col('note text', 'nvarchar(40)', text(40), { nullable: true }))
      addColumn(objects, 'order', col('note-text', 'nvarchar(40)', text(40), { nullable: true }))
    }
    const published = publish((form) => {
      field(form, 'note_text_2')['default'] = 'Fragile'
    }, twice)
    const rebased = regenerate(published, (objects) => {
      twice(objects)
      dropColumn(objects, 'order', 'note text')
    })
    expect(rebased.conflicts).toEqual([expect.objectContaining({ kind: 'field-rekeyed', field: 'note_text', from: 'note_text_2' })])
    expect(rebased.presentation.fields).toEqual([{ field: 'note_text', anchor: { kind: 'column', column: 'note-text' }, default: 'Fragile' }])
    expect(field(rebased.form, 'note_text')['default']).toBe('Fragile')
  })

  // A value the regenerated field no longer takes would make the carried
  // presentation one no publish accepts, and the rebase throw: the column
  // now holds less, or a create no longer writes it. It is dropped and
  // said in the words a publish refuses it in. Watched failing with every
  // starting value carried: the rebase threw "the carried presentation
  // does not apply to the regenerated base".
  test('a starting value the regenerated field no longer takes is dropped and said', () => {
    const published = publish((form) => {
      field(form, 'status')['default'] = 'draft'
    })
    const shorter = regenerate(published, (objects) => retype(objects, 'order', 'status', 'nvarchar(3)', text(3)))
    expect(shorter.conflicts).toEqual([
      {
        kind: 'default-dropped',
        field: 'status',
        anchor: STATUS,
        yours: 'draft',
        reason: '“draft” is not an answer status takes (at most 3 characters, counting an emoji as two)',
        resolution: 'dropped',
        message:
          'The starting value “draft” you chose for status was dropped: “draft” is not an answer status takes (at most 3 characters, counting an emoji as two).',
      },
    ])
    expect(shorter.presentation.fields).toEqual([])
    const unwritten = regenerate(published, (objects) => restrict(objects, 'order', 'status', { insert: false }))
    expect(unwritten.conflicts).toEqual([
      expect.objectContaining({ kind: 'default-dropped', reason: 'status takes no starting value: a create does not write it, so the database fills it' }),
    ])
  })

  // A value whose stored value the regenerated field takes as it is, only
  // held otherwise by its control, is carried in the new spelling and said
  // (`default-respelled`): a whole number whose column is now a bigint,
  // held as text; a yes or no now nullable, a select of “true” and “false”;
  // a decimal whose scale grew. Dropped only where the new field refuses
  // the stored value. Watched failing with every new spelling dropped:
  // “dropped: created_by now reads it back as “7””, which nobody can act on.
  test('a value the regenerated field stores the same is respelled and said, not dropped', () => {
    const counted = publish((form) => {
      field(form, 'created_by')['default'] = 7
      field(form, 'paid')['default'] = true
      field(form, 'amount')['default'] = '9.5000'
    })
    const rebased = regenerate(counted, (objects) => {
      retype(objects, 'order', 'created_by', 'bigint', INT64)
      column(objects, 'order', 'paid').nullable = true
      retype(objects, 'order', 'amount', 'decimal(20,6)', decimal(20, 6))
    })
    expect(rebased.conflicts).toEqual([
      {
        kind: 'default-respelled',
        field: 'amount',
        anchor: { kind: 'column', column: 'amount' },
        yours: '9.5000',
        now: '9.500000',
        resolution: 'followed',
        message: 'The starting value “9.5000” you chose for amount is now “9.500000”: the regenerated field holds it so, and a save stores the same value.',
      },
      expect.objectContaining({
        kind: 'default-respelled',
        field: 'created_by',
        yours: 7,
        now: '7',
        message:
          'The starting value the number 7 you chose for created_by is now the text “7”: the regenerated field holds it so, and a save stores the same value.',
      }),
      expect.objectContaining({ kind: 'default-respelled', field: 'paid', yours: true, now: 'true' }),
    ])
    expect(rebased.presentation.fields.map((entry) => [entry.field, entry.default])).toEqual([
      ['amount', '9.500000'],
      ['created_by', '7'],
      ['paid', 'true'],
    ])
    const narrowed = regenerate(counted, (objects) => retype(objects, 'order', 'amount', 'decimal(18,2)', decimal(18, 2)))
    expect(narrowed.conflicts).toEqual([
      expect.objectContaining({
        kind: 'default-dropped',
        field: 'amount',
        reason: '“9.5000” is not an answer amount takes (at most 2 digits after the decimal point)',
      }),
    ])
  })
})

describe('a starting value on a state field (0150)', () => {
  const policy = (moves: Array<{ from: string | null; to: string }>): FormPolicy => ({
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: {},
    rowFilters: [],
    lookups: {},
    transitions: { field: 'status', moves: moves.map((move) => ({ ...move, roles: ['clerk'] })) },
  })
  const entry = (key: string, value: unknown): FieldPresentation =>
    ({ field: key, anchor: { kind: 'column', column: key }, default: value }) as FieldPresentation

  // A create that gives the state field a value is a move from nothing
  // (0112), so a starting value no such move reaches is served to nobody
  // (0149's startingDefaults) while the presentation says it starts there.
  // Refused at publish, as a label for a state no move names is (0129);
  // another field and a policy with no state field are not asked about. A whole number is compared by its digits. Watched failing with
  // the moves unasked: shipped was taken.
  test('refuses one no create starts a record in, naming the states one does', () => {
    const moves = policy([
      { from: null, to: 'draft' },
      { from: null, to: 'placed' },
      { from: 'draft', to: 'placed' },
      { from: 'placed', to: 'shipped' },
    ])
    expect(createStates(moves.transitions?.moves ?? [])).toEqual(['draft', 'placed'])
    expect(startingStateProblems([entry('notes', 'shipped'), entry('status', 'shipped')], moves)).toEqual([
      "/fields/1/default: no create starts a record in “shipped”; the policy's moves from nothing reach “draft”, “placed”.",
    ])
    expect(startingStateProblems([entry('status', 'placed')], moves)).toEqual([])
    const { transitions: _, ...unmoved } = moves
    expect(startingStateProblems([entry('status', 'shipped')], unmoved)).toEqual([])
    expect(startingStateProblems([entry('status', 'draft')], policy([{ from: 'draft', to: 'placed' }]))).toEqual([
      "/fields/0/default: no create starts a record in “draft”; the policy's moves from nothing reach none.",
    ])
    expect(startingStateProblems([entry('status', 1)], policy([{ from: null, to: '1' }]))).toEqual([])
  })

  // What a publish takes on the state field and what the form route then
  // serves a person who may make every move are one decision: a value the
  // publish takes and the route never serves would be a starting value
  // nobody sees. Over values spelled every way a client could send one.
  // Watched failing with the two readings apart: the publish took the
  // boolean true for a state spelled “true”, which the route serves nobody.
  test('a publish takes exactly the starting states the form route serves', () => {
    const moves = [
      { from: null, to: 'draft' },
      { from: null, to: '1' },
      { from: null, to: 'true' },
      { from: 'draft', to: 'shipped' },
    ]
    const served = (value: StartingValue) => {
      const form = { ...generateForm(snapshot(), ORDER).form }
      const fields = form.model.fields.map((entry) => (entry.key === 'status' ? { ...entry, default: value } : entry))
      const started = startingDefaults({ ...form, model: { ...form.model, fields } }, ['status'], { field: 'status', moves, labels: [] })
      return started.model.fields.find((entry) => entry.key === 'status')?.default !== undefined
    }
    for (const value of ['draft', 'shipped', 1, '1', 2, true, 'true', false] as const) {
      expect({ value, published: startingStateProblem(policy(moves), 'status', value) === null }).toEqual({ value, published: served(value) })
    }
  })
})
