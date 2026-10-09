import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { validatePolicy } from '@formancy/data-core'
import type { FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { Proposal } from './api.js'
import { audit, generateOrder, goTo, signIn, step, writeOrderPolicy } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 5, the policy: an editor for `FormPolicy`, judged on every change by
 * `validatePolicy` -- the function the server runs on publish -- and every
 * problem shown in its words.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

function check(policy: HTMLElement): { summary: string; problems: string[] } {
  const region = within(policy).getByRole('region', { name: 'Policy check' })
  const list = within(region).queryByRole('list', { name: 'Policy check' })
  return {
    summary: within(region).getByRole('status').textContent ?? '',
    problems: list === null ? [] : within(list).getAllByRole('listitem').map((item) => item.textContent ?? ''),
  }
}

/** The order's bindings, as the server generates them, to ask validatePolicy what it says. */
async function orderProposal(): Promise<Proposal> {
  const outcome = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose({
    connection: 'fixture',
    root: { schema: 'sales', name: 'order' },
    formId: 'sales-order',
    title: 'Order',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
    pinned: ['tenant_id'],
    versionColumn: 'row_version',
  })
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value
}

describe('the policy editor', () => {
  // A lookup that sets the pinned tenant column must pin the customer's
  // tenant too, or a clerk could choose another tenant's customer and write
  // its tenant into this one. Remove that filter and the editor says exactly
  // what validatePolicy says, in its words -- and publishing waits.
  test('refuses a policy that does not fit the form, in validatePolicy’s words', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await writeOrderPolicy(user)
    expect(check(policy)).toEqual({ summary: 'The policy fits this form.', problems: [] })

    await user.click(within(policy).getByRole('button', { name: 'Remove Customer filter 1' }))
    const broken: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
      fields: {},
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: { customer: [] },
    }
    const said = validatePolicy(broken, (await orderProposal()).bindings)
    expect(said.ok).toBe(false)
    expect(check(policy)).toEqual({
      summary: '1 problem: the server refuses this policy until it is fixed.',
      problems: said.ok ? [] : said.problems,
    })
    expect(check(policy).problems).toEqual([
      'lookups.customer must pin sales.customer.tenant_id to tenant, because customer sets tenant_id, which a row filter pins to tenant',
    ])
    expect(await audit()).toEqual([])

    const publish = await goTo(user, 'Publish')
    expect(within(publish).getByRole('button', { name: 'Publish version 1' })).toHaveProperty('disabled', true)
    expect(within(publish).getByRole('note').textContent).toContain('The policy has 1 problem')
  })

  // Each kind of mistake a person can make in the editor is named: an
  // operation the form does not offer, a filter with no attribute. Not "the
  // policy is invalid" -- a person fixes a policy from the list.
  test('names every problem at once', async () => {
    const user = await signIn(plane)
    await discoverAndGenerateWithoutVersion(user)
    const policy = await goTo(user, 'Policy')
    await user.type(within(policy).getByLabelText('Roles that may update'), 'clerk')
    await user.clear(within(policy).getByLabelText('Trusted attribute of row filter 1'))
    expect(check(policy).problems).toEqual(['rowFilters[0] names no attribute'])
    await user.type(within(policy).getByLabelText('Trusted attribute of row filter 1'), 'tenant')
    expect(check(policy).problems).toEqual(['operations.update grants roles, and this form does not offer update'])
  })

  // Typing a list keeps what was typed: a box that re-wrote "clerk, " to
  // "clerk" as it parsed would swallow the comma before the next role.
  test('keeps a list of roles as it is typed', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await goTo(user, 'Policy')
    const read = within(policy).getByLabelText('Roles that may read')
    await user.type(read, 'clerk, manager')
    expect((read as HTMLInputElement).value).toBe('clerk, manager')
    await user.click(within(policy).getByRole('button', { name: 'Fill every field from the operations' }))
    expect((within(policy).getByLabelText('Read roles for Order date') as HTMLInputElement).value).toBe('clerk, manager')
    // A field the form never writes has nothing to grant, and says so.
    expect(within(policy).queryByLabelText('Write roles for Id')).toBeNull()
  })

  // The row filters are the generator's pins. Change them after generating
  // and the form and the policy disagree about which fields a person fills
  // in; the studio says so, publishing waits, and generating again agrees.
  test('says when the pins changed since generation, and generates again', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    let policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Add a row filter' }))
    await user.selectOptions(within(policy).getByLabelText('Column of row filter 2'), 'status')
    expect(within(policy).getByRole('note').textContent).toMatch(/generated with other pinned columns/)

    const publish = await goTo(user, 'Publish')
    expect(within(publish).getByRole('note').textContent).toContain('The row filters changed since the form was generated')

    policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Generate again with these pins' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    const readOnly = within(within(generated).getByRole('list', { name: 'Read-only' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(readOnly).toContain('status Pinned by the policy: its value comes from the trusted context, never from the person filling the form.')
    expect(within(await goTo(user, 'Policy')).queryByRole('note')).toBeNull()
    expect(await audit()).toEqual([])
  })

  // Pinning the confirmed version column cannot be generated: the generator
  // refuses, and its sentence is shown where the button was pressed rather
  // than nowhere.
  test('shows a regeneration the generator refuses, in its words', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Add a row filter' }))
    await user.selectOptions(within(policy).getByLabelText('Column of row filter 2'), 'row_version')
    await user.click(within(policy).getByRole('button', { name: 'Generate again with these pins' }))
    expect((await within(policy).findByRole('alert')).textContent).toBe('The form was not generated: row_version cannot be a version column: a field is bound to it')
  })
})

