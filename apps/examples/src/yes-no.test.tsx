import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { FormSchema } from '@formancy/spec'
import { generateForm } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'
import { previewEngine } from './engines.js'
import { REQUESTS } from './examples.js'
import { AngularPane, ReactPane } from './panes.js'
import { FIXTURE_SNAPSHOT } from './snapshot.js'
import { ANGULAR_ARRIVES } from './test-timing.js'

/**
 * A nullable boolean column, drawn as the generator draws it, under both
 * renderers (0095).
 *
 * The fixture has none -- `sales.customer.active` is NOT NULL, a checkbox --
 * so one is added to the captured snapshot here, as `vip`, with every
 * privilege, and the customer's form is generated from that, as the page
 * generates it. What is asserted is what a person can do with the field,
 * found by role and accessible name (formancy.ai 0034); what it stores is
 * read from the engine the test holds.
 */
afterEach(cleanup)

const CUSTOMER = REQUESTS.find((request) => request.root.name === 'customer')

function withVip(snapshot: MetadataSnapshot): MetadataSnapshot {
  const copy = structuredClone(snapshot)
  const customer = copy.objects.find((object) => object.ref.name === 'customer')
  if (customer === undefined) throw new Error('the fixture has no customer')
  customer.columns.push({
    name: 'vip',
    ordinal: Math.max(...customer.columns.map((column) => column.ordinal)) + 1,
    databaseType: 'boolean',
    type: { kind: 'boolean' },
    nullable: true,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
    access: { select: true, insert: true, update: true },
  })
  return copy
}

function customerForm(): FormSchema {
  if (CUSTOMER === undefined) throw new Error('the page generates no customer')
  return generateForm(withVip(FIXTURE_SNAPSHOT), CUSTOMER).form
}

/** The form with `vip` disabled the way a host disables a field the person may not write (`apps/host/src/widgets.ts`). */
function disabledVip(form: FormSchema): FormSchema {
  return { ...form, logic: { ...form.logic, rules: [...(form.logic?.rules ?? []), { target: 'vip', kind: 'disabled', cel: 'true' }] } }
}

describe.each([
  ['React', 'react', ReactPane],
  ['Angular', 'angular', AngularPane],
] as const)('a nullable yes/no field under %s', (_name, renderer, Pane) => {
  // The column holds yes, no or nothing, and the person must be able to give
  // each, back to nothing included: a radio group can be left unanswered but
  // never returned to it, so a person who chose Yes by mistake could save only
  // Yes or No where the database would hold NULL. Watched failing with the
  // radio group, which has no box named Vip to choose nothing in.
  test('an answer can be taken back to no answer', async () => {
    const engine = previewEngine(customerForm(), renderer)
    render(<Pane tableId="t" table="sales.customer" engine={engine} sources={{}} />)
    const user = userEvent.setup()

    const vip = await screen.findByRole('combobox', { name: 'Vip' }, ANGULAR_ARRIVES)
    expect(
      within(vip)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['', 'Yes', 'No'])
    await user.selectOptions(vip, 'Yes')
    expect((engine.value() as Record<string, unknown>)['vip']).toBe('true')
    await user.selectOptions(vip, '')
    expect((engine.value() as Record<string, unknown>)['vip'] ?? null).toBeNull()
  })

  // A field the person may not write is disabled by a rule, and the server
  // refuses a changed value in it (0022), so a control that still takes a
  // choice leads to a save refused for a change the page let them make.
  // formancy's radio group, through 0.7.0, disables none of its radios
  // (formancy.ai 0.7.0's CHANGELOG, hazard B6a); its select is disabled.
  // Watched failing with the radio group: both radios enabled.
  test('a rule that disables it leaves nothing to choose', async () => {
    const engine = previewEngine(disabledVip(customerForm()), renderer)
    render(<Pane tableId="t" table="sales.customer" engine={engine} sources={{}} />)

    await screen.findByRole('textbox', { name: /^Name/ }, ANGULAR_ARRIVES)
    const group = screen.queryByRole('group', { name: 'Vip' })
    const controls = group === null ? [screen.getByRole('combobox', { name: 'Vip' })] : within(group).getAllByRole('radio')
    expect(controls.map((control) => (control as HTMLInputElement | HTMLSelectElement).disabled)).toEqual(controls.map(() => true))
  })
})
