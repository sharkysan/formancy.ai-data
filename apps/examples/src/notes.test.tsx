import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { generateForm } from '@formancy/data-core'
import type { GeneratedForm, GenerationRequest } from '@formancy/data-core'
import { GenerationNotes, NOTE_KINDS } from './notes.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'
import { paragraphs } from './test-accessible.js'

/**
 * The notes panel over generations the page does not show.
 *
 * The page's two forms are both create-only, and neither excludes a column, so
 * a panel that always printed "Update: not offered" or never listed an
 * exclusion would pass every test of the page. These generate from the same
 * snapshot what the fixture can produce otherwise -- a confirmed version
 * column, a view, a table with columns no form can hold -- and hold the panel
 * to what the generator said.
 */
afterEach(cleanup)

function generated(table: string, extra: Partial<GenerationRequest> = {}): GeneratedForm {
  return generateForm(FIXTURE_SNAPSHOT, {
    connection: 'fixture',
    root: { schema: 'sales', name: table },
    formId: `sales-${table.replaceAll('_', '-')}`,
    title: table,
    lookups: [],
    ...extra,
  })
}

function shown(form: GeneratedForm): { operations: string[]; kinds: Record<string, string[] | string> } {
  render(
    <section aria-labelledby="t">
      <h2 id="t">sales.example</h2>
      <GenerationNotes generated={form} tableId="t" />
    </section>,
  )
  const notes = screen.getByRole('region', { name: 'sales.example What the generator chose' })
  const text = (items: HTMLElement[]): string[] => items.map((item) => item.textContent ?? '')
  return {
    operations: text(within(within(notes).getByRole('list', { name: 'Operations' })).getAllByRole('listitem')),
    kinds: Object.fromEntries(
      NOTE_KINDS.map(({ kind, heading, none }) => {
        const list = within(notes).queryByRole('list', { name: heading })
        // An empty kind has no list, and says so in a sentence: found as a
        // paragraph, by role, since a paragraph may not be named.
        const said = paragraphs(notes).includes(none) ? none : `no list, and no "${none}"`
        return [kind, list === null ? said : text(within(list).getAllByRole('listitem'))]
      }),
    ),
  }
}

function expected(form: GeneratedForm): { operations: string[]; kinds: Record<string, string[] | string> } {
  const { create, update } = form.bindings.operations
  return {
    operations: [`Create: ${create ? 'offered' : 'not offered'}`, `Update: ${update ? 'offered' : 'not offered'}`],
    kinds: Object.fromEntries(
      NOTE_KINDS.map(({ kind, none }) => {
        const notes = form.notes.filter((note) => note.kind === kind)
        return [kind, notes.length === 0 ? none : notes.map((note) => `${note.subject} ${note.message}`)]
      }),
    ),
  }
}

describe('the notes panel says what the generator said', () => {
  // Update is offered once the version column is confirmed (0009). A panel that
  // printed the page's usual answer would contradict the bindings here.
  test('for an order whose version column is confirmed: create and update offered, nothing blocked', () => {
    const form = generated('order', {
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      versionColumn: 'row_version',
    })
    expect(form.bindings.operations).toEqual({ create: true, update: true })
    expect(shown(form)).toEqual(expected(form))
  })

  // A view is read-only end to end, and every one of its fields says so.
  test('for a view: neither operation, and every field read-only', () => {
    const form = generated('customer_summary')
    expect(form.bindings.operations).toEqual({ create: false, update: false })
    expect(shown(form)).toEqual(expected(form))
  })

  // What the database limits for this connection is its own kind (0027). The
  // owner's order form has nothing there, and says so rather than leaving the
  // heading out; a view always says that its tables' row security is not
  // followed. A panel that dropped the fifth kind would hide both.
  test('the access kind is shown: empty with its sentence for the order, and the view note for a view', () => {
    const order = generated('order', { lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }] })
    const access = NOTE_KINDS.find((entry) => entry.kind === 'access')
    expect(shown(order).kinds['access']).toBe(access?.none)
    cleanup()
    const view = generated('customer_summary')
    expect(view.notes.filter((note) => note.kind === 'access').map((note) => note.subject)).toEqual(['customer_summary'])
    expect(shown(view)).toEqual(expected(view))
  })

  // An excluded column has no field, so the note is the only place a reviewer
  // learns that a binary flag and a point were left out, and why.
  test('for a table with columns no form can hold: each exclusion, with its reason', () => {
    const form = generated('country')
    expect(form.notes.filter((note) => note.kind === 'excluded').map((note) => note.subject)).toEqual(['flag', 'shape'])
    expect(shown(form)).toEqual(expected(form))
  })
})
