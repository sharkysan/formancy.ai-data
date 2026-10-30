import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
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
  return within(within(container).getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe('choosing', () => {
  // A relationship whose target this connection cannot see is listed and
  // disabled with the reason. Left out, it would read as a table with no
  // relationship to customers, which is the one wrong answer. SQL Server's
  // reader is the one whose catalog hides the target (0027): it sees the
  // key's own columns and not what it references, so the reason is that.
  test('lists a lookup whose target is out of sight, disabled, with the reason', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-sqlserver-reader')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    const customer = within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' })
    expect(customer).toHaveProperty('disabled', true)
    expect(customer.getAttribute('aria-describedby')).not.toBeNull()
    expect(paragraphs(choose)).toContain(
      'tenant_id, customer_no → an unknown target. This connection can see that the key exists but not what it references, so it cannot be offered.',
    )
    expect(await audit()).toEqual([])
  })

  // PostgreSQL's reader sees sales.customer and may read none of it (0027).
  // The generator refuses a lookup whose target key it cannot read, and a
  // root of which it may read nothing; offered anyway, both would end in a
  // refusal after the administrator had chosen everything else.
  test('disables a lookup over an unreadable target key, and a root the account may not read, each with its reason', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-reader')
    const root = within(choose).getByLabelText('Root table or view')
    const customerRoot = within(root).getByRole('option', { name: /^sales\.customer: / })
    expect(customerRoot).toHaveProperty('disabled', true)
    expect(customerRoot.textContent).toBe('sales.customer: This connection cannot read it: its account may SELECT none of its columns.')
    await user.selectOptions(root, 'sales.order')
    const lookup = within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' })
    expect(lookup).toHaveProperty('disabled', true)
    expect(paragraphs(choose)).toContain(
      'tenant_id, customer_no → sales.customer. tenant_id of sales.customer cannot be read by this connection, so its rows cannot be offered.',
    )
    expect(await audit()).toEqual([])
  })

  // The order form's own account (0027): row-level security binds it on
  // customer, it may not UPDATE amount, and it may still create and update.
  // The Generate step says each of these in its kind.
  test('on the writer, the order says the policy on customer, amount read-only on update, and offers both operations', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-writer')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
    await user.selectOptions(within(choose).getByLabelText('Version column'), 'row_version')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: offered', 'Delete: offered'])
    expect(list(generated, 'Access')).toContainEqual(expect.stringMatching(/^customer Row-level security applies to this connection on sales\.customer: /))
    expect(list(generated, 'Read-only')).toContain("amount Read-only on update: this connection's account may not UPDATE amount.")
    expect(await audit()).toEqual([])
  })

  // The writer may read three columns of customer (0027). The generator
  // refuses a lookup that shows one it may not read, after everything else
  // was chosen; the studio offers those columns disabled, with the reason
  // in each one's description, and the suggestion is a readable one.
  test("on the writer, a lookup's unreadable target columns are offered disabled, with the reason", async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-writer')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
    const shown = within(within(choose).getByRole('group', { name: 'Columns to show for fk_order_customer' })).getAllByRole('checkbox')
    const state = shown.map(
      (box) =>
        `${computeAccessibleName(box)}:${(box as HTMLInputElement).disabled ? 'disabled' : 'enabled'}${(box as HTMLInputElement).checked ? ',checked' : ''}`,
    )
    expect(state).toEqual([
      'tenant_id:enabled',
      'customer_no:enabled',
      'name:enabled,checked',
      'country_code:disabled',
      'credit_limit:disabled',
      'active:disabled',
      'created_at:disabled',
    ])
    const countryCode = within(choose).getByRole('checkbox', { name: 'country_code' })
    expect(computeAccessibleDescription(countryCode)).toBe('This connection may not read it, so it cannot be shown.')
    expect(await audit()).toEqual([])
  })

  // A label is its columns' text, and a bytea or a point has none: the
  // server's lookup config refuses a lookup that shows one, and so does the
  // generator (0066). Offered anyway, the column would end in a refusal
  // after everything else was chosen; the studio offers it disabled, with
  // the reason in its description, in the column's own type, and the lookup
  // generates over the suggested name (watched failing with every readable
  // column offered: flag and shape enabled).
  test("a lookup's target columns with no text form are offered disabled, with the reason", async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user)
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.customer')
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_customer_country as a lookup' }))
    const group = within(choose).getByRole('group', { name: 'Columns to show for fk_customer_country' })
    const state = within(group)
      .getAllByRole('checkbox')
      .map(
        (box) =>
          `${computeAccessibleName(box)}:${(box as HTMLInputElement).disabled ? 'disabled' : 'enabled'}${(box as HTMLInputElement).checked ? ',checked' : ''}`,
      )
    expect(state).toEqual(['id:enabled', 'iso_code:enabled', 'name:enabled,checked', 'flag:disabled', 'shape:disabled'])
    expect(computeAccessibleDescription(within(group).getByRole('checkbox', { name: 'flag' }))).toBe(
      'It is bytea, which has no text form for a label, so it cannot be shown.',
    )
    expect(computeAccessibleDescription(within(group).getByRole('checkbox', { name: 'shape' }))).toBe(
      'It is point, which has no text form for a label, so it cannot be shown.',
    )
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Inferred')).toContain(
      'country A lookup over fk_customer_country (country_code), showing name of country, drawn as a typeahead searching name; label from the table name.',
    )
    expect(await audit()).toEqual([])
  })

  // The display column is suggested, and the suggestion is the
  // administrator's to change: what is sent is what is checked, in the
  // target's column order. The note says which control those columns make:
  // a typeahead searching both, because a whole number is searched as its
  // text, as a name is (0066). This step is where the administrator learns
  // the control before anything is published, so a note naming a plain
  // list, or a search over a column the lookup does not show, fails here.
  test('suggests a display column, and sends the one confirmed', async () => {
    const user = await signIn(plane)
    const choose = await chooseOrder(user)
    expect(within(choose).getByLabelText<HTMLInputElement>('Form id').value).toBe('sales-order')
    const shown = within(choose).getByRole('group', { name: 'Columns to show for fk_order_customer' })
    expect(within(shown).getByRole('checkbox', { name: 'name' })).toHaveProperty('checked', true)
    await user.click(within(shown).getByRole('checkbox', { name: 'customer_no' }))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Inferred')).toContain(
      'customer A lookup over fk_order_customer (tenant_id, customer_no), showing customer_no, name of customer, drawn as a typeahead searching customer_no, name; label from the table name.',
    )
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
    expect(within(choose).getByLabelText<HTMLInputElement>('Attribute tenant_id is pinned to').value).toBe('tenant')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Read-only')).toContain(
      'tenant_id Pinned by the policy: its value comes from the trusted context, never from the person filling the form.',
    )
    expect(plane.requests.filter((request) => request.path === '/v1/form-proposals')).toHaveLength(1)
  })

  // PostgreSQL has no rowversion. Without a confirmed version column the
  // generator offers no update and no delete, and says why, as the choice
  // and its hint do (watched failing with the hint's earlier words, update
  // alone); confirmed, both are offered.
  test('offers update only once a version column is confirmed', async () => {
    const user = await signIn(plane)
    const choose = await toChoose(user)
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    expect(within(within(choose).getByLabelText('Version column')).getByRole('option', { selected: true }).textContent).toBe(
      'None: update and delete are not offered',
    )
    expect(within(choose).getByText(/has no rowversion/).textContent).toBe(
      'sales.order has no rowversion. Confirm a column only if every writer of the table increments it on each update; without one the form offers no update and no delete, because a stale save or delete could not be detected.',
    )
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    let generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: not offered', 'Delete: not offered'])
    // A delete names its version as an update does, so one note says both (0050).
    expect(list(generated, 'Blocked')).toEqual(['order Update and delete are not offered until row_version is confirmed as a version column.'])

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '2. Choose' }))
    await user.selectOptions(within(step('Choose')).getByLabelText('Version column'), 'row_version')
    await user.click(within(step('Choose')).getByRole('button', { name: 'Generate the form' }))
    generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: offered', 'Delete: offered'])
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
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: offered', 'Delete: offered'])
  })

  // Delete is offered where a version names one record for good and the
  // account may delete (0050), and the line says it from the bindings, so
  // a delete the generator blocked is never contradicted by a line that
  // says the form deletes (0052). PostgreSQL's order lines are keyed by
  // what people type, so a version column cannot tell a line from one
  // created again under its key: update is offered and delete is not, in
  // the generator's words; the restricted reader may not DELETE at all
  // (watched failing with the line printed for update's flag).
  test('says delete is not offered where the generator blocks it, in its words', async () => {
    const user = await signIn(plane)
    let choose = await toChoose(user)
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order_line')
    await user.selectOptions(within(choose).getByLabelText('Version column'), 'row_version')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    let generated = await screen.findByRole('main', { name: 'Generate' })
    const lines = await proposalFromServer({
      connection: 'fixture',
      root: { schema: 'sales', name: 'order_line' },
      formId: 'sales-order_line',
      title: 'Order line',
      lookups: [],
      pinned: [],
      versionColumn: 'row_version',
    })
    expect(lines.bindings.operations).toEqual({ create: true, update: true, delete: false })
    expect(list(generated, 'Operations')).toEqual(['Create: offered', 'Update: offered', 'Delete: not offered'])
    expect(list(generated, 'Blocked')).toEqual(lines.notes.filter((note) => note.kind === 'blocked').map((note) => `${note.subject} ${note.message}`))
    expect(list(generated, 'Blocked')).toEqual([
      expect.stringMatching(
        /^order_line Delete is not offered: a record of sales\.order_line created again with a deleted record's key starts its row_version where the deleted one did/,
      ),
    ])

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '1. Connect' }))
    // SQL Server's reader: a rowversion it may read, and no DELETE.
    choose = await toChoose(user, 'fixture-sqlserver-reader')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    generated = await screen.findByRole('main', { name: 'Generate' })
    expect(list(generated, 'Operations').at(-1)).toBe('Delete: not offered')
    expect(list(generated, 'Blocked')).toContain("order Delete is not offered: this connection's account may not DELETE from sales.order.")
    expect(await audit()).toEqual([])
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
    expect(
      within(within(choose).getByRole('alert'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['The form needs a title.', 'fk_order_customer needs at least one column to show.', 'Name the trusted attribute tenant_id is pinned to.'])
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

  // A lookup over the root's whole key can make the form a section of what
  // it references (0109): offered there, with a column of the referenced
  // table and a value it holds while the section is shown, and sent to the
  // generator as part of the lookup's choice. Over a key that is not the
  // root's -- the order's customer -- it is not offered at all. Watched
  // failing with the section left out of the proposal: the request held
  // the lookup alone.
  test("offers a lookup over the root's key as a section, shown by a column and a value", async () => {
    await plane.close()
    plane = await startPlane({ sections: true })
    const user = await signIn(plane)
    const choose = await toChoose(user, 'fixture-sections')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.customer_company')
    await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_customer_company_customer as a lookup' }))
    await user.click(within(choose).getByRole('checkbox', { name: 'Show it under each customer as one form' }))
    await user.selectOptions(within(choose).getByLabelText('Shown while'), 'kind')
    await user.type(within(choose).getByLabelText('holds'), 'company')
    expect(await audit()).toEqual([])
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const sent = plane.requests.filter((request) => request.method === 'POST' && request.path === '/v1/form-proposals').at(-1)?.body as ProposalRequest
    expect(sent.lookups).toEqual([
      { foreignKey: 'fk_customer_company_customer', display: expect.any(Array) as unknown, section: { when: { column: 'kind', value: 'company' } } },
    ])
    const generated = await proposalFromServer(sent)
    expect(generated.bindings.fields.find((binding) => binding.kind === 'lookup')).toMatchObject({ section: { when: { column: 'kind', value: 'company' } } })

    await goToChoose(user)
    await user.selectOptions(within(step('Choose')).getByLabelText('Root table or view'), 'sales.order')
    await user.click(within(step('Choose')).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
    expect(within(step('Choose')).queryByRole('checkbox', { name: /^Show it under each/ })).toBeNull()
  })
})
