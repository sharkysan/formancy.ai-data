import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { createAdminClient } from './api.js'
import type { ProposalRequest } from './api.js'
import { audit, discover, goTo, signIn, step, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Choose step's Versions (0113): a root whose rows are versions of one
 * thing, named by the columns a version starts and ends at, sent in the
 * proposal's request and bound by the real server's generator -- and
 * offered nowhere a column could not start or end a version.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane({ versions: true })
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

async function choosePrice(user: User): Promise<HTMLElement> {
  await discover(user, 'fixture-versions')
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.price')
  await user.selectOptions(within(choose).getByLabelText('Version column'), 'row_version')
  return choose
}

/** The last proposal the studio asked the server for. */
function lastProposal(): ProposalRequest {
  return plane.requests.filter((request) => request.method === 'POST' && request.path === '/v1/form-proposals').at(-1)?.body as ProposalRequest
}

describe('the Versions of a root', () => {
  // Ticked, the start and end chosen are the request's; the server's
  // generator binds the chain over them, with the chain's key, and the
  // Generate step lists what that changes in the generator's words.
  // Watched failing with the choice left out of the request: no chain was
  // asked for, and the bindings had none.
  test('names a chain in the request, which the generator binds', async () => {
    const user = await signIn(plane)
    const choose = await choosePrice(user)
    expect(within(choose).queryByLabelText('Valid from')).toBeNull()
    await user.click(within(choose).getByRole('checkbox', { name: 'Each row of sales.price is a version, valid from a date until the next one starts' }))
    expect((within(choose).getByLabelText('Valid from') as HTMLSelectElement).value).toBe('valid_from')
    expect((within(choose).getByLabelText('Valid until, empty while open') as HTMLSelectElement).value).toBe('valid_to')
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    const generated = await screen.findByRole('main', { name: 'Generate' })
    expect(lastProposal().validity).toEqual({ from: 'valid_from', to: 'valid_to' })
    const proposal = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).propose(lastProposal())
    if (!proposal.ok) throw new Error(proposal.message)
    expect(proposal.value.bindings.validity).toEqual({ from: 'valid_from', to: 'valid_to', key: ['tenant_id', 'product_no'] })
    expect(within(generated).getAllByText(/\(0113\)/).length).toBeGreaterThan(0)
  })

  // A published form generated again from the Drift step is taken up as
  // the draft with its stored request: the Choose step shows its chain
  // ticked, so generating once more from there asks for it again. Watched
  // failing with the chain left out of the draft taken up: the box was
  // unticked, and the next generation would have dropped the chain.
  test('is kept in the Choose step when a published form is generated again', async () => {
    const user = await signIn(plane)
    const choose = await choosePrice(user)
    await user.click(within(choose).getByRole('checkbox', { name: 'Each row of sales.price is a version, valid from a date until the next one starts' }))
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-price.')
    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-price, against the database now' })
    await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
    const regenerated = await within(drift).findByRole('region', { name: 'Regenerated from version 1' })
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    const again = await goTo(user, 'Choose')
    expect(within(again).getByRole('checkbox', { name: 'Each row of sales.price is a version, valid from a date until the next one starts' })).toHaveProperty('checked', true)
    expect((within(again).getByLabelText('Valid from') as HTMLSelectElement).value).toBe('valid_from')
    await user.click(within(again).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    expect(lastProposal().validity).toEqual({ from: 'valid_from', to: 'valid_to' })
  })

  // Unticked, the rows are records of their own, as before: nothing is
  // asked. A root no column of which could start a version offers no box.
  test('asks for nothing unticked, and is not offered where no column could start a version', async () => {
    const user = await signIn(plane)
    const choose = await choosePrice(user)
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    expect(Object.hasOwn(lastProposal(), 'validity')).toBe(false)
    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: '2. Choose' }))
    await user.selectOptions(within(step('Choose')).getByLabelText('Root table or view'), 'sales.order')
    expect(within(step('Choose')).queryByRole('group', { name: 'Versions' })).toBeNull()
  })
})
