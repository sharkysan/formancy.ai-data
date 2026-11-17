import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { TOGETHER_MAX_ROWS } from '@formancy/data-core'
import { audit, discover, goTo, offerOnly, signIn, step, unnamed } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'
import { TOGETHER_CONNECTION, TOGETHER_SNAPSHOT } from './test-together.js'

/**
 * The Choose step's part of a record's rows saved with it (0155): the box
 * under a lookup and its bounds, the touch column of a rowversion parent,
 * and what the generator, the policy check and publishing refuse of
 * either, said in their words before anything is sent -- against the real
 * server behind a fake `fetch`, as every suite here runs.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
  // The tables the captured fixture has none of: one under row security, one too wide for a batch (`TOGETHER_SNAPSHOT`).
  plane.databases.set(TOGETHER_CONNECTION, TOGETHER_SNAPSHOT)
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The Choose step on `connection`, with `root` chosen and `foreignKeys` alone offered as lookups. */
async function choose(user: User, connection: string, root: string, foreignKeys: readonly string[]): Promise<HTMLElement> {
  await discover(user, connection)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const here = step('Choose')
  await user.selectOptions(within(here).getByLabelText('Root table or view'), root)
  await offerOnly(user, here, foreignKeys)
  return here
}

const box = (here: HTMLElement, target: string) =>
  within(here).getByRole<HTMLInputElement>('checkbox', { name: `Rows of this form are saved with their ${target}` })
const bounds = (here: HTMLElement) => ['At least', 'At most'].map((name) => within(here).getByRole<HTMLInputElement>('spinbutton', { name }).value)
const blocks = (here: HTMLElement) =>
  within(here)
    .queryAllByRole('list', { name: 'What blocks it' })
    .flatMap((list) =>
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    )

/** Clients may do what a line's form offers, every field filled, and its order list offering every order: a policy the server takes. */
async function writeLinePolicy(user: User): Promise<HTMLElement> {
  const policy = await goTo(user, 'Policy')
  for (const operation of ['read', 'create', 'update']) await user.type(within(policy).getByLabelText(`Roles that may ${operation}`), 'clerk')
  await user.click(within(policy).getByRole('button', { name: 'Fill every field from the operations' }))
  await user.click(within(policy).getByRole('button', { name: 'Offer every row of sales.order' }))
  return policy
}

describe('the box under a lookup', () => {
  // Offered under a key NOT NULL onto another table -- the order's
  // customer -- and under no other, never ticked; ticked, its bounds start
  // at none required and at the cap data-core gives; unticked, they are
  // gone. Watched failing with the box drawn under every lookup: the
  // order's creator, which may be NULL, had one.
  test('is offered under a NOT NULL lookup onto another table, unticked, its bounds at none and the cap', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture', 'sales.order', ['fk_order_customer', 'fk_order_created_by'])
    expect(box(here, 'customer').checked).toBe(false)
    expect(within(here).queryByRole('checkbox', { name: 'Rows of this form are saved with their employee' })).toBeNull()
    await user.click(box(here, 'customer'))
    expect(bounds(here)).toEqual(['0', String(TOGETHER_MAX_ROWS)])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await user.click(box(here, 'customer'))
    expect(within(here).queryByRole('spinbutton', { name: 'At most' })).toBeNull()
  })

  // A delivery under row security: the generator refuses it, so the box is
  // not offered and its description says why in the generator's words,
  // before anybody ticks it. Watched failing with the step's blocker not
  // handed to the box: offered, and refused only once ticked.
  test('is not offered where the generator refuses it, with its words', async () => {
    const user = await signIn(plane)
    const here = await choose(user, TOGETHER_CONNECTION, 'sales.delivery', ['fk_delivery_order'])
    const refused = box(here, 'order')
    expect(refused.disabled).toBe(true)
    expect(computeAccessibleDescription(refused)).toContain(
      'The generator refuses it: order is saved with its record, and row security on the table would hide rows from every count.',
    )
    expect(await audit()).toEqual([])
  })

  // A box emptied is no number: Generate says so in the server's words
  // and sends nothing, and the box's own list says the generator's.
  // Watched failing with the step's bounds check taken out: the proposal
  // was sent with a null, and refused 400 in words about the body's shape.
  test('refuses a bound left empty before anything is sent', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture', 'sales.order_line', ['fk_order_line_order'])
    await user.click(box(here, 'order'))
    await user.clear(within(here).getByRole('spinbutton', { name: 'At most' }))
    expect(blocks(here)).toEqual(['The generator refuses it: order is saved with its record, and its bounds are not whole numbers.'])
    const sent = plane.requests.length
    await user.click(within(here).getByRole('button', { name: 'Generate the form' }))
    const alert = await within(here).findByRole('alert')
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toContain('fk_order_line_order is saved with its record, and its bounds are not whole numbers.')
    expect(plane.requests.slice(sent).filter((request) => request.path === '/v1/form-proposals')).toEqual([])
  })
})

