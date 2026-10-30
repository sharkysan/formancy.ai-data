import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { audit, discover, findStatus, focusedName, generateOrder, goTo, grantOrderDelete, signIn, step, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { orderBundle, publishReviewed, PUBLISHER_REQUIRED, readOnly } from './test-review.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The whole journey of plan section 3, as one administrator walks it, against
 * the real server: what holds across the steps rather than inside one.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The routes of the administrator plane, and whoami. Nothing else is the studio's to call (0020, 0024). */
const ADMIN_PLANE = [
  /^GET \/v1\/whoami$/,
  /^GET \/v1\/connections$/,
  /^POST \/v1\/connections\/[^/]+\/test$/,
  /^GET \/v1\/connections\/[^/]+\/metadata$/,
  /^POST \/v1\/form-proposals$/,
  /^POST \/v1\/forms\/[^/]+\/versions$/,
  /^GET \/v1\/forms\/[^/]+\/versions\/latest$/,
  /^POST \/v1\/forms\/[^/]+\/drift$/,
  /^GET \/v1\/forms\/[^/]+\/versions$/,
  /^GET \/v1\/forms\/[^/]+\/versions\/\d+$/,
  /^POST \/v1\/forms\/[^/]+\/regenerations$/,
  /^POST \/v1\/forms\/[^/]+\/restorations$/,
  /^POST \/v1\/forms\/[^/]+\/imports$/,
  // Publication under review (0065): what this caller may do, asked at
  // sign-in on every deployment; and the draft routes, which exist only
  // under review.
  /^GET \/v1\/administration$/,
  /^POST \/v1\/forms\/[^/]+\/drafts$/,
  /^GET \/v1\/drafts$/,
  /^GET \/v1\/forms\/[^/]+\/drafts\/\d+$/,
  /^POST \/v1\/forms\/[^/]+\/drafts\/\d+\/approval$/,
  /^POST \/v1\/forms\/[^/]+\/drafts\/\d+\/rejection$/,
  // A connection's rows, for a browse role alone (0099); browse.test.tsx walks it.
  /^POST \/v1\/connections\/[^/]+\/browse$/,
]

/** Signed out, and in again as somebody else, as a person shares a studio: the workbench starts over. */
async function signInAs(user: User, token: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  await user.type(screen.getByLabelText('Host token'), token)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('navigation', { name: 'Steps' })
}

/** Draft `draft` of the order opened on the Review step, once the keyboard has gone to it. */
async function openDraft(user: User, review: HTMLElement, draft: number): Promise<HTMLElement> {
  await user.click(await within(review).findByRole('button', { name: `Open draft ${String(draft)} of sales-order` }))
  const region = await within(review).findByRole('region', { name: `Draft ${String(draft)} of sales-order` })
  await waitFor(() => expect(focusedName()).toBe(`Draft ${String(draft)} of sales-order`))
  return region
}

/** The Drift step with the order checked: its versions region, once its restore section has been read. */
async function orderVersions(user: User): Promise<HTMLElement> {
  const drift = await goTo(user, 'Drift')
  await user.clear(within(drift).getByLabelText('Form id'))
  await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
  await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
  const versions = await within(drift).findByRole('region', { name: 'Versions of sales-order' })
  await within(versions).findByRole('region', { name: 'Restore a version' })
  return versions
}

/**
 * Publication under review (0065), walked by the people it is for: an
 * author submits the order, withdraws it from the review queue and
 * submits it again; a publisher opens it on paper and approves it, and
 * later restores version 1 alone; and the author, back, is offered no
 * restore. `record` is called at each state.
 */
async function underReview(user: User, plane: TestPlane, record: (name: string) => Promise<void>): Promise<void> {
  await generateOrder(user)
  await writeOrderPolicy(user)
  const submit = await goTo(user, 'Submit')
  const press = await within(submit).findByRole('button', { name: 'Submit version 1 for review' })
  await record('Submit')
  await user.click(press)
  await within(submit).findByText('Draft 1 of sales-order submitted: a publisher other than you approves it.')
  await record('Submit, a draft submitted')
  await user.click(within(submit).getByRole('button', { name: 'Open the review queue' }))
  const queue = step('Review')
  await within(queue).findByRole('list', { name: 'Waiting for review' })
  await record('Review, the queue')
  const own = await openDraft(user, queue, 1)
  await record('Review, one’s own draft open')
  await user.click(within(own).getByRole('button', { name: 'Withdraw' }))
  await findStatus(own)
  await record('Review, a draft withdrawn')
  const again = await goTo(user, 'Submit')
  await user.click(await within(again).findByRole('button', { name: 'Submit version 1 for review' }))
  await within(again).findByText('Draft 3 of sales-order submitted: a publisher other than you approves it.')

  await signInAs(user, TOKENS.publisher)
  const review = await goTo(user, 'Review')
  const theirs = await openDraft(user, review, 3)
  await record('Review, a draft open for review')
  await user.click(within(theirs).getByRole('button', { name: 'Approve and publish' }))
  await within(theirs).findByText('Published as version 1.')
  await record('Review, a draft approved')
  // Version 2, published as review publishes, by the suite's own client:
  // not the studio's calls, so not in the record of them.
  const before = plane.requests.length
  await publishReviewed(plane, 1, await orderBundle(plane, readOnly(['auditor'])))
  plane.requests.splice(before)
  const versions = await orderVersions(user)
  await user.click(await within(versions).findByRole('button', { name: 'Restore version 1' }))
  await within(versions).findByText(/^Restored version 1 as version 3/)
  await record('Drift, restored by a publisher')

  await signInAs(user, TOKENS.admin)
  const authors = await orderVersions(user)
  await within(authors).findByText(PUBLISHER_REQUIRED)
  await record('Drift, an author offered no restore')
}

/**
 * From a published version 1 to the Drift step's answers (0030): version 2
 * published, the drift checked, a restore of version 1 refused by a dropped
 * column and the database put back, version 1 restored, and the form
 * regenerated and taken up as the draft; then, back on the Drift step,
 * version 1's file imported as the next version (0062), as another
 * deployment would import it. `record` is called at each state.
 */
async function evolve(user: User, plane: TestPlane, record: (name: string) => Promise<void>): Promise<void> {
  const publish = await goTo(user, 'Publish')
  // Found, not got: the step reads which version is published before its button names one.
  await user.click(await within(publish).findByRole('button', { name: 'Publish version 2' }))
  await within(publish).findByText('Published version 2 of sales-order.')
  const drift = await goTo(user, 'Drift')
  plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
  await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
  const versions = await within(drift).findByRole('region', { name: 'Versions of sales-order' })
  await user.click(await within(versions).findByRole('button', { name: 'Restore version 1' }))
  await within(versions).findByRole('alert')
  await record('Drift, a restore refused')
  plane.databases.set('fixture', OWNER_SNAPSHOT)
  await user.click(within(versions).getByRole('button', { name: 'Restore version 1' }))
  await within(versions).findByText(/^Restored version 1 as version 3/)
  await record('Drift, restored')
  await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
  const regenerated = await within(drift).findByRole('region', { name: 'Regenerated from version 3' })
  await record('Drift, regenerated')
  await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
  await screen.findByRole('region', { name: 'Carried from version 3' })
  await record('Presentation, carried')
  const importing = within(await goTo(user, 'Drift')).getByRole('region', { name: 'Import a version' })
  const file = new File([await readFile(join(plane.root, 'sales-order', '1.json'))], 'sales-order-1.json', { type: 'application/json' })
  await user.upload(within(importing).getByLabelText('Version file'), file)
  await record('Drift, a version file chosen')
  await user.click(await within(importing).findByRole('button', { name: 'Import as version 4' }))
  await within(importing).findByText(/^Imported as version 4 of sales-order/)
  await record('Drift, a version imported')
}

describe('the journey', () => {
  // Every step, from connecting to drift, audited where it stands: one step
  // that broke the floor -- an unnamed control, two landmarks with one name,
  // a heading skipped -- fails here with the step it is on.
  test('every step passes axe and names every control', async () => {
    const user = await signIn(plane)
    const findings: Record<string, string[]> = {}
    const record = async (name: string) => {
      findings[name] = [...(await audit()), ...unnamed()]
    }
    await record('Connect')
    await discover(user)
    await record('Connect, discovered')
    await generateOrder(user)
    await record('Generate')
    await goTo(user, 'Choose')
    await record('Choose')
    const policy = await writeOrderPolicy(user)
    await record('Policy')
    // Delete granted, its keys not yet accepted, then each accepted by its
    // box (0052): the published form deletes from here on, through
    // publishing, drift, restoring and regenerating.
    await user.type(within(policy).getByLabelText('Roles that may delete'), 'clerk')
    await record('Policy, delete refused for what it also does')
    await user.clear(within(policy).getByLabelText('Roles that may delete'))
    await grantOrderDelete(user, policy)
    await record('Policy, with a reach')
    const presentation = await goTo(user, 'Presentation')
    await record('Presentation')
    // A field in another section (0075), then taken back, so the rest of the journey is as before.
    await user.click(within(presentation).getByRole('button', { name: 'Move to Record Customer' }))
    await record('Presentation, a field in another section')
    await user.click(within(presentation).getByRole('button', { name: 'Undo' }))
    await goTo(user, 'Preview')
    await record('Preview')
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    await record('Publish')
    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    await record('Drift')
    await evolve(user, plane, record)
    expect(findings).toEqual(Object.fromEntries(Object.keys(findings).map((name) => [name, []])))
  })

  // The studio talks to the administrator plane and to nothing else: no
  // record route, no lookup route, nothing outside /v1 -- through the
  // versions, regeneration and restore of 0030 and the import of 0062 too.
  // A preview that fetched customers through the runtime plane would be the
  // studio writing with a clerk's permissions.
  test('speaks only the administrator plane', async () => {
    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    await goTo(user, 'Preview')
    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    await evolve(user, plane, async () => {})
    const calls = plane.requests.map((request) => `${request.method} ${request.path}`)
    expect(calls.filter((call) => !ADMIN_PLANE.some((route) => route.test(call)))).toEqual([])
    // Not vacuous: every route the journey has a reason to call, it called.
    // (Testing a connection is the one it skips.)
    const used = new Set(calls.map((call) => ADMIN_PLANE.findIndex((route) => route.test(call))))
    // (And without review, no draft route: there are none to call.)
    expect([...used].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  // A step that cannot work yet is listed, disabled, and says what it waits
  // for: nothing is shown that does not work.
  test('lists the steps that wait, and what each waits for', async () => {
    await signIn(plane)
    const steps = screen.getByRole('navigation', { name: 'Steps' })
    const buttons = within(steps).getAllByRole('button')
    expect(buttons.map((button) => [button.textContent, (button as HTMLButtonElement).disabled])).toEqual([
      ['1. Connect', false],
      ['2. Choose', true],
      ['3. Generate', true],
      ['4. Policy', true],
      ['5. Presentation', true],
      ['6. Preview', true],
      ['7. Publish', true],
      ['8. Drift', false],
      // Refused without a browse role, which this administrator does not hold (0099).
      ['9. Browse', true],
    ])
    expect(within(steps).getByRole('button', { name: '2. Choose' }).getAttribute('aria-describedby')).not.toBeNull()
    expect(step('Connect')).toBeTruthy()
    // The step's heading takes focus, so a keyboard starts where the step does.
    expect(document.activeElement?.textContent).toBe('Connect')
  })
})

describe('the journey under review', () => {
  let reviewed: TestPlane

  beforeEach(async () => {
    reviewed = await startPlane({ review: true })
  })

  afterEach(async () => {
    cleanup()
    await reviewed.close()
  })

  // Every state review adds, audited where it stands, for each person it
  // is for: the Submit step before and after, the queue, one's own draft
  // and a draft to approve, a decision each way, a publisher's restore and
  // an author's versions without one.
  test('every state passes axe and names every control', async () => {
    const user = await signIn(reviewed)
    const findings: Record<string, string[]> = {}
    await underReview(user, reviewed, async (name) => {
      findings[name] = [...(await audit()), ...unnamed()]
    })
    // Not vacuous: each state was reached and audited.
    expect(Object.keys(findings)).toHaveLength(9)
    expect(findings).toEqual(Object.fromEntries(Object.keys(findings).map((name) => [name, []])))
  })

  // Under review the studio still talks to the administrator plane and to
  // nothing else, and every draft route it has a reason to call, it called:
  // a step that reached past the plane, or a review route the studio never
  // calls, would each fail here.
  test('speaks only the administrator plane, and every route of review', async () => {
    const user = await signIn(reviewed)
    await underReview(user, reviewed, async () => {})
    const calls = reviewed.requests.map((request) => `${request.method} ${request.path}`)
    expect(calls.filter((call) => !ADMIN_PLANE.some((route) => route.test(call)))).toEqual([])
    const used = new Set(calls.map((call) => ADMIN_PLANE.findIndex((route) => route.test(call))))
    // Not publishing, importing or regenerating, which the other journey walks; and never the versions route to publish.
    expect([...used].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18])
  })

  // Under review the Publish step is Submit, and the Review step is listed,
  // never waiting: the queue is there to read before anything is generated.
  test('lists Submit for Publish, and the Review step', async () => {
    await signIn(reviewed)
    const buttons = within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button')
    expect(buttons.map((button) => [button.textContent, (button as HTMLButtonElement).disabled]).slice(6)).toEqual([
      ['7. Submit', true],
      ['8. Drift', false],
      ['9. Review', false],
      ['10. Browse', true],
    ])
  })
})
