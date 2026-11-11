import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createAdminClient } from './api.js'
import { audit, discover, focusedName, generateOrder, goTo, pressEnter, signIn, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * A field's starting value (0150) in the Presentation step, against the
 * real server behind a fake fetch: what the generator started each field
 * with is said, another value or none is set through the session, a value
 * the field does not take is said under its box and set nowhere, and the
 * preview and the published form start with what was chosen. The order
 * is the fixture's owner's, whose status starts at its column's `draft`.
 *
 * Found by role and accessible name, but for one thing: a field that
 * takes no starting value has no control to name, and the sentence saying
 * why is read from its row's text.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The step's own status line, which says each edit. */
const said = (presentation: HTMLElement) => within(presentation).getByRole('status').textContent

/** The row of the field whose label box is `Label of <key>`. */
const row = (presentation: HTMLElement, key: string) => within(presentation).getByLabelText(`Label of ${key}`).closest('li') as HTMLElement

/** A control of the preview's paper, by its label. */
async function previewed(user: User): Promise<(label: string) => HTMLInputElement> {
  const preview = await goTo(user, 'Preview')
  const sheet = within(preview).getByRole('form', { name: /preview$/ })
  return (label) => within(sheet).getByLabelText<HTMLInputElement>(label)
}

describe("a field's starting value", () => {
  // Each field says what the generator started it with, as its note says
  // it, and a box takes another: text, an exact decimal set as a record
  // holding it reads back -- “9.5000” for 9.5, the typing kept in the box
  // -- and a whole number. The preview starts a new form at each, and the
  // publish keeps them in the presentation, over the column's draft.
  // Watched failing with the box left out of the step: there was no
  // Starting value of status.
  test('says what each field starts with, takes another, and the preview and the publish start there', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const presentation = await goTo(user, 'Presentation')
    const status = within(presentation).getByLabelText<HTMLInputElement>('Starting value of status')
    expect(status.value).toBe('draft')
    expect(computeAccessibleDescription(status)).toBe("Generated: Starts with the column's default, “draft”.")
    expect(computeAccessibleDescription(within(presentation).getByLabelText('Starting value of notes'))).toBe(
      'Generated: starts empty. Empty, a new record starts it empty.',
    )
    // No control where none is taken, and the reason said in the row.
    for (const [key, why] of [
      ['customer', "a lookup's answer is a record, and the one a starting value names may be one the person filling the form in may not choose"],
      ['order_date', 'one is offered for text, a whole or exact number and yes or no, and this is a date'],
      ['id', 'a create does not write it, so the database fills it'],
    ] as const) {
      expect(within(presentation).queryByLabelText(`Starting value of ${key}`)).toBeNull()
      expect(row(presentation, key).textContent).toContain(`No starting value: ${why}.`)
    }
    await user.clear(status)
    await user.type(status, 'placed')
    expect(said(presentation)).toBe('Gave status the starting value “placed”.')
    expect(within(presentation).getByRole('button', { name: 'Use the column’s default for status' })).toBeTruthy()
    const amount = within(presentation).getByLabelText<HTMLInputElement>('Starting value of amount')
    await user.type(amount, '9.5')
    expect(said(presentation)).toBe('Gave amount the starting value “9.5000”.')
    expect(amount.value).toBe('9.5')
    await user.type(within(presentation).getByLabelText('Starting value of created_by'), '7')
    expect(said(presentation)).toBe('Gave created_by the starting value “7”.')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    const control = await previewed(user)
    expect({ status: control('Status').value, amount: control('Amount').value, created: control('Created by').value }).toEqual({
      status: 'placed',
      amount: '9.5000',
      created: '7',
    })

    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
    if (!latest.ok) throw new Error(latest.message)
    const { bundle } = latest.value
    if (bundle.format !== 2) throw new Error(`published as format ${String(bundle.format)}, not 2`)
    expect(bundle.presentation.fields.filter((entry) => entry.default !== undefined)).toEqual([
      { field: 'status', anchor: { kind: 'column', column: 'status' }, default: 'placed' },
      { field: 'amount', anchor: { kind: 'column', column: 'amount' }, default: '9.5000' },
      { field: 'created_by', anchor: { kind: 'column', column: 'created_by' }, default: 7 },
    ])
    expect(bundle.form.model.fields.find((field) => field.key === 'status')?.default).toBe('placed')
    expect(bundle.base.model.fields.find((field) => field.key === 'status')?.default).toBe('draft')
  })

  // The column's default is never taken away (0150): a field left empty is
  // left out of a create, which stores the default the person never saw.
  // Emptied, the box says so and the field keeps the value it had; Use the
  // column's default gives the column's back by one press, then goes, and
  // the keyboard is on the box it set. Undo and Redo take the box with
  // them. Watched failing with an emptied box taking the default away:
  // nothing was refused; and with the button left without its focus: the
  // keyboard fell to the page.
  test('keeps a default when its box is emptied, saying why, and gives the column’s back by keyboard', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    let presentation = await goTo(user, 'Presentation')
    const box = within(presentation).getByLabelText<HTMLInputElement>('Starting value of status')
    await user.tripleClick(box)
    await user.paste('placed')
    await user.clear(box)
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(computeAccessibleDescription(box)).toContain(
      'Left empty, a new record would store the column’s default, “draft”, without showing it. Until it has a value, the field keeps the starting value it had.',
    )
    expect((await previewed(user))('Status').value).toBe('placed')
    presentation = await goTo(user, 'Presentation')
    await pressEnter(user, within(presentation).getByRole('button', { name: 'Use the column’s default for status' }))
    expect(said(presentation)).toBe('Gave status the column’s default, “draft”.')
    const status = within(presentation).getByLabelText<HTMLInputElement>('Starting value of status')
    expect(status.value).toBe('draft')
    expect(focusedName()).toBe('Starting value of status')
    expect(within(presentation).queryByRole('button', { name: 'Use the column’s default for status' })).toBeNull()
    await user.click(within(presentation).getByRole('button', { name: 'Undo' }))
    expect(status.value).toBe('placed')
    await user.click(within(presentation).getByRole('button', { name: 'Redo' }))
    expect(status.value).toBe('draft')
    expect(await audit()).toEqual([])
    expect((await previewed(user))('Status').value).toBe('draft')
  })

  // A value the field does not take is said under the box, which names it
  // and is marked invalid, in the words a publish would refuse it in; the
  // typing is kept, and the document keeps what it had, so the preview
  // starts where it did. Watched failing with the value handed to the
  // session unread: “seven” was refused in the validator's words alone,
  // “Must be a number.”, and 21 characters would have reached the paper.
  test('says a value the field does not take under its box, and sets nothing', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const presentation = await goTo(user, 'Presentation')
    const created = within(presentation).getByLabelText<HTMLInputElement>('Starting value of created_by')
    await user.type(created, 'seven')
    expect(created.getAttribute('aria-invalid')).toBe('true')
    expect(created.value).toBe('seven')
    expect(computeAccessibleDescription(created)).toBe(
      'Generated: starts empty. Empty, a new record starts it empty. “seven” is not an answer created_by takes (its control holds a whole number). Until it is one, the field keeps the starting value it had.',
    )
    const status = within(presentation).getByLabelText<HTMLInputElement>('Starting value of status')
    await user.tripleClick(status)
    await user.paste('x'.repeat(21))
    expect(computeAccessibleDescription(status)).toContain(
      `“${'x'.repeat(21)}” is not an answer status takes (at most 20 characters). Until it is one, the field keeps the starting value it had.`,
    )
    expect(said(presentation)).toBe('')
    expect(await audit()).toEqual([])
    const control = await previewed(user)
    expect({ status: control('Status').value, created: control('Created by').value }).toEqual({ status: 'draft', created: '' })
  })

  // A yes or no starts ticked or not, chosen from its own two, and never
  // at none where its column has a default: the customer's Active, whose
  // column defaults to true, would be drawn unticked and stored true.
  // Watched failing with the choice handed on as its option's text: Not
  // ticked set nothing, the column's codec refusing the text “false” for a
  // yes or no; and with None still offered: the choice listed None first.
  test('offers a yes or no with a default its own two, and the preview starts there', async () => {
    const user = await signIn(plane)
    await discover(user)
    await user.click(screen.getByRole('button', { name: 'Choose a root' }))
    const choose = screen.getByRole('main', { name: 'Choose' })
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.customer')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const presentation = await goTo(user, 'Presentation')
    const active = within(presentation).getByRole<HTMLSelectElement>('combobox', { name: 'Starting value of active' })
    expect(
      within(active)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Ticked', 'Not ticked'])
    expect(active.value).toBe('true')
    await user.selectOptions(active, 'Not ticked')
    expect(said(presentation)).toBe('Gave active the starting value “false”.')
    expect((await previewed(user))('Active').checked).toBe(false)
    const again = await goTo(user, 'Presentation')
    await user.selectOptions(within(again).getByRole('combobox', { name: 'Starting value of active' }), 'Ticked')
    expect(said(again)).toBe('Gave active the starting value “true”.')
    expect(await audit()).toEqual([])
    expect((await previewed(user))('Active').checked).toBe(true)
  })

  // On the policy's state field, a starting value is a state a create
  // starts a record in (0112), or the box refuses it naming the states one
  // does, as the publish would. Watched failing with the moves unasked:
  // shipped was set.
  test('starts a state field only where a create may start a record', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await writeOrderPolicy(user)
    await user.selectOptions(within(policy).getByLabelText('State field'), 'status')
    await user.click(within(policy).getByRole('button', { name: 'Add a move' }))
    await user.type(within(policy).getByLabelText('To in move 1'), 'placed')
    await user.type(within(policy).getByLabelText('Roles that may make move 1'), 'clerk')
    const presentation = await goTo(user, 'Presentation')
    const status = within(presentation).getByLabelText<HTMLInputElement>('Starting value of status')
    await user.tripleClick(status)
    await user.paste('shipped')
    expect(computeAccessibleDescription(status)).toContain(
      "“shipped” cannot start status: no create starts a record in “shipped”; the policy's moves from nothing reach “placed”. Until it is one, the field keeps the starting value it had.",
    )
    await user.tripleClick(status)
    await user.paste('placed')
    expect(said(presentation)).toBe('Gave status the starting value “placed”.')
    expect(status.getAttribute('aria-invalid')).toBe('false')
  })
})