describe('what the server refuses at publish, said on the box', () => {
  // A delivery's tenant pinned: outside its order's key, which the bundle
  // check refuses of a form whose rows are saved with their record. Said
  // under the box in the check's words, and, generated, in the Policy
  // check, which the Publish step waits on. Watched failing with the
  // together rules left out of policyCheck: the check listed only the
  // order list nobody had decided.
  test('a pin outside the record’s key, under the box and in the Policy check', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture', 'sales.delivery', ['fk_delivery_order'])
    await user.click(box(here, 'order'))
    await user.click(within(here).getByRole('checkbox', { name: 'Pin tenant_id' }))
    await user.selectOptions(within(here).getByLabelText('Version column'), 'row_version')
    const refusal =
      "rowFilters: tenant_id is outside order's foreign key, and order is saved with its record: a person could read some of a record's rows and not others, and its bound would count rows they do not see"
    expect(blocks(here)).toEqual([`The server refuses the policy with it: ${refusal}.`])
    expect(await audit()).toEqual([])
    await user.click(within(here).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    const policy = await goTo(user, 'Policy')
    const check = within(policy).getByRole('region', { name: 'Policy check' })
    expect(
      within(check)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toContain(refusal)
  })

  // Lines too wide for one SQL Server batch at the cap: said under the box
  // in the publish gate's words, gone at the max it names, and generated
  // at the cap, the Publish step waits on it with the same words. Watched
  // failing with the Publish step not asking togetherBatchProblem: its
  // button was enabled.
  test('a max past one batch, under the box and on the Publish step', async () => {
    const user = await signIn(plane)
    const here = await choose(user, TOGETHER_CONNECTION, 'sales.order_line', ['fk_order_line_order'])
    await user.click(box(here, 'order'))
    const batch =
      'order is saved with its record up to 49 rows, and one change of a row binds up to 54 parameters on SQL Server, past the 2100 one batch holds; a max of 38 or less fits'
    expect(blocks(here)).toEqual([`Publishing refuses it: ${batch}.`])
    const most = within(here).getByRole('spinbutton', { name: 'At most' })
    await user.clear(most)
    await user.type(most, '38')
    expect(blocks(here)).toEqual([])
    await user.clear(most)
    await user.type(most, '49')
    await user.click(within(here).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    await writeLinePolicy(user)
    const publish = await goTo(user, 'Publish')
    const button = await within(publish).findByRole<HTMLButtonElement>('button', { name: 'Publish version 1' })
    expect(button.disabled).toBe(true)
    expect(
      within(within(publish).getByRole('note'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([`Rows saved with their record that publishing refuses: ${batch}. Lower At most on the Choose step and generate again.`])
    expect(await audit()).toEqual([])
  })
})

describe('the touch column of a rowversion parent', () => {
  // On SQL Server's order, the generator's candidates and no other, none
  // chosen; nothing of it where the order keeps a version column instead.
  // Chosen and then pinned, the column stays listed with the generator's
  // refusal under it, so it can be answered there. Watched failing with
  // every readable column listed (id and the foreign keys' columns among
  // them), and with the generator's refusal not handed to the choice.
  test('lists the generator’s candidates, none chosen, and says a pinned one refused', async () => {
    const user = await signIn(plane)
    const here = await choose(user, 'fixture-sqlserver', 'sales.order', ['fk_order_customer'])
    const touch = within(here).getByRole<HTMLSelectElement>('combobox', { name: 'Rows saved with these records move the rowversion through' })
    expect(touch.value).toBe('')
    expect(
      within(touch)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(['', 'order_date', 'status', 'amount', 'notes', 'group'])
    await user.selectOptions(touch, 'status')
    await user.click(within(here).getByRole('checkbox', { name: 'Pin status' }))
    await waitFor(() =>
      expect(computeAccessibleDescription(touch)).toContain(
        'The generator refuses it: the touch column status is pinned by the policy, and a save of rows would write it.',
      ),
    )
    expect(touch.value).toBe('status')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    await goTo(user, 'Connect')
    const postgres = await choose(user, 'fixture', 'sales.order', ['fk_order_customer'])
    expect(within(postgres).queryByRole('combobox', { name: 'Rows saved with these records move the rowversion through' })).toBeNull()
  })
})
