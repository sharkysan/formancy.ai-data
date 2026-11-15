import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { ColumnMeta } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { ProposalRequest } from './api.js'
import { stampSuggestion } from './choice.js'
import { audit, chooseOrder, discover, goTo, offerOnly, signIn, step, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Choose step's stamps (0153): the columns the server fills with who
 * is signed in or with the time, suggested by their names and never
 * stamped until an administrator ticks one, sent in the proposal's request
 * and bound by the real server's generator -- and kept when a published
 * form is generated again.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

async function chooseCustomer(user: User): Promise<HTMLElement> {
  await discover(user)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.customer')
  return choose
}

/** The last proposal the studio asked the server for. */
function lastProposal(): ProposalRequest {
  return plane.requests.filter((request) => request.method === 'POST' && request.path === '/v1/form-proposals').at(-1)?.body as ProposalRequest
}

const stamps = (choose: HTMLElement) => within(choose).getByRole('group', { name: 'Columns the server stamps' })
const generate = async (user: User, choose: HTMLElement) => user.click(within(choose).getByRole('button', { name: 'Generate the form' }))

describe('the stamps of a root', () => {
  // created_at is offered first, its name said as a suggestion, and left
  // unticked: generated so, the request names no stamp. Ticked, it is
  // stamped with the time on create, as its name suggests, and the server's
  // generator binds it and says so in the Generate step. Every control has
  // a name and axe finds nothing. Watched failing with the stamps left out
  // of the request: the bindings stamped nothing.
  test('suggests by name, stamps nothing unticked, and sends what is ticked', async () => {
    const user = await signIn(plane)
    const choose = await chooseCustomer(user)
    const offered = within(stamps(choose)).getAllByRole('checkbox')
    expect(offered.map((box) => box.getAttribute('id'))).toEqual(['stamp-created_at', 'stamp-name'])
    const createdAt = within(stamps(choose)).getByRole('checkbox', { name: 'Stamp created_at' })
    expect(createdAt).toHaveProperty('checked', false)
    expect(createdAt.getAttribute('aria-describedby')).not.toBeNull()
    expect(within(stamps(choose)).getByText('Its name suggests when a record was created. Nothing is stamped until you tick it.')).toBeDefined()
    await generate(user, choose)
    await screen.findByRole('main', { name: 'Generate' })
    expect(Object.hasOwn(lastProposal(), 'stamps')).toBe(false)

    const again = await goTo(user, 'Choose')
    await user.click(within(stamps(again)).getByRole('checkbox', { name: 'Stamp created_at' }))
    expect(within(stamps(again)).getByLabelText<HTMLSelectElement>('When created_at is stamped').value).toBe('create')
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
    await generate(user, again)
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(lastProposal().stamps).toEqual([{ column: 'created_at', value: { kind: 'time' }, on: 'create' }])
    const proposal = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose(lastProposal())
    if (!proposal.ok) throw new Error(proposal.message)
    expect(proposal.value.bindings.stamps?.map((stamp) => [stamp.column, stamp.on])).toEqual([['created_at', 'create']])
    expect(within(generated).getAllByText(/\(0153\)/).length).toBeGreaterThan(0)
  })

  // A person is stamped with their id or one of their attributes, named
  // here; an attribute left without a name is said before anything is
  // sent, and so is a column pinned as well as stamped. Watched failing
  // with `choiceProblems` asked nothing of the stamps: the empty attribute
  // reached the generator, which refused it in its own words.
  test('stamps a person with an attribute it names, and says what is missing', async () => {
    const user = await signIn(plane)
    const choose = await chooseCustomer(user)
    await user.click(within(stamps(choose)).getByRole('checkbox', { name: 'Stamp name' }))
    await user.selectOptions(within(stamps(choose)).getByLabelText('What fills name'), 'attribute')
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
    await generate(user, choose)
    expect(within(within(choose).getByRole('alert')).getByText('Name the attribute name is stamped with.')).toBeDefined()
    await user.type(within(stamps(choose)).getByLabelText('Attribute name is stamped with'), 'login')
    await user.selectOptions(within(stamps(choose)).getByLabelText('When name is stamped'), 'both')
    await user.click(within(choose).getByRole('checkbox', { name: 'Pin name' }))
    await generate(user, choose)
    expect(within(within(choose).getByRole('alert')).getByText('name is pinned and stamped: unpin it, or leave it unstamped.')).toBeDefined()
    await user.click(within(choose).getByRole('checkbox', { name: 'Pin name' }))
    await generate(user, choose)
    await screen.findByRole('main', { name: 'Generate' })
    expect(lastProposal().stamps).toEqual([{ column: 'name', value: { kind: 'attribute', attribute: 'login' }, on: 'both' }])
  })

  // An order's created_by is a number, an employee's id: its name says who
  // created the order, and a stamp of the signed-in person could not fill
  // it, so it is neither suggested nor offered. Watched failing with the
  // candidates asked of nothing but the key and the form's other columns:
  // the integer created_by was offered; and with the suggestion asked of
  // the name alone: it was suggested as the signed-in person's id, which
  // the generator refuses.
  test('offers no column whose kind cannot take what its name suggests', async () => {
    const user = await signIn(plane)
    await discover(user)
    await user.click(screen.getByRole('button', { name: 'Choose a root' }))
    const choose = step('Choose')
    await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
    // Not offered as a lookup, created_by is a column of its own, which only its kind keeps from being stamped.
    await offerOnly(user, choose, ['fk_order_customer'])
    expect(within(stamps(choose)).queryByRole('checkbox', { name: 'Stamp created_by' })).toBeNull()
    const column = (name: string, type: ColumnMeta['type']) => ({ name, type }) as ColumnMeta
    const TEXT = { kind: 'text', maxLength: 40, lengthUnit: 'code-points', fixedLength: false } as const
    expect(stampSuggestion(column('created_by', { kind: 'integer', min: '0', max: '9' }))).toBeNull()
    expect(stampSuggestion(column('created_at', TEXT))).toBeNull()
    expect(stampSuggestion(column('Created_By', TEXT))).toEqual({ value: { kind: 'actor' }, on: 'create' })
    expect(stampSuggestion(column('UPDATED_BY', TEXT))).toEqual({ value: { kind: 'actor' }, on: 'both' })
    expect(stampSuggestion(column('modified_on', { kind: 'date' }))).toEqual({ value: { kind: 'time' }, on: 'both' })
    expect(stampSuggestion(column('changed_date', { kind: 'timestamp', withTimeZone: false, precision: 3 }))).toEqual({ value: { kind: 'time' }, on: 'both' })
    expect(stampSuggestion(column('creator', TEXT))).toBeNull()
  })

  // A published form generated again from the Drift step is taken up with
  // its stored request: the Choose step shows its stamp ticked, so
  // generating once more asks for it again. Watched failing with the stamps
  // left out of the draft taken up: the box was unticked, and the next
  // generation would have let a person type who created the order.
  test('is kept in the Choose step when a published form is generated again', async () => {
    const user = await signIn(plane)
    // The order, whose version column the journey confirms and whose policy it writes; its group stamped with who created it.
    const choose = await chooseOrder(user)
    await user.click(within(stamps(choose)).getByRole('checkbox', { name: 'Stamp group' }))
    await generate(user, choose)
    await screen.findByRole('main', { name: 'Generate' })
    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
    const regenerated = await within(drift).findByRole('region', { name: 'Regenerated from version 1' })
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    const again = await goTo(user, 'Choose')
    expect(within(stamps(again)).getByRole('checkbox', { name: 'Stamp group' })).toHaveProperty('checked', true)
    await generate(user, again)
    await screen.findByRole('main', { name: 'Generate' })
    expect(lastProposal().stamps).toEqual([{ column: 'group', value: { kind: 'actor' }, on: 'create' }])
  })
})
