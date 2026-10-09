// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. These are claims about the
// documents the page is built from, checked before anything mounts them.
import { describe, expect, test } from 'vitest'
import type { ColumnMeta, FieldBinding, ObjectRef } from '@formancy/data-core'
import { unreferencedPaths } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { generateExamples } from './examples.js'
import type { Example } from './examples.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'

/**
 * The demo shows what it says it shows.
 *
 * formancy.ai's starter-demo test, for this page: its intro once said "every
 * field type the spec defines" over a document that could not contain three of
 * them, and nothing failed, because a demo that does not contain what it says
 * still renders. The page here says what it chose to show (`REQUESTS` in
 * examples.ts): the order, with the composite customer lookup, the exact
 * decimal past what a number holds and the integer past 2^53; and the
 * customer, the lookup's target, with a composite key and no version column.
 * Each of those is what a preview test leans on, so a request edited to a
 * simpler table would leave those tests proving less while still passing.
 *
 * Every fact is read from the snapshot and the bindings, never from the
 * wording above, so it cannot pass because a sentence appears.
 */
const EXAMPLES = generateExamples(FIXTURE_SNAPSHOT)

function tableOf(example: Example): string {
  return `${example.request.root.schema}.${example.request.root.name}`
}

function sameTable(left: ObjectRef, right: ObjectRef): boolean {
  return left.schema === right.schema && left.name === right.name
}

function example(name: string): Example {
  const found = EXAMPLES.find((candidate) => candidate.request.root.name === name)
  if (found === undefined) throw new Error(`the page generates no ${name}`)
  return found
}

/** The column a binding writes, as the snapshot describes it. */
function columnOf(subject: Example, binding: Extract<FieldBinding, { kind: 'column' }>): ColumnMeta {
  const column = FIXTURE_SNAPSHOT.objects
    .find((object) => sameTable(object.ref, subject.request.root))
    ?.columns.find((candidate) => candidate.name === binding.column)
  if (column === undefined) throw new Error(`${tableOf(subject)} has no column ${binding.column}`)
  return column
}

/** The type the form gives the field a binding fills. */
function fieldTypeOf(subject: Example, binding: FieldBinding): string | undefined {
  return subject.generated.form.model.fields.find((field) => field.key === binding.field)?.type
}

function columnBindings(subject: Example): Array<Extract<FieldBinding, { kind: 'column' }>> {
  return subject.generated.bindings.fields.filter((binding): binding is Extract<FieldBinding, { kind: 'column' }> => binding.kind === 'column')
}

describe.each(EXAMPLES.map((subject) => [tableOf(subject), subject] as const))('%s', (_table, subject) => {
  // The page must never open on an error screen. A generated document the
  // released validator refuses would make both renderers fail together --
  // which the parity tests would read as the two agreeing.
  test('is a document the released spec accepts', () => {
    expect(validateSchema(subject.generated.form)).toMatchObject({ valid: true })
  })

  // Both previews draw the document's first layout. A field the generator
  // emitted and that layout never places is invisible in both, and named here
  // by its path rather than as two control lists that differ.
  test('places every field in the layout both previews draw', () => {
    const layout = subject.generated.form.layouts?.[0]?.name
    expect(layout, 'the document has no layout to draw').toBeDefined()
    expect(unreferencedPaths(subject.generated.form, layout ?? '')).toEqual([])
  })
})

describe('the order', () => {
  // The lookup is the generator's most consequential choice on this table, and
  // a key of more than one column is where a token encoding goes wrong
  // (0012). The token test in previews.test.tsx proves only what is here.
  test('has a lookup over a key of more than one column, into the other example', () => {
    const lookups = example('order').generated.bindings.fields.filter((binding) => binding.kind === 'lookup')
    expect(lookups.map((binding) => binding.columns.length)).toEqual([2])
    expect(sameTable(lookups[0]?.target.table ?? { schema: '', name: '' }, example('customer').request.root)).toBe(true)
  })

  // An exact decimal with more digits than a double holds is why the generator
  // makes text with a pattern (0009), and the edge test in previews.test.tsx
  // types its largest value. A number field here would round it.
  test('has an exact decimal wider than a number holds, as text', () => {
    const order = example('order')
    const wide = columnBindings(order).filter((binding) => {
      const type = columnOf(order, binding).type
      return type.kind === 'decimal' && (type.precision ?? 0) > 15
    })
    expect(wide.length).toBeGreaterThan(0)
    expect(wide.map((binding) => fieldTypeOf(order, binding))).toEqual(wide.map(() => 'text'))
  })

  // An integer whose range passes 2^53 cannot round-trip through a JavaScript
  // number, which is the drift case 0010 blocks. The page shows how the
  // generator draws one.
  test('has an integer whose range passes 2^53, as text', () => {
    const order = example('order')
    const wide = columnBindings(order).filter((binding) => {
      const type = columnOf(order, binding).type
      return type.kind === 'integer' && BigInt(type.max) > BigInt(Number.MAX_SAFE_INTEGER)
    })
    expect(wide.length).toBeGreaterThan(0)
    expect(wide.map((binding) => fieldTypeOf(order, binding))).toEqual(wide.map(() => 'text'))
  })
})

describe('the customer', () => {
  // A composite identity with no version column is the shape where update has
  // to be refused rather than guessed (0009), and the notes beside it say so.
  test('is identified by more than one column and has no version column', () => {
    const { bindings } = example('customer').generated
    expect(bindings.identity?.length ?? 0).toBeGreaterThan(1)
    expect(bindings.concurrency).toBeNull()
    expect(bindings.operations.update).toBe(false)
  })
})
