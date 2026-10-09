import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createAdminClient } from './api.js'
import type { Proposal, ProposalRequest } from './api.js'
import { NOTE_KINDS } from './generate.js'
import { audit, chooseOrder, discover, generateOrder, paragraphs, signIn, step } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Steps 3 and 4: choosing what to generate, and what the generator chose.
 *
 * Every choice is offered from the snapshot and sent to the real server's
 * generator, and the result is compared with what that generator says for the
 * same request -- asked directly, so the comparison is with the server and not
 * with a copy of its output.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

async function proposalFromServer(request: ProposalRequest): Promise<Proposal> {
  const outcome = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose(request)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value
}

async function toChoose(user: User, connection = 'fixture'): Promise<HTMLElement> {
  await discover(user, connection)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  return step('Choose')
}

async function goToChoose(user: User): Promise<HTMLElement> {
  await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '2. Choose' }))
  return step('Choose')
}

function list(container: HTMLElement, name: string): string[] {
  return within(within(container).getByRole('list', { name })).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

describe('choosing', () => {
  // A relationship whose target this connection cannot see is listed and
  // disabled with the gap that explains it. Left out, it would read as a
  // table with no relationship to customers, which is the one wrong answer.
  test('lists a lookup whose target is out of sight, disabled, with the reason', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-reader')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    const customer = within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' })
    expect(customer).toHaveProperty('disabled', true)
    expect(customer.getAttribute('aria-describedby')).not.toBeNull()
    expect(paragraphs(choose)).toContain(
      'tenant_id, customer_no → sales.customer. sales.customer is not visible to this connection: this account holds no privilege on it that a form could read or write with.',
    )
    expect(await audit()).toEqual([])
  })

  // The display column is suggested, and the suggestion is the
  // administrator's to change: what is sent is what is checked, in the
  // target's column order.
  test('suggests a display column, and sends the one confirmed', async () => {
    const user = await signIn(plane)
    const choose = await chooseOrder(user)
    expect((within(choose).getByLabelText('Form id') as HTMLInputElement).value).toBe('sales-order')
    const shown = within(choose).getByRole('group', { name: 'Columns to show for fk_order_customer' })
    expect(within(shown).getByRole('checkbox', { name: 'name' })).toHaveProperty('checked', true)
    await user.click(within(shown).getByRole('checkbox', { name: 'customer_no' }))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Inferred')).toContain('customer A lookup over fk_order_customer (tenant_id, customer_no), showing customer_no, name of customer; label from the table name.')
    expect(await audit()).toEqual([])
  })

  // The pinned columns go to the generator, which shows such a field
  // read-only: without that, a NOT NULL tenant column is a required field the
  // policy refuses every value for (0011, PR #17).
  test('sends the pinned columns, and the generator shows them read-only', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user)
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' }))
    expect((within(choose).getByLabelText('Attribute tenant_id is pinned to') as HTMLInputElement).value).toBe('tenant')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Read-only')).toContain('tenant_id Pinned by the policy: its value comes from the trusted context, never from the person filling the form.')
    expect(plane.requests.filter((request) => request.path === '/v1/form-proposals')).toHaveLength(1)
  })

  // PostgreSQL has no rowversion. Without a confirmed version column the
  // generator offers no update, and says why; confirmed, update is offered.
  test('offers update only once a version column is confirmed', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user)
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    let generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: not offered'])
    expect(list(generated, 'Blocked')).toEqual(['order Update is not offered until row_version is confirmed as a version column.'])

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '2. Choose' }))
    await user.selectOptions(within(step('Choose')).getByLabelText('Version column'), 'row_version')
    await user.click(within(step('Choose')).getByRole('button', { name: 'Generate the form' }))
    generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: offered'])
  })

  // SQL Server keeps a rowversion, which the database changes on every update:
  // there is nothing to confirm, the studio says so instead of asking, and
  // update is offered.
  test('asks for no version column where the database keeps a rowversion', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-sqlserver')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    expect(within(choose).queryByLabelText('Version column')).toBeNull()
    expect(paragraphs(choose)).toContain(
      'sales.order has a rowversion column, row_version: the database changes it on every update, so a stale save is detected with nothing to confirm.',
    )
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: offered'])
  })

  // What the studio can see is wrong is said, all of it, and nothing is
  // sent: a lookup showing nothing, a form with no title, a pin to no
  // attribute.
  test('names every mistake it can see before anything is sent', async () => {
    const user = await signIn(plane)
    const choose = await chooseOrder(user)
    const sent = plane.requests.length
    await user.click(within(within(choose).getByRole('group', { name: 'Columns to show for fk_order_customer' })).getByRole('checkbox', { name: 'name' }))
    await user.clear(within(choose).getByLabelText('Title'))
    await user.clear(within(choose).getByLabelText('Attribute tenant_id is pinned to'))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    expect(within(within(choose).getByRole('alert')).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The form needs a title.',
      'fk_order_customer needs at least one column to show.',
      'Name the trusted attribute tenant_id is pinned to.',
    ])
    expect(plane.requests.length).toBe(sent)
  })

  // Another root is another form: what was generated, pinned and granted for
  // the order means nothing for the customer, so it goes, and the steps that
  // needed it wait again. The root says so before it is changed: a policy
  // vanishing with no word is work lost.
  test('starts afresh when the root changes, and says so first', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    const choose = await goToChoose(user)
    const root = within(choose).getByLabelText('Root table or view')
    expect(computeAccessibleDescription(root)).toBe('Choosing another root replaces the form generated from sales.order, and its policy.')
    await user.selectOptions(root, 'sales.customer')
    expect(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' })).toHaveProperty('checked', false)
    const steps = screen.getByRole('navigation', { name: 'Steps' })
    expect(within(steps).getByRole('button', { name: '4. Policy' })).toHaveProperty('disabled', true)
  })

  // The notes are the review screen's content (0009): each kind is its own
  // list holding exactly the server generator's notes of that kind, in its
  // order, and an empty kind is said.
  test("shows the generator's notes by kind, exactly as the server wrote them", async () => {
    const user = await signIn(plane)
    const generated = await generateOrder(user)
    const proposal = await proposalFromServer({
      connection: 'fixture',
      root: { schema: 'sales', name: 'order' },
      formId: 'sales-order',
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      pinned: ['tenant_id'],
      versionColumn: 'row_version',
    })
    const notes = within(generated).getByRole('region', { name: 'What the generator chose' })
    for (const kind of NOTE_KINDS) {
      const expected = proposal.notes.filter((note) => note.kind === kind.kind).map((note) => `${note.subject} ${note.message}`)
      if (expected.length === 0) expect(paragraphs(notes)).toContain(kind.none)
      else expect(list(notes, kind.heading)).toEqual(expected)
    }
  })

  // A choice the generator cannot honour comes back as its sentence; and one
  // the studio can see is wrong is never sent at all.
  test('shows a refusal in the generator’s words, and sends nothing it can see is wrong', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user)
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('checkbox', { name: 'Pin row_version' }))
    await user.selectOptions(within(choose).getByLabelText('Version column'), 'row_version')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    expect((await within(choose).findByRole('alert')).textContent).toContain('row_version cannot be a version column: a field is bound to it')

    const sent = plane.requests.length
    await user.clear(within(choose).getByLabelText('Form id'))
    await user.type(within(choose).getByLabelText('Form id'), 'Sales Order')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    expect(within(choose).getByRole('alert').textContent).toMatch(/The form id must start with a lower-case letter/)
    expect(plane.requests.length).toBe(sent)
    expect(await audit()).toEqual([])
  })
})
