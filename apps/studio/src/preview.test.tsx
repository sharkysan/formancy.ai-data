import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { audit, generateOrder, goTo, paragraphs, signIn } from './test-studio.js'
import { startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 7, the preview: the generated document under the released
 * `@formancy/react`, in Blueprint on white paper -- what the people filling it
 * in will see, validated by the engine they will run.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

describe('the preview', () => {
  // Every field the server generated is drawn, by its label, in the form the
  // preview names. The theme is read from the DOM -- an attribute, which the
  // accessibility tree does not carry -- because it is the theme that makes
  // this the paper and not the studio.
  test('draws every generated field, in the Blueprint theme', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const preview = await goTo(user, 'Preview')
    const sheet = within(preview).getByRole('form', { name: 'Order preview' })
    expect(sheet.getAttribute('data-formancy-theme')).toBe('blueprint')
    for (const label of ['Id', 'Order date', 'Status', 'Amount', 'Notes', 'Group', 'Created by', 'Approved by']) {
      expect(within(sheet).getAllByLabelText(label).length, label).toBeGreaterThan(0)
    }
    // The lookup's list is the runtime plane's. The renderer says where the
    // chooser would be, and the page says why, rather than drawing an empty
    // list as if the table had no customers.
    expect(within(preview).getByRole('note').textContent).toMatch(/Customer list is filled by the runtime plane once the form is published/)
    expect(paragraphs(sheet)).toContain(`This field's answers come from "fixture-sales-order-fk-order-customer", which this application has not provided.`)
  })

  // Validate runs the engine the published form will run: a required field
  // left empty is an error a person can hear, on the control itself.
  test('validates with the engine, and the errors are audible', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const preview = await goTo(user, 'Preview')
    const sheet = within(preview).getByRole('form', { name: 'Order preview' })
    await user.click(within(sheet).getByRole('button', { name: 'Validate' }))
    const date = within(sheet).getByLabelText('Order date')
    await waitFor(() => expect(date.getAttribute('aria-invalid')).toBe('true'))
    expect(computeAccessibleDescription(date)).not.toBe('')
    expect(await audit()).toEqual([])
  })
})
