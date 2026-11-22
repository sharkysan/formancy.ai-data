import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { validatePolicy } from '@formancy/data-core'
import type { FormBindings, FormPolicy } from '@formancy/data-core'
import { NO_DELETE, NOBODY_DELETES, SAVED_WITH, TOGETHER_NOTE } from './policy-bulk.js'
import { audit, discover, generateOrder, goTo, grantOrderDelete, offerOnly, signIn, step, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Policy step's part of deleting chosen records together (0173,
 * 0174): who may, from the roles given delete, nobody until a box is
 * ticked, and nothing offered where a delete of one record is not --
 * against the real server behind a fake `fetch`, as every suite here runs,
 * and published through it. Elements are found by role and name.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const LEGEND = 'Who may delete chosen records together'
const grants = (policy: HTMLElement): HTMLElement => within(policy).getByRole('group', { name: LEGEND })
const checkSays = (policy: HTMLElement) => within(within(policy).getByRole('region', { name: 'Policy check' }))
const fits = async (policy: HTMLElement): Promise<void> => {
  await waitFor(() => expect(checkSays(policy).getByRole('status').textContent).toMatch(/fits this form/))
}

/** Publish version `n` from the Publish step, and the bundle the studio sent for it. */
async function publish(user: User, n: number): Promise<{ policy: FormPolicy; bindings: FormBindings }> {
  const here = await goTo(user, 'Publish')
  await user.click(await within(here).findByRole('button', { name: `Publish version ${String(n)}` }))
  await within(here).findByText(`Published version ${String(n)} of sales-order.`)
  const sent = plane.requests.findLast((request) => request.path === '/v1/forms/sales-order/versions')?.body as {
    bundle: { policy: FormPolicy; bindings: FormBindings }
  }
  return sent.bundle
}

/** The Choose step on the fixture with `root` chosen and `foreignKeys` alone offered as lookups. */
async function chooseRoot(user: User, root: string, foreignKeys: readonly string[]): Promise<HTMLElement> {
  await discover(user)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const here = step('Choose')
  await user.selectOptions(within(here).getByLabelText('Root table or view'), root)
  await offerOnly(user, here, foreignKeys)
  return here
}

describe('who may delete chosen records together', () => {
  // Nobody, until a box is ticked: before delete is granted the group says
  // what it waits for and offers no box; once clerk may delete, clerk's box
  // is there unticked, read with what deleting together does, and the
  // policy published without it has no `bulk` -- absent is nobody's, and a
  // server older than 0173 still reads it. Ticked, the grant published is
  // exactly `bulk.delete.roles`, which validatePolicy accepts against the
  // bindings it was published with, as the server did. Axe and a name on
  // every control in each state. Watched failing with the box's change
  // left unwritten ("expected undefined to deeply equal { delete: { roles:
  // [ 'clerk' ] } }"), and with an unticked last box kept as an empty
  // grant ('expected { version: 1, …(6) } to not have property "bulk"').
  test('is nobody by default, a box for each role given delete, and publishes exactly the roles ticked', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await writeOrderPolicy(user)
    expect(within(grants(policy)).queryAllByRole('checkbox')).toEqual([])
    expect(within(grants(policy)).getByText(NOBODY_DELETES)).toBeTruthy()
    await grantOrderDelete(user, policy)
    const clerk = within(grants(policy)).getByRole<HTMLInputElement>('checkbox', { name: 'clerk' })
    expect(clerk.checked).toBe(false)
    expect(computeAccessibleDescription(clerk)).toBe(TOGETHER_NOTE)
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.click(clerk)
    await user.click(clerk)
    await fits(policy)
    expect((await publish(user, 1)).policy).not.toHaveProperty('bulk')

    const again = await goTo(user, 'Policy')
    await user.click(within(grants(again)).getByRole('checkbox', { name: 'clerk' }))
    await fits(again)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    const sent = await publish(user, 2)
    expect(sent.policy.bulk).toEqual({ delete: { roles: ['clerk'] } })
    expect(validatePolicy(sent.policy, sent.bindings)).toEqual({ ok: true })
  })

  // Delete taken from the role the grant names: its box stays, ticked and
  // described by why the server refuses it, and the policy check says so
  // in validatePolicy's words until it is unticked, when nobody may delete
  // either way -- the keys the delete acted through, still accepted, are
  // the check's other business. Watched failing with the boxes drawn from
  // the delete roles alone: the grant vanished from the step while the
  // check still refused it, with nothing to untick ('Unable to find an
  // accessible element with the role "checkbox" and name "clerk"').
  test('keeps a ticked role that may no longer delete, described by why it is refused, until unticked', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await writeOrderPolicy(user)
    await grantOrderDelete(user, policy)
    await user.click(within(grants(policy)).getByRole('checkbox', { name: 'clerk' }))
    await user.clear(within(policy).getByLabelText('Roles that may delete'))
    const refusal = 'bulk.delete grants clerk, who may not delete with this form: each chosen record is a delete of its own'
    await waitFor(() => expect(checkSays(policy).getByText(refusal)).toBeTruthy())
    const clerk = within(grants(policy)).getByRole<HTMLInputElement>('checkbox', { name: 'clerk' })
    expect(clerk.checked).toBe(true)
    expect(computeAccessibleDescription(clerk)).toMatch(/^clerk may not delete with this form, so the server refuses this grant until it is unticked/)
    expect([...(await audit()), ...unnamed()]).toEqual([])
    await user.click(clerk)
    await waitFor(() => expect(checkSays(policy).queryByText(refusal)).toBeNull())
    expect(within(grants(policy)).queryByRole('checkbox', { name: 'clerk' })).toBeNull()
    expect(within(grants(policy)).getByText(NOBODY_DELETES)).toBeTruthy()
  })

  // Nothing to tick where a delete of one record is not offered, each said
  // why before anybody looks for a box: a customer, which offers no delete
  // at all, and an order's delivery saved with its order (0155), whose
  // rows are deleted only in that save -- 0173 refuses a grant on either.
  // Watched failing with `offers()` asked in place of `offeredFor`: the
  // delivery offered clerk's box, and never said why it should not be
  // ticked ('Unable to find an element with the text: Rows of this form
  // are deleted only with the record…').
  test('offers nothing on a form with no delete, nor on rows saved with their record, and says why', async () => {
    const user = await signIn(plane)
    const customer = await chooseRoot(user, 'sales.customer', [])
    await user.click(within(customer).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const plain = await goTo(user, 'Policy')
    expect(within(grants(plain)).getByText(NO_DELETE)).toBeTruthy()
    expect(within(grants(plain)).queryAllByRole('checkbox')).toEqual([])
    expect([...(await audit()), ...unnamed()]).toEqual([])

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '1. Connect' }))
    const delivery = await chooseRoot(user, 'sales.delivery', ['fk_delivery_order'])
    await user.click(within(delivery).getByRole('checkbox', { name: 'Rows of this form are saved with their order' }))
    await user.selectOptions(within(delivery).getByLabelText('Version column'), 'row_version')
    await user.click(within(delivery).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const saved = await goTo(user, 'Policy')
    await user.type(within(saved).getByLabelText('Roles that may delete'), 'clerk')
    expect(within(grants(saved)).getByText(SAVED_WITH)).toBeTruthy()
    expect(within(grants(saved)).queryAllByRole('checkbox')).toEqual([])
    expect([...(await audit()), ...unnamed()]).toEqual([])
  })
})
