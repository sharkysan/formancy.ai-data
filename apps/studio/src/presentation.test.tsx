import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { nodesOfLayout, layoutChildrenAt } from '@formancy/builder-core'
import { validateBundle } from '@formancy/data-server'
import { createAdminClient } from './api.js'
import { audit, generateOrder, goTo, signIn, writeOrderPolicy } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 6, presentation: labels and arrangement, edited through the released
 * builder-core session with the studio's own controls (0024). What is held
 * here is the reason for that choice: nothing the step offers can remove,
 * rename or retype a bound field, and what it produces still publishes.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The labels of the order's main section, in the order the step lists them. */
function placed(presentation: HTMLElement): string[] {
  const section = within(presentation).getByRole('region', { name: 'Order' })
  return within(section)
    .getAllByRole('textbox')
    .map((box) => computeAccessibleName(box))
    .filter((name) => name.startsWith('Label of '))
    .map((name) => name.slice('Label of '.length))
}

describe('presentation', () => {
  // A label edited here is the label the people filling the form read: the
  // preview renders the session's document, not the generated one.
  test('relabels a field, and the preview shows the new label', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const presentation = await goTo(user, 'Presentation')
    const box = within(presentation).getByLabelText('Label of order_date')
    await user.clear(box)
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(computeAccessibleDescription(box)).toBe('A label needs words a person can read. Until it has some, it stays “Order date”.')
    await user.type(box, 'Ordered on')
    expect(box.getAttribute('aria-invalid')).toBe('false')
    const preview = await goTo(user, 'Preview')
    const sheet = within(preview).getByRole('form', { name: 'Order preview' })
    expect(within(sheet).getByLabelText('Ordered on')).toBeTruthy()
    expect(within(sheet).queryByLabelText('Order date')).toBeNull()
  })

  // Moving is a button, so it is a keystroke. The field keeps focus as it
  // moves, and at the end of the list -- where the button just pressed is
  // disabled -- focus goes to its partner rather than falling to the page.
  // Moving down, React takes the row holding the focused button out and puts
  // it back further on; jsdom and Chromium both drop the focus of a node
  // taken out, and React gives it back after the commit. The browser gate
  // presses Move down in Chromium too.
  test('moves a field by keyboard, and keeps the keyboard on it', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const presentation = await goTo(user, 'Presentation')
    const before = placed(presentation)
    expect(before.slice(0, 2)).toEqual(['customer', 'order_date'])
    within(presentation).getByRole('button', { name: 'Move down Customer' }).focus()
    await user.keyboard('{Enter}')
    expect(placed(presentation).slice(0, 2)).toEqual(['order_date', 'customer'])
    expect(computeAccessibleName(document.activeElement as Element)).toBe('Move down Customer')

    // The last field, up one and back down: at the end its Move down is
    // disabled, and focus is on its Move up.
    expect(before.at(-1)).toBe('approved_by')
    within(presentation).getByRole('button', { name: 'Move up Approved by' }).focus()
    await user.keyboard('{Enter}')
    expect(placed(presentation).slice(-2)).toEqual(['approved_by', 'created_by'])
    await user.keyboard('{Tab}{Enter}')
    expect(placed(presentation).slice(-2)).toEqual(['created_by', 'approved_by'])
    expect(within(presentation).getByRole('button', { name: 'Move down Approved by' })).toHaveProperty('disabled', true)
    expect(computeAccessibleName(document.activeElement as Element)).toBe('Move up Approved by')
    expect(await audit()).toEqual([])
  })

  // Undo is the session's own history: it restores the document, and the
  // boxes follow it.
  test('undoes and redoes through the session', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const presentation = await goTo(user, 'Presentation')
    const box = within(presentation).getByLabelText('Section label of Order')
    await user.type(box, 's')
    expect(within(presentation).getByRole('region', { name: 'Orders' })).toBeTruthy()
    await user.click(within(presentation).getByRole('button', { name: 'Undo' }))
    expect((within(presentation).getByLabelText('Section label of Order') as HTMLInputElement).value).toBe('Order')
    await user.click(within(presentation).getByRole('button', { name: 'Redo' }))
    expect(within(presentation).getByRole('status').textContent).toBe('Redone.')
    expect((within(presentation).getByLabelText('Section label of Orders') as HTMLInputElement).value).toBe('Orders')
    // At the end of the history the button stays, and keeps the keyboard:
    // it says there is nothing more rather than going dark under the focus.
    await user.click(within(presentation).getByRole('button', { name: 'Redo' }))
    expect(within(presentation).getByRole('status').textContent).toBe('Nothing to redo.')
    expect(computeAccessibleName(document.activeElement as Element)).toBe('Redo')
  })

  // The decision 0024 rests on: every control on this step is a label, a
  // move, a width, undo or redo -- nothing that adds, removes, renames or
  // retypes a field, which the bindings would no longer match. And what the
  // controls produce is a bundle the server publishes and serves back, its
  // presentation kept apart from the generated base (0030).
  test('offers nothing that could break a binding, and what it edits publishes', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const presentation = await goTo(user, 'Presentation')
    const named = (role: string) => within(presentation).queryAllByRole(role).map((element) => computeAccessibleName(element))
    expect(named('button').filter((name) => !/^(Undo|Redo|Move (up|down) .+)$/.test(name))).toEqual([])
    expect(named('textbox').filter((name) => !/^(Section label|Label) of .+$/.test(name))).toEqual([])
    expect(named('checkbox').filter((name) => !/^Full width for .+$/.test(name))).toEqual([])
    for (const role of ['combobox', 'listbox', 'radio', 'spinbutton', 'link', 'menuitem']) expect(named(role), role).toEqual([])

    await user.clear(within(presentation).getByLabelText('Label of notes'))
    await user.type(within(presentation).getByLabelText('Label of notes'), 'Remarks')
    await user.click(within(presentation).getByRole('checkbox', { name: 'Full width for Remarks' }))
    await user.click(within(presentation).getByRole('button', { name: 'Move up Amount' }))
    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')

    const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
    if (!latest.ok) throw new Error(latest.message)
    const { bundle } = latest.value
    if (bundle.format !== 2) throw new Error(`published as format ${String(bundle.format)}, not 2`)
    const { form, bindings } = bundle
    expect(validateBundle(bundle).ok).toBe(true)
    expect(form.model.fields.find((field) => field.key === 'notes')?.label).toBe('Remarks')
    // Every bound field is in the form and placed in the arrangement both renderers draw.
    const placedPaths = new Set<string>()
    const walk = (nodes: ReturnType<typeof nodesOfLayout>, path: number[]) =>
      nodes?.forEach((node, index) => (node.kind === 'field' ? placedPaths.add(node.path) : walk(layoutChildrenAt(form, 'default', [...path, index]), [...path, index])))
    walk(nodesOfLayout(form, 'default'), [])
    expect(bindings.fields.map((binding) => binding.field).filter((key) => !placedPaths.has(key))).toEqual([])
    const main = layoutChildrenAt(form, 'default', [0, 0])?.map((node) => (node.kind === 'field' ? node.path : node.kind))
    expect(main?.indexOf('amount')).toBe((main?.indexOf('status') ?? 0) - 1)
    // Since 0030 the three edits are kept as what they are -- a label, a
    // width, an order -- beside the generated base, so a regeneration can
    // carry them. A studio that published the edited form alone would have
    // nothing to carry, and every label would be lost at the next one.
    expect(bundle.presentation).toEqual({
      version: 1,
      fields: [{ field: 'notes', anchor: { kind: 'column', column: 'notes' }, label: 'Remarks', span: 'one' }],
      sections: [{ anchor: { label: 'Order', occurrence: 0 }, order: main }],
    })
    expect(bundle.base.model.fields.find((field) => field.key === 'notes')?.label).toBe('Notes')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
