import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { viewProblems } from '@formancy/data-core'
import type { ListView } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { Bundle, ProposalRequest } from './api.js'
import { audit, focusedName, generateOrder, goTo, paragraphs, pressEnter, signIn, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'
import { addCondition, addSort, nameView, opensTheGrid, pressSave, rows, savedViews, saveView, viewForm, viewsPanel } from './test-views.js'

/**
 * A form's list views (0105), made in the Presentation step: named
 * conditions and an order a person picks above the form's grid, built from
 * what the form's list offers, by the fields' labels, each condition's
 * boxes the Browse step's; checked by the server's own checks before they
 * are saved, kept in the workbench beside the session, and published in
 * the presentation, where the stored version holds them -- against the
 * real server behind the fake `fetch`.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** Signed in, the order generated as the journey generates it, and the Presentation step open. */
async function toViews(): Promise<User> {
  const user = await signIn(plane)
  await generateOrder(user)
  await goTo(user, 'Presentation')
  return user
}

/** The options of a select in `container`, as their text. */
const options = (container: HTMLElement, name: string) =>
  within(within(container).getByRole('combobox', { name }))
    .getAllByRole('option')
    .map((option) => option.textContent)

/** What the panel's live line last said. */
const said = () => within(viewsPanel()).getAllByRole('paragraph').find((paragraph) => paragraph.getAttribute('aria-live') === 'polite')?.textContent

/** The refusal under the form: its lead and each reason. */
function refusal(): string[] {
  const alert = within(viewForm()).getByRole('alert')
  return [...paragraphs(alert), ...within(alert).getAllByRole('listitem').map((item) => item.textContent ?? '')]
}

/** The bindings the studio generated, proposed again with the request it sent: what the server fits a view to. */
async function bindingsSent(): Promise<Bundle['bindings']> {
  const request = plane.requests.find((entry) => entry.method === 'POST' && entry.path === '/v1/form-proposals')?.body as ProposalRequest
  const proposal = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose(request)
  if (!proposal.ok) throw new Error(proposal.message)
  return proposal.value.bindings
}

describe('making a view', () => {
  // The whole path a view takes: made by keyboard in the panel, said in
  // words, kept while the person goes on to the policy, sent with the
  // presentation, and stored in the version the runtime serves -- exactly
  // the list request a picker will send, its name trimmed as a picker shows
  // it. Watched failing with the publish sending the presentation without
  // its views: version 1 held none.
  test('a view defined by keyboard publishes, and the stored version holds it', async () => {
    const user = await toViews()
    expect(paragraphs(viewsPanel()).slice(0, 2)).toEqual([
      'Named filters and sort orders a person can pick above this form’s grid. A person is offered a view only if they may read every field it names.',
      'No view yet.',
    ])
    await nameView(user, ' Placed, newest first ')
    await addCondition(user, 'Status', 'equals', { Value: 'placed' })
    await addSort(user, 'Order date', 'Descending')
    await opensTheGrid(user, true)
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await pressSave(user)
    expect(savedViews()).toEqual(['Placed, newest first: where Status = placed; sorted by Order date descending; opens the grid.'])
    expect(said()).toBe('Saved view 1, “Placed, newest first”.')
    // The form is emptied for the next view, and the keyboard is where it pressed.
    expect(focusedName()).toBe('Save view')
    expect(within(viewForm()).getByRole('textbox', { name: 'Name' })).toHaveProperty('value', '')
    expect(rows('Condition')).toEqual([])
    expect(rows('Sort')).toEqual([])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const stored = (await plane.store.read('sales-order', 1)) as Bundle
    if (stored.format !== 2) throw new Error('version 1 is not a format-2 bundle')
    const placed: ListView = { name: 'Placed, newest first', filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [{ field: 'order_date', direction: 'desc' }], default: true }
    expect(stored.presentation.views).toEqual([placed])
    // Back on the step, the view is still there: the workbench keeps it, not the panel.
    await goTo(user, 'Presentation')
    expect(savedViews()).toEqual(['Placed, newest first: where Status = placed; sorted by Order date descending; opens the grid.'])
  })

  // What a view may be built from is what the form's list offers anybody:
  // a lookup holds a token, not its label, and offers neither; each field
  // is named as the form labels it now, a label edited above included; and
  // each condition's operators, boxes and hint are the Browse step's for
  // the field's type and NULLs. A panel that offered the lookup would save
  // a view the server refuses; one that named fields by key would read
  // otherwise than the form the person sees.
  test('offers what the form’s list offers, by the form’s labels, with the Browse step’s boxes', async () => {
    const user = await toViews()
    const presentation = await goTo(user, 'Presentation')
    await user.clear(within(presentation).getByLabelText('Label of status'))
    await user.type(within(presentation).getByLabelText('Label of status'), 'State')
    const first = await addCondition(user, 'Order date', 'is in a range')
    expect(options(first, 'Field')).toEqual(['Id', 'Order date', 'State', 'Amount', 'Notes', 'Group', 'Created by', 'Approved by'])
    // A date that holds no NULL: two bounds, typed as dates, both included.
    expect(options(first, 'Condition')).toEqual(['equals', 'is in a range'])
    expect(within(first).getByLabelText('From')).toHaveProperty('type', 'date')
    expect(within(first).getByLabelText('To')).toHaveProperty('type', 'date')
    expect(computeAccessibleDescription(within(first).getByLabelText('From'))).toBe('From and To are both included, and either may be left empty.')

    // Text that holds NULLs: equality is the whole value, and text of no characters is a value.
    const second = await addCondition(user, 'Notes', 'is NULL')
    expect(options(second, 'Field')).not.toContain('Order date')
    expect(options(second, 'Condition')).toEqual(['equals', 'contains', 'is NULL', 'is not NULL'])
    expect(paragraphs(second)).toContain('Text of no characters is a value, not NULL.')
    await user.selectOptions(within(second).getByRole('combobox', { name: 'Condition' }), 'equals')
    expect(paragraphs(second)).toContain('The whole value, exactly: case and spaces count.')
    const sort = await addSort(user, 'State', 'Descending')
    expect(options(sort, 'Sort by')).toEqual(['Id', 'Order date', 'State', 'Amount', 'Notes', 'Group', 'Created by', 'Approved by'])
    expect(options(sort, 'Direction')).toEqual(['Ascending', 'Descending'])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await within(first).findByLabelText('From')
    await user.type(within(first).getByLabelText('From'), '2026-01-01')
    await nameView(user, 'This year')
    await pressSave(user)
    expect(savedViews()).toEqual(['This year: where Order date from 2026-01-01 and Notes = “”; sorted by State descending.'])
  })
})

describe('a view refused', () => {
  // The server fits a view to the bindings at publish (422 invalid-bundle);
  // the panel asks the same before it saves, so a view whose value its
  // column cannot hold is refused where it was typed, in the server's
  // words, with everything typed kept -- never at the last step, after the
  // person built the rest. Watched failing with the fit left out: the view
  // was saved, and only the publish refused it.
  test('a decimal the column cannot hold is refused before saving, the draft kept', async () => {
    const user = await toViews()
    await nameView(user, 'Large')
    const row = await addCondition(user, 'Amount', 'equals', { Value: '1.23456' })
    await pressSave(user)
    const large: ListView = { name: 'Large', filter: [{ field: 'amount', op: 'equals', value: '1.23456' }], sort: [] }
    const [problem] = viewProblems([large], await bindingsSent())
    expect(problem).toMatch(/^\/views\/0 \(“Large”\): .*amount/)
    expect(refusal()).toEqual(['The view was not saved:', problem])
    expect(savedViews()).toEqual([])
    expect(within(viewForm()).getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Large')
    expect(within(row).getByRole('textbox', { name: 'Value' })).toHaveProperty('value', '1.23456')
    expect(focusedName()).toBe('Save view')
    expect(await audit()).toEqual([])

    // Corrected and sent by Enter in its box, it is saved, and the refusal
    // goes. The box went with the emptied form, so the keyboard goes to
    // Save view rather than to the top of the page.
    await user.clear(within(row).getByRole('textbox', { name: 'Value' }))
    await user.type(within(row).getByRole('textbox', { name: 'Value' }), '1.25{Enter}')
    expect(savedViews()).toEqual(['Large: where Amount = 1.25.'])
    expect(within(viewForm()).queryByRole('alert')).toBeNull()
    expect(focusedName()).toBe('Save view')
  })

  // Every shape a picker could not show or a request could not carry is the
  // server's refusal too, said here in its words: a name with no words, one
  // another view has but for case, a view that says nothing, and a range
  // with neither bound. Saved, each would make the publish fail.
  test('refuses what the server refuses by shape, in its words', async () => {
    const user = await toViews()
    await saveView(user, 'Large', () => addCondition(user, 'Amount', 'is in a range', { From: '1000' }))
    expect(savedViews()).toEqual(['Large: where Amount from 1000.'])

    await nameView(user, '   ')
    await addSort(user, 'Amount', 'Descending')
    await pressSave(user)
    expect(refusal()).toEqual(['The view was not saved:', '/views/1/name needs words a person can read'])
    await nameView(user, 'LARGE')
    await pressSave(user)
    expect(refusal()).toEqual(['The view was not saved:', '/views/1/name: “LARGE” is another view’s name'])
    await pressEnter(user, within(rows('Sort')[0] as HTMLElement).getByRole('button', { name: 'Remove sort 1' }))
    await nameView(user, 'Nothing')
    await pressSave(user)
    expect(refusal()).toEqual(['The view was not saved:', '/views/1: says nothing; leave the view out'])
    await addCondition(user, 'Amount', 'is in a range')
    await pressSave(user)
    expect(refusal()).toEqual(['The view was not saved:', '/views/1/filter/0: A range on amount has a from, a to or both.'])
    expect(savedViews()).toEqual(['Large: where Amount from 1000.'])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })
})

describe('the rows of a view', () => {
  // A row added takes the keyboard to its field (addCondition holds that);
  // a row removed takes its button with it, so the keyboard goes to the
  // Remove that takes its place, and after the last to the button that adds
  // one -- never to the top of the page. Each row offers only fields no
  // other row names, since a list request names each field once, and with
  // every field taken the button is gone and the form says so.
  test('conditions and sorts are added and removed by keyboard, each field once', async () => {
    const user = await toViews()
    const first = await addCondition(user, 'Status', 'contains', { Text: 'pla' })
    await addCondition(user, 'Amount', 'is in a range', { To: '10' })
    expect(options(first, 'Field')).not.toContain('Amount')
    await pressEnter(user, within(first).getByRole('button', { name: 'Remove condition 1' }))
    expect(focusedName()).toBe('Remove condition 1')
    expect(within(rows('Condition')[0] as HTMLElement).getByRole('combobox', { name: 'Field' })).toHaveProperty('value', 'amount')
    expect(within(rows('Condition')[0] as HTMLElement).getByLabelText('To')).toHaveProperty('value', '10')
    await pressEnter(user, within(viewForm()).getByRole('button', { name: 'Remove condition 1' }))
    expect(rows('Condition')).toEqual([])
    expect(focusedName()).toBe('Add condition')

    await addSort(user, 'Order date')
    await addSort(user, 'Status', 'Descending')
    await pressEnter(user, within(viewForm()).getByRole('button', { name: 'Remove sort 2' }))
    expect(focusedName()).toBe('Add sort')
    await pressEnter(user, within(viewForm()).getByRole('button', { name: 'Remove sort 1' }))
    expect(focusedName()).toBe('Add sort')

    for (const field of ['Id', 'Order date', 'Status', 'Amount', 'Notes', 'Group', 'Created by', 'Approved by']) await addCondition(user, field, 'equals')
    expect(within(viewForm()).queryByRole('button', { name: 'Add condition' })).toBeNull()
    expect(paragraphs(viewForm())).toContain('Every field this list can be filtered by has a condition.')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })
})

describe('the views saved', () => {
  /** Three views, Placed opening the grid: the list moves, edits and removes work on. */
  async function three(user: User): Promise<void> {
    await saveView(user, 'Placed', () => addCondition(user, 'Status', 'equals', { Value: 'placed' }), true)
    await saveView(user, 'Large', () => addCondition(user, 'Amount', 'is in a range', { From: '1000' }))
    await saveView(user, 'Noted', () => addCondition(user, 'Notes', 'is not NULL'))
    expect(savedViews()).toEqual(['Placed: where Status = placed; opens the grid.', 'Large: where Amount from 1000.', 'Noted: where Notes is not NULL.'])
  }

  // A move keeps the keyboard on the view moved, as the arrangement's moves
  // keep it on the field: on the button pressed at the view's new place,
  // or on its partner where the move reached the end and disabled it. The
  // order is the picker's, so it is what is published.
  test('moves a view by keyboard, and the keyboard goes with it', async () => {
    const user = await toViews()
    await three(user)
    expect(within(viewsPanel()).getByRole('button', { name: 'Move view 1 up' })).toHaveProperty('disabled', true)
    expect(within(viewsPanel()).getByRole('button', { name: 'Move view 3 down' })).toHaveProperty('disabled', true)
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Move view 1 down' }))
    expect(savedViews().map((view) => view.split(':')[0])).toEqual(['Large', 'Placed', 'Noted'])
    expect(focusedName()).toBe('Move view 2 down')
    expect(said()).toBe('Moved view “Placed” down.')
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Move view 2 down' }))
    expect(savedViews().map((view) => view.split(':')[0])).toEqual(['Large', 'Noted', 'Placed'])
    expect(focusedName()).toBe('Move view 3 up')
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Move view 3 up' }))
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Move view 2 up' }))
    expect(savedViews().map((view) => view.split(':')[0])).toEqual(['Placed', 'Large', 'Noted'])
    expect(focusedName()).toBe('Move view 1 down')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Edit puts a saved view back in the form, every box as it was saved, and
  // the keyboard on its name; saved, it replaces the view in its place. One
  // view opens the grid: checked on another, it moves there, and the
  // panel says from where -- two defaults would be the server's refusal.
  test('edits a view in place, and the grid opens on one view only', async () => {
    const user = await toViews()
    await three(user)
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Edit view 2' }))
    expect(within(viewsPanel()).getByRole('form', { name: 'Editing view 2, “Large”' })).toBeTruthy()
    expect(focusedName()).toBe('Name')
    const [row] = rows('Condition')
    if (row === undefined) throw new Error('the edited view has no condition row')
    expect(within(row).getByRole('combobox', { name: 'Field' })).toHaveProperty('value', 'amount')
    expect(within(row).getByRole('combobox', { name: 'Condition' })).toHaveProperty('value', 'range')
    expect(within(row).getByLabelText('From')).toHaveProperty('value', '1000')
    expect(await audit()).toEqual([])
    await user.clear(within(row).getByLabelText('From'))
    await user.type(within(row).getByLabelText('From'), '500')
    await opensTheGrid(user, true)
    await pressSave(user)
    expect(savedViews()).toEqual(['Placed: where Status = placed.', 'Large: where Amount from 500; opens the grid.', 'Noted: where Notes is not NULL.'])
    expect(said()).toBe('Saved view 2, “Large”, which opens the grid instead of “Placed”.')
    expect(within(viewsPanel()).getByRole('form', { name: 'New view' })).toBeTruthy()
    expect(focusedName()).toBe('Save view')

    // Renamed in place: its own old name is no conflict.
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Edit view 1' }))
    await nameView(user, 'PLACED')
    await pressSave(user)
    expect(savedViews()[0]).toBe('PLACED: where Status = placed.')
  })

  // A removed view takes its buttons with it: the keyboard goes to the
  // Remove that takes its place, after the last to the one before, and
  // with none left to the panel's heading. Removing the view being edited
  // empties the form, which would otherwise save it back under its name.
  test('removes a view by keyboard, and the keyboard stays in the list', async () => {
    const user = await toViews()
    await three(user)
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Edit view 1' }))
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Remove view 1' }))
    expect(savedViews().map((view) => view.split(':')[0])).toEqual(['Large', 'Noted'])
    expect(focusedName()).toBe('Remove view 1')
    expect(said()).toBe('Removed view “Placed”.')
    expect(within(viewsPanel()).getByRole('form', { name: 'New view' })).toBeTruthy()
    expect(within(viewForm()).getByRole('textbox', { name: 'Name' })).toHaveProperty('value', '')
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Remove view 2' }))
    expect(focusedName()).toBe('Remove view 1')
    await pressEnter(user, within(viewsPanel()).getByRole('button', { name: 'Remove view 1' }))
    expect(savedViews()).toEqual([])
    expect(focusedName()).toBe('List views')
    expect(paragraphs(viewsPanel())).toContain('No view yet.')
    expect(await audit()).toEqual([])

    // None left, the publish leaves the property out: `views: []` is a second spelling of none, which the server refuses.
    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const stored = (await plane.store.read('sales-order', 1)) as Bundle
    expect(stored.format === 2 && stored.presentation).not.toHaveProperty('views')
  })
})