describe('what the editor writes', () => {
  // Offering every customer is a decision, so a lookup the policy says
  // nothing about is refused until somebody makes it -- and then it is
  // written as made.
  test('refuses an undecided lookup until somebody decides it', async () => {
    const user = await signIn(plane)
    const choose = await toChooseOrder(user)
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const policy = await goTo(user, 'Policy')
    expect(check(policy).problems).toEqual(['lookups has no entry for customer: say which rows of sales.customer it may offer, or [] for every row'])
    await user.click(within(policy).getByRole('button', { name: 'Offer every row of sales.customer' }))
    expect(check(policy).problems).toEqual([])
    expect(within(policy).getByText('Every row of sales.customer is offered.')).toBeTruthy()
  })

  // A field's roles, typed one field at a time, are the published policy's:
  // read and write as typed, and a field left with neither not written at
  // all -- nobody's, by default, rather than an entry granting nothing.
  test('publishes the roles typed for each field', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const policy = await writeOrderPolicy(user)
    const read = within(policy).getByLabelText('Read roles for Status')
    const write = within(policy).getByLabelText('Write roles for Status')
    await user.clear(read)
    await user.type(read, 'auditor, clerk')
    await user.clear(write)
    await user.type(write, 'clerk')
    await user.clear(within(policy).getByLabelText('Read roles for Group'))
    await user.clear(within(policy).getByLabelText('Write roles for Group'))
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
    if (!latest.ok) throw new Error(latest.message)
    expect(latest.value.bundle.policy.fields['status']).toEqual({ read: ['auditor', 'clerk'], write: ['clerk'] })
    expect(Object.hasOwn(latest.value.bundle.policy.fields, 'group')).toBe(false)
  })
})

describe('a policy kept across a regeneration', () => {
  // Generating again keeps the policy, because a person's role assignments
  // are work. But a field the new form does not have is refused rather than
  // carried silently -- it was written for another form -- and the editor
  // lists it with a way to remove it.
  test('names what the new form no longer has, and removes it', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    const choose = await goTo(user, 'Choose')
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })

    const policy = await goTo(user, 'Policy')
    expect(check(policy).problems).toEqual(['fields.customer: the form has no field customer', 'lookups.customer: customer is not a lookup field of this form'])
    await user.click(within(policy).getByRole('button', { name: 'Remove customer' }))
    await user.click(within(policy).getByRole('button', { name: 'Remove the customer lookup filter' }))
    expect(check(policy)).toEqual({ summary: 'The policy fits this form.', problems: [] })
    expect(await audit()).toEqual([])
  })
})

/** The Choose step with sales.order chosen and nothing else. */
async function toChooseOrder(user: Awaited<ReturnType<typeof signIn>>): Promise<HTMLElement> {
  await user.click(within(step('Connect')).getByRole('button', { name: 'Discover fixture' }))
  await user.click(await screen.findByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
  return choose
}

/** The order with the tenant pinned and no version column: update is not offered. */
async function discoverAndGenerateWithoutVersion(user: Awaited<ReturnType<typeof signIn>>): Promise<void> {
  await user.click(within(step('Connect')).getByRole('button', { name: 'Discover fixture' }))
  await user.click(await screen.findByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
  await user.click(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' }))
  await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
  await screen.findByRole('main', { name: 'Generate' })
}
