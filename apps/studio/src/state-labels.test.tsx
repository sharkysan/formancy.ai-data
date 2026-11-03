import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { createAdminClient } from './api.js'
import { audit, generateOrder, goTo, signIn, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The labels of a state field's states (0129), in the Presentation step:
 * a box for each state the Policy step's moves name, published as the
 * presentation's `states`, and none for a policy without moves. Against
 * the real server behind a fake `fetch`, as the moves' own suite is.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** Adds a move and types it in: an empty `from` is a move that starts a new record. */
async function addMove(user: User, policy: HTMLElement, n: number, from: string, to: string): Promise<void> {
  await user.click(within(policy).getByRole('button', { name: 'Add a move' }))
  if (from !== '') await user.type(within(policy).getByLabelText(`From in move ${String(n)}`), from)
  await user.type(within(policy).getByLabelText(`To in move ${String(n)}`), to)
  await user.type(within(policy).getByLabelText(`Roles that may make move ${String(n)}`), 'clerk')
}

/** The labels as the server holds them in the latest version of the order form. */
async function published(): Promise<unknown> {
  const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
  if (!latest.ok) throw new Error(latest.message)
  const { bundle } = latest.value
  return bundle.format === 2 ? bundle.presentation.states : 'a format-1 bundle'
}

describe('state labels in the Presentation step', () => {
  // A box for each state the moves name, in their order; what is typed is
  // kept without the spaces around it, an empty box is the state as its
  // column spells it, and the publish sends what is kept. Watched failing
  // with the labels left out of the publish: version 1 held none.
  test('label each state the policy’s moves name, and publish the labels', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await writeOrderPolicy(user)
    await user.selectOptions(within(policy).getByLabelText('State field'), 'status')
    await addMove(user, policy, 1, '', 'placed')
    await addMove(user, policy, 2, 'placed', 'shipped')

    const presentation = await goTo(user, 'Presentation')
    const panel = within(presentation).getByRole('region', { name: 'State labels' })
    expect(
      within(panel)
        .getAllByRole('textbox')
        .map((box) => box.getAttribute('id')),
    ).toEqual(['state-label-0', 'state-label-1'])
    await user.type(within(panel).getByLabelText('Label of placed'), ' Placed ')
    await user.type(within(panel).getByLabelText('Label of shipped'), 'On its way')
    await user.clear(within(panel).getByLabelText('Label of shipped'))
    await user.type(within(panel).getByLabelText('Label of shipped'), 'On its way')
    expect(within(panel).getByLabelText('Label of placed')).toHaveProperty('value', ' Placed ')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    expect(await published()).toEqual([
      { state: 'placed', label: 'Placed' },
      { state: 'shipped', label: 'On its way' },
    ])
  })

  // No moves, no states to label: the panel is not drawn. And a label of a
  // state the policy no longer names is neither shown nor published, which
  // the server would refuse. Watched failing with every kept label
  // published: shipped's was refused as no state the moves name.
  test('draws nothing without moves, and publishes no label of a state the policy dropped', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    expect(within(await goTo(user, 'Presentation')).queryByRole('region', { name: 'State labels' })).toBeNull()

    const again = await goTo(user, 'Policy')
    await user.selectOptions(within(again).getByLabelText('State field'), 'status')
    await addMove(user, again, 1, '', 'placed')
    await addMove(user, again, 2, 'placed', 'shipped')
    const presentation = await goTo(user, 'Presentation')
    const panel = within(presentation).getByRole('region', { name: 'State labels' })
    await user.type(within(panel).getByLabelText('Label of placed'), 'Placed')
    await user.type(within(panel).getByLabelText('Label of shipped'), 'Shipped')
    const dropped = await goTo(user, 'Policy')
    await user.click(within(dropped).getByRole('button', { name: 'Remove move 2' }))
    expect(within(await goTo(user, 'Presentation')).getByRole('region', { name: 'State labels' })).toBeTruthy()
    expect(within(within(await goTo(user, 'Presentation')).getByRole('region', { name: 'State labels' })).queryByLabelText('Label of shipped')).toBeNull()

    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    expect(await published()).toEqual([{ state: 'placed', label: 'Placed' }])
  })
})
