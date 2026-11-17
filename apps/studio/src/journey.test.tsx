import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { createSnapshot } from '@formancy/data-core'
import { chooseShipping, OFFER_SHIP_ORDER, SHIP_ORDER, SOURCE_OF } from './test-actions.js'
import {
  audit,
  discover,
  findStatus,
  focusedName,
  generateOrder,
  goTo,
  grantOrderDelete,
  offerOnly,
  signIn,
  step,
  unnamed,
  writeOrderPolicy,
} from './test-studio.js'
import type { User } from './test-studio.js'
import { orderBundle, publishReviewed, PUBLISHER_REQUIRED, readOnly } from './test-review.js'
import { OWNER_ROUTINES, OWNER_SNAPSHOT, startPlane, TOKENS, withoutColumn } from './test-server.js'
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

/** What the studio sent to publish `formId`, as the server received it: the request body's bundle. */
function publishedBundle(plane: TestPlane, formId: string): Record<string, unknown> {
  const sent = plane.requests.find((request) => request.method === 'POST' && request.path === `/v1/forms/${formId}/versions`)
  const body = sent?.body as { bundle?: Record<string, unknown> } | undefined
  if (body?.bundle === undefined) throw new Error(`nothing was published as ${formId}`)
  return body.bundle
}

describe('the journey of a record and the rows saved with it (0155)', () => {
  // A rowversion order with its touch column chosen, and its lines saved
  // with it between 1 and 20, each published through the real server as
  // chosen, axe and a name on every control at each new state; and the
  // order regenerated from Drift keeps its touch column. Watched failing
  // with `together` and then `touchColumn` left out of proposalFor (each
  // bundle published without it), with At least's label pointing at
  // another id (the state's audit named the box unlabelled), and with
  // takeUp leaving the touch column out (the regenerated order's choice
  // was None).
  test('chooses the order’s touch column and its lines saved with it, names and audits each control, and publishes both as chosen', async () => {
    const user = await signIn(plane)
    // Each state audited where it stands, and failed there, by its name: the next step finds its controls by theirs.
    const record = async (name: string) => {
      expect({ [name]: [...(await audit()), ...unnamed()] }).toEqual({ [name]: [] })
    }
    await discover(user, 'fixture-sqlserver')
    await user.click(screen.getByRole('button', { name: 'Choose a root' }))
    const order = step('Choose')
    await user.selectOptions(within(order).getByLabelText('Root table or view'), 'sales.order')
    await offerOnly(user, order, ['fk_order_customer'])
    await user.click(within(order).getByRole('checkbox', { name: 'Pin tenant_id' }))
    const touch = 'Rows saved with these records move the rowversion through'
    await user.selectOptions(within(order).getByRole('combobox', { name: touch }), 'status')
    await record('Choose, the order’s touch column')
    await user.click(within(order).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    await writeOrderPolicy(user)
    const publishOrder = await goTo(user, 'Publish')
    await user.click(await within(publishOrder).findByRole('button', { name: 'Publish version 1' }))
    await within(publishOrder).findByText('Published version 1 of sales-order.')
    const touched = publishedBundle(plane, 'sales-order') as { generation: { touchColumn?: string }; bindings: { concurrency: { touch?: string } } }
    expect([touched.generation.touchColumn, touched.bindings.concurrency.touch]).toEqual(['status', 'status'])

    const lines = await goTo(user, 'Choose')
    await user.selectOptions(within(lines).getByLabelText('Root table or view'), 'sales.order_line')
    await offerOnly(user, lines, ['fk_order_line_order'])
    await user.click(within(lines).getByRole('checkbox', { name: 'Rows of this form are saved with their order' }))
    await record('Choose, the lines saved with their order')
    const least = within(lines).getByRole('spinbutton', { name: 'At least' })
    const most = within(lines).getByRole('spinbutton', { name: 'At most' })
    await user.clear(least)
    await user.type(least, '1')
    await user.clear(most)
    await user.type(most, '20')
    await user.click(within(lines).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    await record('Generate, the lines')
    const policy = await goTo(user, 'Policy')
    for (const operation of ['read', 'create', 'update']) await user.type(within(policy).getByLabelText(`Roles that may ${operation}`), 'clerk')
    await user.click(within(policy).getByRole('button', { name: 'Fill every field from the operations' }))
    await user.click(within(policy).getByRole('button', { name: 'Offer every row of sales.order' }))
    await waitFor(() => expect(within(within(policy).getByRole('region', { name: 'Policy check' })).getByRole('status').textContent).toMatch(/fits this form/))
    await record('Policy, the lines')
    const publishLines = await goTo(user, 'Publish')
    await user.click(await within(publishLines).findByRole('button', { name: 'Publish version 1' }))
    await within(publishLines).findByText('Published version 1 of sales-order_line.')
    await record('Publish, the lines')
    const saved = publishedBundle(plane, 'sales-order_line') as {
      generation: { lookups: Array<{ foreignKey: string; together?: unknown }> }
      bindings: { fields: Array<{ field: string; together?: unknown; writes: { create: boolean; update: boolean } }> }
    }
    expect(saved.generation.lookups.map((lookup) => [lookup.foreignKey, lookup.together])).toEqual([['fk_order_line_order', { min: 1, max: 20 }]])
    const field = saved.bindings.fields.find((binding) => binding.field === 'order')
    expect([field?.together, field?.writes]).toEqual([
      { min: 1, max: 20 },
      { create: true, update: false },
    ])
    // The version the store wrote is the bundle sent, its request as the studio asked it.
    const stored = JSON.parse(await readFile(join(plane.root, 'sales-order_line', '1.json'), 'utf8')) as { generation: unknown }
    expect(stored.generation).toEqual(saved.generation)

    // The order regenerated from Drift is the draft again, with its touch column chosen.
    const drift = await goTo(user, 'Drift')
    await user.clear(within(drift).getByLabelText('Form id'))
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await user.click(await within(drift).findByRole('button', { name: 'Regenerate, keeping your presentation' }))
    const regenerated = await within(drift).findByRole('region', { name: /^Regenerated from version 1$/ })
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    await screen.findByRole('main', { name: 'Presentation' })
    const again = await goTo(user, 'Choose')
    expect(within(again).getByRole<HTMLSelectElement>('combobox', { name: touch }).value).toBe('status')
  })
})

describe('the journey of an action over the open record (0163)', () => {
  // The fixture's ship_order, discovered with Include routines, offered on
  // the order with its key and the trusted tenant, granted to clerks after
  // the notice of what it does that nothing here binds, worded, and
  // published as chosen -- its request, its binding, its words and its
  // grant each in the version the store wrote -- with axe and a name on
  // every control at each new state, and only the administrator plane
  // called. Then the Drift step says it still runs, and that it stops once
  // the routine is dropped, with the change that stops it; and the form
  // regenerated and taken up keeps it chosen and worded. Watched failing
  // with `actions` left out of takeUp (the regenerated order's box was
  // unticked), with the words left out of the publish (the version
  // carried no `actions` in its presentation), and with the Drift step's
  // line for an action left out ("Run ship-order" was not on the page).
  test('chooses, grants, words and publishes an action, and its drift and regeneration keep it', async () => {
    const user = await signIn(plane)
    const record = async (name: string) => {
      expect({ [name]: [...(await audit()), ...unnamed()] }).toEqual({ [name]: [] })
    }
    const choose = await chooseShipping(user)
    await record('Choose, an action over the order')
    await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    await record('Generate, an action bound')

    const policy = await writeOrderPolicy(user)
    const notice = within(policy).getByRole('note', { name: 'What ship-order does is the deployment’s' })
    expect(notice.textContent).toContain(`It calls ${SHIP_ORDER} over the open record after incrementing row_version, in one transaction.`)
    await user.type(within(policy).getByLabelText('Roles that may run ship-order'), 'clerk')
    await waitFor(() => expect(within(within(policy).getByRole('region', { name: 'Policy check' })).getByRole('status').textContent).toMatch(/fits this form/))
    await record('Policy, an action granted')

    const presentation = await goTo(user, 'Presentation')
    const words = within(presentation).getByRole('region', { name: 'Actions' })
    const label = within(words).getByRole('textbox', { name: 'Label of the ship-order action' })
    await user.clear(label)
    await user.type(label, 'Ship it')
    await user.type(within(words).getByRole('textbox', { name: 'Asked before it runs for the ship-order action' }), 'Ship this order now?')
    await user.click(within(words).getByRole('checkbox', { name: 'This form’s list after ship-order' }))
    await record('Presentation, an action worded')

    const publish = await goTo(user, 'Publish')
    await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
    await within(publish).findByText('Published version 1 of sales-order.')
    await record('Publish, an action')
    const stored = JSON.parse(await readFile(join(plane.root, 'sales-order', '1.json'), 'utf8')) as {
      generation: { actions?: unknown }
      bindings: { actions?: Array<{ name: string; routine: unknown }> }
      presentation: { actions?: unknown }
      policy: { actions?: unknown }
    }
    expect(stored.generation.actions).toEqual([
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
    expect(stored.bindings.actions?.map((action) => [action.name, action.routine])).toEqual([
      ['ship-order', { schema: 'sales', name: 'ship_order', signature: 'pg_catalog.int8, pg_catalog.int4' }],
    ])
    expect(stored.presentation.actions).toEqual([{ action: 'ship-order', label: 'Ship it', confirm: 'Ship this order now?', refresh: ['list'] }])
    expect(stored.policy.actions).toEqual({ 'ship-order': { roles: ['clerk'] } })

    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    expect(within(report).getByText('Run ship-order: still allowed')).toBeTruthy()
    await record('Drift, an action')
    const { fingerprint: _, ...contents } = structuredClone(OWNER_ROUTINES)
    plane.databases.set('fixture', createSnapshot({ ...contents, routines: [] }))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await waitFor(() => expect(within(drift).getByText('Run ship-order: blocked by the changes below')).toBeTruthy())
    expect(drift.textContent).toContain(`routine-dropped on routine ${SHIP_ORDER}`)
    await record('Drift, an action blocked')

    plane.databases.set('fixture', OWNER_ROUTINES)
    await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
    const regenerated = await within(drift).findByRole('region', { name: /^Regenerated from version 1$/ })
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    await screen.findByRole('main', { name: 'Presentation' })
    expect(within(step('Presentation')).getByRole<HTMLInputElement>('textbox', { name: 'Label of the ship-order action' }).value).toBe('Ship it')
    const again = await goTo(user, 'Choose')
    expect(within(again).getByRole<HTMLInputElement>('checkbox', { name: OFFER_SHIP_ORDER }).checked).toBe(true)
    expect(within(again).getByRole<HTMLSelectElement>('combobox', { name: SOURCE_OF('order_id', 'bigint') }).value).toBe('key:id')

    const calls = plane.requests.map((request) => `${request.method} ${request.path}`)
    expect(calls.filter((call) => !ADMIN_PLANE.some((route) => route.test(call)))).toEqual([])
    // Discovered with its routines on asking, and no other request carries a query.
    expect(plane.requests.flatMap((request) => (request.query === undefined ? [] : [`${request.path}${request.query}`]))).toEqual([
      '/v1/connections/fixture/metadata?routines=true',
    ])
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
