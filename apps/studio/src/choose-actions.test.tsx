import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { OFFER_SHIP_ORDER, SHIP_ORDER, SOURCE_OF, chooseShipping, discoverRoutines } from './test-actions.js'
import { audit, discover, offerOnly, signIn, step, unnamed } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Choose step's actions (0163): the routines a discovery that asked
 * for them read, each offered as an action over the open record, its
 * parameters given only the sources the generator binds, and every
 * refusal said in the generator's words before anything is sent --
 * against the real server behind a fake `fetch`, as every suite here
 * runs.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The Choose step on `connection`, discovered with its routines, with `root` chosen and only `foreignKeys` offered as lookups. */
async function choose(user: User, connection: string, root = 'sales.order', foreignKeys: readonly string[] = []): Promise<HTMLElement> {
  await discoverRoutines(user, connection)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const here = step('Choose')
  await user.selectOptions(within(here).getByLabelText('Root table or view'), root)
  await offerOnly(user, here, foreignKeys)
  return here
}

const actions = (here: HTMLElement) => within(here).getByRole('group', { name: 'Actions' })
const offered = (select: HTMLElement) =>
  within(select)
    .getAllByRole<HTMLOptionElement>('option')
    .map((option) => option.textContent)

describe('the routines offered as actions', () => {
  // A snapshot discovered without its routines says nothing about any
  // (0158), so the step offers none and says how to discover them, rather
  // than reading as a database with none; ticked, Include routines asks the
  // server for them, and the step lists the fixture's ship_order, unticked.
  // Watched failing with Include routines left out of the discovery: the
  // second discovery recorded no routine, and the step said the first's
  // sentence again.
  test('are none for a discovery that did not ask, and the routines in scope for one that did', async () => {
    const user = await signIn(plane)
    await discover(user)
    await user.click(screen.getByRole('button', { name: 'Choose a root' }))
    const without = step('Choose')
    await user.selectOptions(within(without).getByLabelText('Root table or view'), 'sales.order')
    expect(within(actions(without)).getByText(/^fixture was discovered without its routines\. Tick Include routines on the Connect step/)).toBeTruthy()
    expect(within(without).queryAllByRole('checkbox', { name: /as an action$/ })).toEqual([])

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '1. Connect' }))
    const here = await choose(user, 'fixture')
    expect(plane.requests.filter((request) => request.path === '/v1/connections/fixture/metadata').map((request) => request.query)).toEqual([
      undefined,
      '?routines=true',
    ])
    const box = within(here).getByRole<HTMLInputElement>('checkbox', { name: OFFER_SHIP_ORDER })
    expect([box.checked, box.disabled]).toEqual([false, true])
    expect(computeAccessibleDescription(box)).toBe('function · returns nothing · may write · order_id bigint, tenant integer.')
  })

  // A run is held to the version its person read, so a form with no
  // confirmed version offers no action: said once, above the routines, in
  // `actionUnoffered`'s words, and every box disabled until a version
  // column is confirmed. Watched failing with the form's refusal unasked:
  // the box was offered on a form the generator binds no action on.
  test('wait for a confirmed version, in the generator’s words', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture')
    expect(within(actions(here)).getByText(/^No action can be offered on this form: no rowversion and no confirmed version column/)).toBeTruthy()
    await user.selectOptions(within(here).getByLabelText('Version column'), 'row_version')
    expect(within(actions(here)).queryByText(/^No action can be offered/)).toBeNull()
    expect(within(here).getByRole<HTMLInputElement>('checkbox', { name: OFFER_SHIP_ORDER }).disabled).toBe(false)
  })

  // A routine no run could call is listed, never left out as if it were
  // not there, its box disabled and the generator's own refusal under it:
  // the reader may not execute ship_order (PostgreSQL shows every role
  // every function), and on SQL Server the security policy's predicate is
  // a function, which SQL Server forbids to write. Watched failing with
  // `routineProblem` unasked: both boxes were offered.
  test('are listed with the generator’s refusal where no run could call them', async () => {
    const user = await signIn(plane)
    const reader = await choose(user, 'fixture-reader')
    const refused = within(reader).getByRole<HTMLInputElement>('checkbox', { name: OFFER_SHIP_ORDER })
    expect(refused.disabled).toBe(true)
    expect(computeAccessibleDescription(refused)).toContain(`The generator refuses it: this connection's account may not execute ${SHIP_ORDER}.`)

    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '1. Connect' }))
    const sqlserver = await choose(user, 'fixture-sqlserver')
    const predicate = within(sqlserver).getByRole<HTMLInputElement>('checkbox', { name: 'Offer sales.fn_customer_tenant() as an action' })
    expect(predicate.disabled).toBe(true)
    expect(computeAccessibleDescription(predicate)).toContain(
      'The generator refuses it: sales.fn_customer_tenant() is a function, which SQL Server forbids to write; a run calls a procedure.',
    )
  })

  // A rowversion order moves its version only through a touch column the
  // administrator confirms (0155, 0159): until one is chosen, the step
  // says so in the generator's words, and once it is the procedure is
  // offered. Watched failing with the touch column left out of the
  // request the reasons are asked of: the refusal stayed with a touch
  // column chosen.
  test('wait on SQL Server for the touch column a run moves the rowversion through', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture-sqlserver')
    expect(within(actions(here)).getByText(/^No action can be offered on this form: .*touch column/)).toBeTruthy()
    await user.selectOptions(within(here).getByRole('combobox', { name: 'Rows saved with these records move the rowversion through' }), 'status')
    expect(within(actions(here)).queryByText(/^No action can be offered/)).toBeNull()
    expect(within(here).getByRole<HTMLInputElement>('checkbox', { name: 'Offer sales.ship_order() as an action' }).disabled).toBe(false)
  })
})

