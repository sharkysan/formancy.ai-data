import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import { DraftPolicy } from './draft-policy.js'
import { audit, focusedName, generateOrder, goTo, pressEnter, signIn, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Policy step's state moves (0112): a field holding where a record
 * stands, and the moves each role may make of it, judged by the policy
 * check in `validatePolicy`'s words and published as typed; and the draft
 * review that says them to the publisher approving them.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** What the policy check lists, in its words. */
function problems(policy: HTMLElement): string[] {
  const region = within(policy).getByRole('region', { name: 'Policy check' })
  const list = within(region).queryByRole('list', { name: 'Policy check' })
  return list === null
    ? []
    : within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent ?? '')
}

/** Adds a move and types it in: an empty `from` is a move that starts a new record. */
async function addMove(user: User, policy: HTMLElement, n: number, from: string, to: string, roles: string): Promise<void> {
  await user.click(within(policy).getByRole('button', { name: 'Add a move' }))
  if (from !== '') await user.type(within(policy).getByLabelText(`From in move ${String(n)}`), from)
  await user.type(within(policy).getByLabelText(`To in move ${String(n)}`), to)
  await user.type(within(policy).getByLabelText(`Roles that may make move ${String(n)}`), roles)
}

/** The order's Policy step with clerks granted everything and Status chosen as its state field. */
async function statusMoves(user: User): Promise<HTMLElement> {
  await generateOrder(user)
  const policy = await writeOrderPolicy(user)
  await user.selectOptions(within(policy).getByLabelText('State field'), 'status')
  return policy
}

describe('the state moves', () => {
  // Chosen, the field is refused until it has a move; a move granted to a
  // role that may not update is refused in validatePolicy's words; and
  // what fits publishes as typed -- the policy the server holds every
  // write to. Watched failing with the moves typed and never written into
  // the policy: the check took the second and third for the first again.
  test('are judged by the policy check, and published as typed', async () => {
    const user = await signIn(plane)
    const policy = await statusMoves(user)
    expect(problems(policy)).toEqual(['transitions.moves is not a list of at least one { from, to, roles }'])
    await addMove(user, policy, 1, '', 'placed', 'clerk')
    await addMove(user, policy, 2, 'placed', 'shipped', 'clerk')
    await addMove(user, policy, 3, 'shipped', 'delivered', 'auditor')
    expect(problems(policy)).toEqual(['transitions.moves[2] grants auditor, who may not update with this form'])
    await pressEnter(user, within(policy).getByRole('button', { name: 'Remove move 3' }))
    expect(problems(policy)).toEqual([])
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    const latest = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).latest('sales-order')
    if (!latest.ok) throw new Error(latest.message)
    expect(latest.value.bundle.policy.transitions).toEqual({
      field: 'status',
      moves: [
        { from: null, to: 'placed', roles: ['clerk'] },
        { from: 'placed', to: 'shipped', roles: ['clerk'] },
      ],
    })
  })

  // Every control has a name a screen reader reads out -- which move a
  // From, a To, its roles and its Remove belong to -- and axe finds
  // nothing on the step with moves in it.
  test('name every control, and axe finds nothing', async () => {
    const user = await signIn(plane)
    const policy = await statusMoves(user)
    await addMove(user, policy, 1, '', 'placed', 'clerk')
    await addMove(user, policy, 2, 'placed', 'shipped', 'clerk')
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
  })

  // Removing a move takes the button pressed. The keyboard goes to the
  // move that took its place, and after the last to Add a move. Choosing
  // no state field takes the moves with it, and the policy fits without
  // them. Watched failing with the focus left where the button was: the
  // page itself.
  test('a move removed: the next move, else Add a move; no state field, no moves', async () => {
    const user = await signIn(plane)
    const policy = await statusMoves(user)
    await addMove(user, policy, 1, '', 'placed', 'clerk')
    await addMove(user, policy, 2, 'placed', 'shipped', 'clerk')
    await pressEnter(user, within(policy).getByRole('button', { name: 'Remove move 1' }))
    expect(focusedName()).toBe('Remove move 1')
    expect((within(policy).getByLabelText('From in move 1') as HTMLInputElement).value).toBe('placed')
    await pressEnter(user, within(policy).getByRole('button', { name: 'Remove move 1' }))
    expect(focusedName()).toBe('Add a move')
    await user.selectOptions(within(policy).getByLabelText('State field'), '')
    expect(within(policy).queryByRole('button', { name: 'Add a move' })).toBeNull()
    expect(problems(policy)).toEqual([])
  })
})

describe('a draft’s moves, as its publisher reads them', () => {
  // The publisher approving a draft approves its moves too, so the review
  // says each one and that every other change is refused; a policy with
  // none says nothing of moves. Watched failing with the moves left out of
  // the review: there was no list.
  test('lists each move with its roles', async () => {
    const outcome = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose({
      connection: 'fixture',
      root: { schema: 'sales', name: 'order' },
      formId: 'sales-order',
      title: 'Order',
      lookups: [],
      pinned: [],
      versionColumn: 'row_version',
    })
    if (!outcome.ok) throw new Error(outcome.message)
    const { bindings, form } = outcome.value
    const base: FormPolicy = { version: 1, operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] }, fields: {}, rowFilters: [], lookups: {} }
    const moves: FormPolicy = {
      ...base,
      transitions: {
        field: 'status',
        moves: [
          { from: null, to: 'placed', roles: ['clerk'] },
          { from: 'placed', to: 'shipped', roles: ['clerk', 'dispatcher'] },
        ],
      },
    }
    render(<DraftPolicy policy={moves} bindings={bindings} document={form} />)
    const list = screen.getByRole('list', { name: 'Moves of Status (status)' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['A new record starts at placed: roles clerk.', 'From placed to shipped: roles clerk, dispatcher.'])
    cleanup()
    render(<DraftPolicy policy={base} bindings={bindings} document={form} />)
    expect(screen.queryByRole('heading', { name: /^Moves of/ })).toBeNull()
  })
})
