import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { GROUP_LIMIT } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import { audit, generateOrder, goTo, signIn, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The group the form is listed under (0143), in the Presentation step: a
 * box that shows it -- the root schema's name in words, Sales for
 * sales.order, until another is typed -- and No group, published as the
 * presentation's `group`, and left out where it is the default. Against
 * the real server behind a fake `fetch`, which refuses the default
 * spelled out.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The group as the latest version of the order form holds it: `'left out'` where its presentation says nothing. */
async function published(): Promise<unknown> {
  const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
  if (!latest.ok) throw new Error(latest.message)
  const { bundle } = latest.value
  if (bundle.format !== 2) return 'a format-1 bundle'
  return Object.hasOwn(bundle.presentation, 'group') ? bundle.presentation.group : 'left out'
}

/** Publish the draft as version `n`. */
async function publishVersion(user: User, n: number): Promise<void> {
  const publish = await goTo(user, 'Publish')
  await user.click(await within(publish).findByRole('button', { name: `Publish version ${String(n)}` }))
  await within(publish).findByText(`Published version ${String(n)} of sales-order.`)
}

/** The Presentation step's Group region. */
async function groupPanel(user: User): Promise<HTMLElement> {
  return within(await goTo(user, 'Presentation')).getByRole('region', { name: 'Group' })
}

describe('the group in the Presentation step', () => {
  // The box shows what the form will be listed under before anything is
  // typed: the default, which the publish leaves out, as the server
  // requires. What is typed is kept without the spaces around it; No
  // group empties the box and publishes null; the default typed again is
  // the property left out again. Watched failing with the group left out
  // of the publish: version 2 held none, and with the default sent as
  // typed: version 1 was refused as the default spelled out.
  test('shows the default, and publishes a group typed, none, and the default as nothing', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    const panel = await groupPanel(user)
    const box = within(panel).getByRole('textbox', { name: 'Group' })
    expect(box).toHaveProperty('value', 'Sales')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await publishVersion(user, 1)
    expect(await published()).toBe('left out')

    await user.clear(within(await groupPanel(user)).getByRole('textbox', { name: 'Group' }))
    await user.type(within(await groupPanel(user)).getByRole('textbox', { name: 'Group' }), ' Orders ')
    expect(within(await groupPanel(user)).getByRole('textbox', { name: 'Group' })).toHaveProperty('value', ' Orders ')
    await publishVersion(user, 2)
    expect(await published()).toBe('Orders')

    await user.click(within(await groupPanel(user)).getByRole('button', { name: 'No group' }))
    expect(within(await groupPanel(user)).getByRole('textbox', { name: 'Group' })).toHaveProperty('value', '')
    await publishVersion(user, 3)
    expect(await published()).toBeNull()

    await user.type(within(await groupPanel(user)).getByRole('textbox', { name: 'Group' }), 'Sales')
    await publishVersion(user, 4)
    expect(await published()).toBe('left out')
  })

  // A group longer than the server keeps is refused in the box, in words,
  // and the form keeps the group it had, so the publish never sends what
  // the server would refuse. Watched failing with the length unchecked
  // here: the box took the 86 characters as the group, and said nothing.
  test('refuses a group past its length in words, keeping the one it had', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    const panel = await groupPanel(user)
    const box = within(panel).getByRole('textbox', { name: 'Group' })
    await user.clear(box)
    await user.type(box, 'Orders')
    await user.paste('x'.repeat(GROUP_LIMIT))
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(computeAccessibleDescription(box)).toBe(`A group is at most ${String(GROUP_LIMIT)} characters. Until it fits, the form stays under Orders.`)
    expect(await audit()).toEqual([])
    await publishVersion(user, 1)
    expect(await published()).toBe('Orders')
  })

  // The group is the form's, bound to no field: Generate again keeps it,
  // and a regeneration of a published version shows the one it carried
  // rather than the default. Watched failing with the group left at the
  // default on each: the box said Sales.
  test('is kept by Generate again and by a regeneration', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const box = within(await groupPanel(user)).getByRole('textbox', { name: 'Group' })
    await user.clear(box)
    await user.type(box, 'Orders')
    const policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Add a row filter' }))
    await user.selectOptions(within(policy).getByLabelText('Column of row filter 2'), 'group')
    await user.click(within(policy).getByRole('button', { name: 'Generate again with these pins' }))
    await screen.findByRole('main', { name: 'Generate' })
    expect(within(await groupPanel(user)).getByRole('textbox', { name: 'Group' })).toHaveProperty('value', 'Orders')

    await writeOrderPolicy(user)
    await publishVersion(user, 1)
    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
    const regenerated = await within(drift).findByRole('region', { name: 'Regenerated from version 1' })
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    const presentation = await screen.findByRole('main', { name: 'Presentation' })
    expect(within(within(presentation).getByRole('region', { name: 'Group' })).getByRole('textbox', { name: 'Group' })).toHaveProperty('value', 'Orders')
  })
})
