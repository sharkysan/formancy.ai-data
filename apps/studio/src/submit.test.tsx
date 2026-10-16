import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { audit, focusedName, generateOrder, goTo, paragraphs, pressEnter, signIn, step, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { client, orderBundle, publishReviewed, REVIEW_REQUIRED } from './test-review.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS, withColumn, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 8 under review (0065): the Publish step is the Submit step. Nobody
 * publishes directly, publishers included, so its button submits the
 * bundle as a draft over the version it read, for a publisher other than
 * its submitter to approve; and every refusal the publish step shows is
 * shown the same way, with a change that blocks it besides, since a submit
 * is checked against the database now as an approval will be.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane({ review: true })
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const drafts = (plane: TestPlane) => plane.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/drafts'))

async function toSubmit(user: User): Promise<HTMLElement> {
  await generateOrder(user)
  await writeOrderPolicy(user)
  const submit = await goTo(user, 'Submit')
  await within(submit).findByText(/No version of sales-order is published yet|Version \d+ of sales-order is published/)
  return submit
}

describe('submitting under review', () => {
  // The step says why it submits, in the server's sentence, and its button
  // makes a draft, not a version: nothing is written to the versions, and
  // the request is the drafts route with the bundle a publish would send.
  // A studio that went on calling the versions route would be refused
  // every time, and one that wrote somewhere else would be no review.
  test('submits a draft instead of publishing, and writes no version', async () => {
    const user = await signIn(plane)
    const submit = await toSubmit(user)
    expect(paragraphs(submit)).toContain(REVIEW_REQUIRED)
    expect(within(submit).getByText(/is published yet/).textContent).toBe('No version of sales-order is published yet: approved, your draft will be version 1.')
    expect(await audit()).toEqual([])
    await pressEnter(user, within(submit).getByRole('button', { name: 'Submit version 1 for review' }))
    expect(paragraphs(await within(submit).findByRole('status'))).toEqual(['Draft 1 of sales-order submitted: a publisher other than you approves it.'])
    expect(paragraphs(submit)).toContain('Nothing it rests on has changed since it was generated.')
    expect(await plane.store.latest('sales-order')).toBeNull()
    expect(drafts(plane).map((request) => (request.body as { expectedBase: unknown }).expectedBase)).toEqual([null])
    expect(plane.requests.filter((request) => request.path.endsWith('/versions') && request.method === 'POST')).toEqual([])
    const queued = await client(plane, TOKENS.publisher).drafts()
    expect(queued.ok && queued.value.drafts.map((draft) => [draft.form, draft.draft, draft.submittedBy])).toEqual([['sales-order', 1, 'ada']])
    // The keyboard stays on the button pressed, which is still there: another press is another draft.
    expect(focusedName()).toBe('Submit version 1 for review')
    expect(await audit()).toEqual([])
    await user.click(within(submit).getByRole('button', { name: 'Open the review queue' }))
    expect(step('Review')).toBeTruthy()
  })

  // A submit is checked against the database now: a column the form is
  // bound to dropped since it was generated is refused there and then,
  // with each change that blocks it, rather than discovered by the
  // publisher at approval. Nothing is written, not even a draft.
  test('shows the changes that block a draft, and submits nothing', async () => {
    const user = await signIn(plane)
    const submit = await toSubmit(user)
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    await pressEnter(user, within(submit).getByRole('button', { name: 'Submit version 1 for review' }))
    const alert = await within(submit).findByRole('alert')
    expect(paragraphs(alert)[0]).toBe('This draft cannot be submitted: the database differs from the one this version was generated from in a way it cannot serve.')
    const blocking = within(within(alert).getByRole('list', { name: 'What blocks it' })).getAllByRole('listitem')
    expect(blocking.map((item) => item.textContent)).toEqual([expect.stringMatching(/^blocking column-dropped on sales\.order, column notes.*Affects Notes \(notes\)\.$/)])
    const queued = await client(plane, TOKENS.publisher).drafts()
    expect(queued.ok && queued.value.drafts).toEqual([])
    expect(focusedName()).toBe('Submit version 1 for review')
    expect(await audit()).toEqual([])
  })

  // A change that blocks nothing is still something the author should see
  // before a publisher does: listed with the draft submitted.
  test('lists what differs from the database now and blocks nothing', async () => {
    const user = await signIn(plane)
    const submit = await toSubmit(user)
    const discount = { name: 'discount', ordinal: 99, databaseType: 'integer', type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, nullable: true, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true } } as const
    plane.databases.set('fixture', withColumn(OWNER_SNAPSHOT, 'order', discount))
    await user.click(within(submit).getByRole('button', { name: 'Submit version 1 for review' }))
    await within(submit).findByRole('status')
    const differs = within(submit).getByRole('list', { name: 'What differs from the database now, and blocks nothing' })
    expect(within(differs).getAllByRole('listitem').map((item) => item.textContent)).toEqual([expect.stringMatching(/^review column-added on sales\.order, column discount.*Affects no field of this form\.$/)])
    expect(await audit()).toEqual([])
  })

  // Somebody's draft was approved while this author worked, so the base the
  // step read is not the newest version. The server refuses the draft as
  // a publish's conflict, and the step offers the same rebase -- after
  // which the draft names the version that is published now, and would be
  // approvable.
  test('shows a conflict with the version approved meanwhile, and rebases onto it', async () => {
    const user = await signIn(plane)
    const submit = await toSubmit(user)
    await publishReviewed(plane, null, await orderBundle(plane))
    await user.click(within(submit).getByRole('button', { name: 'Submit version 1 for review' }))
    const alert = await within(submit).findByRole('alert')
    expect(paragraphs(alert)[0]).toBe('Somebody published version 1 while you worked. Yours was not submitted, and theirs is untouched.')
    expect(within(submit).getByText(/is published now/).textContent).toBe("Version 1 of sales-order is published now, and it is somebody else's. Submitting waits until you rebase on it.")
    expect(within(submit).getByRole('button', { name: 'Submit for review' })).toHaveProperty('disabled', true)
    expect(focusedName()).toBe('Rebase on version 1')
    await pressEnter(user, within(alert).getByRole('button', { name: 'Rebase on version 1' }))
    expect(focusedName()).toBe('Submit over version 1 for review')
    await user.click(within(submit).getByRole('button', { name: 'Submit over version 1 for review' }))
    expect(paragraphs(await within(submit).findByRole('status'))).toEqual(['Draft 2 of sales-order submitted: a publisher other than you approves it.'])
    expect(drafts(plane).at(-1)?.body).toMatchObject({ expectedBase: 1 })
    expect(await audit()).toEqual([])
  })

  // A submit discovers the database, so a database that does not answer
  // refuses the draft -- fail closed -- in a sentence that names no host or
  // port, which the driver's message does. Nothing is submitted.
  test('says a database did not answer, without saying where it is, and submits nothing', async () => {
    const user = await signIn(plane)
    const submit = await toSubmit(user)
    plane.unreachable.add('fixture')
    await user.click(within(submit).getByRole('button', { name: 'Submit version 1 for review' }))
    const alert = await within(submit).findByRole('alert')
    expect(alert.textContent).toBe('Connection fixture cannot be reached.')
    expect(document.body.textContent).not.toMatch(/10\.0\.0\.5|5432/)
    const queued = await client(plane, TOKENS.publisher).drafts()
    expect(queued.ok && queued.value.drafts).toEqual([])
    expect(await audit()).toEqual([])
  })

  // The connection taken out of the allowlist since the form was
  // generated: the server's sentence, which says why a draft keeps its
  // connection's name, shown as the publish step shows a refused bundle.
  test('shows the server’s refusal of a bundle', async () => {
    const user = await signIn(plane)
    const submit = await toSubmit(user)
    plane.removed.add('fixture')
    await user.click(within(submit).getByRole('button', { name: 'Submit version 1 for review' }))
    expect(paragraphs(await within(submit).findByRole('alert'))).toEqual([
      "The server refused the bundle: No connection is called fixture in this deployment: a version keeps its connection's name, which each deployment's allowlist resolves to its own database.",
    ])
    expect(await audit()).toEqual([])
  })
})