describe('an action chosen', () => {
  // Ticked, the action is named after its routine and no parameter is
  // given anything; each parameter's select offers only the sources the
  // generator binds for its type -- the order's bigint key to order_id,
  // and not to tenant, an integer, which no bigint fits -- and until each
  // is given one the generator's note under it says which is missing.
  // Watched failing with every candidate offered (`sourceProblem`
  // unasked): tenant was offered Key id; and with the note left out.
  test('offers each parameter only what the generator binds, and says in its note what is missing', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture', 'sales.order', ['fk_order_customer'])
    await user.click(within(here).getByRole('checkbox', { name: 'Pin tenant_id' }))
    await user.selectOptions(within(here).getByLabelText('Version column'), 'row_version')
    await user.click(within(here).getByRole('checkbox', { name: OFFER_SHIP_ORDER }))
    expect(within(here).getByRole<HTMLInputElement>('textbox', { name: `Action name for ${SHIP_ORDER}` }).value).toBe('ship-order')
    const order = within(here).getByRole<HTMLSelectElement>('combobox', { name: SOURCE_OF('order_id', 'bigint') })
    const tenant = within(here).getByRole<HTMLSelectElement>('combobox', { name: SOURCE_OF('tenant', 'integer') })
    expect([order.value, tenant.value]).toEqual(['', ''])
    expect(offered(order)).toContain('Key id')
    expect(offered(tenant)).not.toContain('Key id')
    expect(offered(tenant)).toEqual(expect.arrayContaining(['Column created_by', 'Asked in its dialog', 'A trusted attribute', 'The person’s id']))
    expect(offered(tenant)).not.toContain('Column amount')
    expect(within(actions(here)).getByText(/^Action ship-order is not offered: parameter order_id is given nothing/)).toBeTruthy()
    await user.selectOptions(order, 'Key id')
    expect(within(actions(here)).getByText(/^Action ship-order is not offered: parameter tenant is given nothing/)).toBeTruthy()
    await user.selectOptions(tenant, 'A trusted attribute')
    await waitFor(() => expect(within(actions(here)).queryByText(/is not offered/)).toBeNull())
    expect({ choose: [...(await audit()), ...unnamed()] }).toEqual({ choose: [] })
  })

  // A name no run's address could carry is the request's own refusal,
  // which the server answers 422 with: said under the actions in the
  // generator's words as it is typed, and gone once it is one. A trusted
  // attribute asks for its name, starting at the tenant's. Watched failing
  // with the generator's throw left unasked: the name "Ship it" was said
  // nothing of.
  test('says what the generator throws of its name, and asks a trusted attribute’s name', async () => {
    const user = await signIn(plane)
    const here = await chooseShipping(user)
    const name = within(here).getByRole('textbox', { name: `Action name for ${SHIP_ORDER}` })
    await user.clear(name)
    await user.type(name, 'Ship it')
    expect(
      within(actions(here)).getByText(/^The generator refuses the request with these actions: action name "Ship it" is not lower-case letters/),
    ).toBeTruthy()
    await user.clear(name)
    await user.type(name, 'ship')
    expect(within(actions(here)).queryByText(/^The generator refuses/)).toBeNull()
    await user.selectOptions(within(here).getByRole('combobox', { name: SOURCE_OF('tenant', 'integer') }), 'A trusted attribute')
    expect(within(here).getByRole<HTMLInputElement>('textbox', { name: `Attribute tenant is given for ${SHIP_ORDER}` }).value).toBe('tenant')
  })

  // What is chosen is what is sent: the proposal names the action with
  // each parameter's source, the server discovers it with the routines,
  // and the generator binds it -- in the routine's order, a key and a
  // field as the columns the locked row is read by. Unticked, nothing of
  // it is sent. Watched failing with `actions` left out of proposalFor:
  // the proposal bound no action.
  test('is sent as chosen, and bound by the server’s generator', async () => {
    const user = await signIn(plane)
    const here = await chooseShipping(user)
    await user.click(within(here).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const sent = plane.requests.findLast((request) => request.path === '/v1/form-proposals')?.body as { actions?: unknown }
    expect(sent.actions).toEqual([
      {
        name: 'ship-order',
        routine: { schema: 'sales', name: 'ship_order', signature: 'pg_catalog.int8, pg_catalog.int4' },
        scope: 'record',
        parameters: [
          { parameter: 'order_id', from: { key: 'id' } },
          { parameter: 'tenant', from: { attribute: 'tenant' } },
        ],
      },
    ])
    expect(step('Generate').textContent).toContain(`Runs ${SHIP_ORDER} over the open record after incrementing row_version, in one transaction.`)

    const again = within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '2. Choose' })
    await user.click(again)
    await user.click(within(step('Choose')).getByRole('checkbox', { name: OFFER_SHIP_ORDER }))
    await user.click(within(step('Choose')).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    expect(plane.requests.findLast((request) => request.path === '/v1/form-proposals')?.body).not.toHaveProperty('actions')
  })
})
