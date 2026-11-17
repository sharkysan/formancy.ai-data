import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { discoverRoutines, generateShipping, OFFER_SHIP_ORDER, SHIP_ORDER, SOURCE_OF } from './test-actions.js'
import { audit, focusedName, goTo, pressEnter, signIn, step, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Policy step's part of an action (0163): who may run it, and before
 * that grant -- and so before the form is published -- what it does that
 * nothing here binds, as 0052 says what a delete also does. Against the
 * real server behind a fake `fetch`, as every suite here runs. Elements
 * are found by role and name; whether the note comes before its grant is
 * read from the document's order, which no query of the accessibility
 * tree answers.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const checked = (policy: HTMLElement) => within(within(policy).getByRole('region', { name: 'Policy check' }))
const note = (policy: HTMLElement, name: string) => within(policy).getByRole('note', { name: `What ${name} does is the deployment’s` })
const notice = (policy: HTMLElement, name: string) => within(note(policy, name)).getAllByRole('listitem')

/** The SQL Server order, its rowversion moved through status, the tenant pinned, and ship_order offered with its key and the tenant: the procedure shape. */
async function generateSqlServerShipping(user: User): Promise<void> {
  await discoverRoutines(user, 'fixture-sqlserver')
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
  await user.click(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' }))
  await user.selectOptions(within(choose).getByRole('combobox', { name: 'Rows saved with these records move the rowversion through' }), 'status')
  await user.click(within(choose).getByRole('checkbox', { name: 'Offer sales.ship_order() as an action' }))
  await user.selectOptions(within(choose).getByRole('combobox', { name: SOURCE_OF('@order_id', 'bigint', 'sales.ship_order()') }), 'Key id')
  await user.selectOptions(within(choose).getByRole('combobox', { name: SOURCE_OF('@tenant', 'int', 'sales.ship_order()') }), 'A trusted attribute')
  await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
  await screen.findByRole('main', { name: 'Generate' })
}

describe('the notice before an action is granted', () => {
  // What the routine does is the deployment's, and the step says which of
  // the costs apply to this one: on PostgreSQL over a version column, that
  // a routine writing other rows of the table must increment theirs, and
  // neither SQL Server's RETURN status nor a reach past the account's
  // grants, which ship_order has not; on SQL Server over a rowversion, the
  // RETURN status and the ownership chain every procedure has, and no
  // version column to increment. Watched failing with each of the three
  // conditions forced in turn: PostgreSQL's notice said a RETURN status
  // refuses a run, SQL Server's said nothing of the ownership chain, and
  // it told SQL Server's routines to increment status. And the note comes
  // before its grant, as a person reads the step, and is read with the
  // box, so a screen reader that tabs to it hears the note first. Watched
  // failing with the grant drawn first ("expected +0 to be truthy"), and
  // with the box described by nothing ("expected '' to match /^What
  // ship-order does is the deployme…/").
  test('says what applies to the routine and the engine, and no more, before the grant and with it', async () => {
    const user = await signIn(plane)
    await generateShipping(user)
    const postgres = await goTo(user, 'Policy')
    expect([...notice(postgres, 'ship-order')].map((item) => item.textContent)).toEqual([
      'It calls sales.ship_order(pg_catalog.int8, pg_catalog.int4) over the open record after incrementing row_version, in one transaction. This module guards what it hands the routine and the transaction around it, and cannot see what the routine does.',
      'Field grants, state moves and the policy’s cascades do not bind it: it may write fields no grant lets a person write, move a state outside the moves this policy lists, and delete through keys the policy does not accept.',
      'A routine that writes other rows of sales.order must increment their row_version itself, or a save read before it overwrites what it wrote.',
    ])
    const grant = within(postgres).getByRole('textbox', { name: 'Roles that may run ship-order' })
    expect(note(postgres, 'ship-order').compareDocumentPosition(grant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(computeAccessibleDescription(grant)).toMatch(/^What ship-order does is the deployment’s It calls sales\.ship_order\(/)
    expect({ policy: [...(await audit()), ...unnamed()] }).toEqual({ policy: [] })

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '1. Connect' }))
    await generateSqlServerShipping(user)
    const sqlserver = await goTo(user, 'Policy')
    const items = [...notice(sqlserver, 'ship-order')].map((item) => item.textContent)
    expect(items[0]).toBe(
      'It calls sales.ship_order() over the open record after setting status to itself, which moves the rowversion, in one transaction. This module guards what it hands the routine and the transaction around it, and cannot see what the routine does.',
    )
    expect(items.slice(2)).toEqual([
      'A RETURN status other than 0 refuses the run, which is rolled back: a procedure that returns one for any other reason is refused whenever it does.',
      'It may act beyond this connection’s own grants: every SQL Server procedure reaches its owner’s objects by ownership chaining.',
    ])
  })
})

describe('who may run an action', () => {
  // The roles typed are the action's grant, and the check says in
  // validatePolicy's words what does not fit -- a role that may not read
  // with the form -- and once it fits, the step's own grant leaves out an
  // action nobody runs and `actions` itself when no action is anybody's:
  // absent is nobody's, and a policy without it is one an older server
  // reads (0159). Watched failing with an emptied list kept as an entry:
  // the published policy had `actions`.
  test('is the roles typed, refused in validatePolicy’s words where they may not read, and nobody once emptied', async () => {
    const user = await signIn(plane)
    await generateShipping(user)
    const policy = await writeOrderPolicy(user)
    const run = within(policy).getByLabelText('Roles that may run ship-order')
    await user.type(run, 'auditor')
    await waitFor(() =>
      expect(
        checked(policy).getByText('actions.ship-order grants auditor, who may not read with this form: a run names the version its person read'),
      ).toBeTruthy(),
    )
    await user.clear(run)
    await user.type(run, 'clerk')
    await waitFor(() => expect(checked(policy).getByRole('status').textContent).toMatch(/fits this form/))
    await user.clear(run)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const sent = plane.requests.findLast((request) => request.path === '/v1/forms/sales-order/versions')?.body as { bundle: { policy: object } }
    expect(sent.bundle.policy).not.toHaveProperty('actions')
  })

  // A grant left from a generation that bound the action, once it no
  // longer does, is refused by the server; the step lists it to remove,
  // and Enter on the last Remove leaves the keyboard on the policy check
  // rather than on the page. Watched failing with the stray grants left
  // out of the fieldset: there was nothing to remove them with.
  test('left from a generation that bound it, is removed by its button, the keyboard on the check', async () => {
    const user = await signIn(plane)
    await generateShipping(user)
    const policy = await writeOrderPolicy(user)
    await user.type(within(policy).getByLabelText('Roles that may run ship-order'), 'clerk')
    const choose = await goTo(user, 'Choose')
    await user.click(within(choose).getByRole('checkbox', { name: OFFER_SHIP_ORDER }))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const after = await goTo(user, 'Policy')
    expect(checked(after).getByText('actions.ship-order: the form binds no action ship-order')).toBeTruthy()
    await pressEnter(user, within(after).getByRole('button', { name: 'Remove the grant of ship-order' }))
    await waitFor(() => expect(checked(after).getByRole('status').textContent).toMatch(/fits this form/))
    expect(focusedName()).toBe('Policy check')
    expect(within(after).queryByRole('group', { name: 'Who may run each action' })).toBeNull()
  })
})

describe('Generate again with an action', () => {
  /** The Policy step's Generate again, once its pins changed: the next proposal, with the draft carried onto it. */
  async function generateAgain(user: User, change: (policy: HTMLElement) => Promise<void>): Promise<HTMLElement> {
    const policy = await goTo(user, 'Policy')
    await change(policy)
    await user.click(within(policy).getByRole('button', { name: 'Generate again with these pins' }))
    await screen.findByRole('main', { name: 'Generate' })
    return goTo(user, 'Presentation')
  }

  // An action's words follow it by its name onto the next proposal, as a
  // regeneration carries them (0159): the label typed on the Presentation
  // step is still there after Generate again. Renamed on the Choose step
  // it is another action, so the next Generate again drops its words, said
  // among what could not be carried, and leaves its grant for the Policy
  // step to remove. Watched failing with the carried words left out of
  // the draft Generate again makes, and with them left out of what
  // carryDraft rebases: each time "expected <input …(3)></input> to have
  // property "value" with value 'Ship it'".
  test('keeps its words by its name, and drops those of one renamed, its grant left to remove', async () => {
    const user = await signIn(plane)
    await generateShipping(user)
    const policy = await writeOrderPolicy(user)
    await user.type(within(policy).getByLabelText('Roles that may run ship-order'), 'clerk')
    const presentation = await goTo(user, 'Presentation')
    const label = within(presentation).getByRole('textbox', { name: 'Label of the ship-order action' })
    await user.clear(label)
    await user.type(label, 'Ship it')
    const kept = await generateAgain(user, async (here) => {
      await user.click(within(here).getByRole('button', { name: 'Add a row filter' }))
      await user.selectOptions(within(here).getByLabelText('Column of row filter 2'), 'group')
    })
    expect(within(kept).getByRole('textbox', { name: 'Label of the ship-order action' })).toHaveProperty('value', 'Ship it')

    const choose = await goTo(user, 'Choose')
    const name = within(choose).getByRole('textbox', { name: `Action name for ${SHIP_ORDER}` })
    await user.clear(name)
    await user.type(name, 'ship')
    const renamed = await generateAgain(user, (here) => user.click(within(here).getByRole('button', { name: 'Remove row filter 2' })))
    expect(within(renamed).getByRole('textbox', { name: 'Label of the ship action' })).toHaveProperty('value', 'Ship')
    expect(within(renamed).getByText('The words of action ship-order were dropped: the regenerated form does not offer it.')).toBeTruthy()
    const after = await goTo(user, 'Policy')
    expect(checked(after).getByText('actions.ship-order: the form binds no action ship-order')).toBeTruthy()
    expect(within(after).getByRole('button', { name: 'Remove the grant of ship-order' })).toBeTruthy()
  })
})
