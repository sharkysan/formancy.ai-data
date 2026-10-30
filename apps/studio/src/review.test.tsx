import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describeReassigned } from '@formancy/data-core'
import type { FormPolicy, ListView } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import { ReviewStep } from './review.js'
import { audit, focusedName, goTo, mount, paragraphs, pressEnter, servedDocument, signIn, unnamed } from './test-studio.js'
import type { User } from './test-studio.js'
import { client, ORDER, orderBundle, OWN_DRAFT, publishReviewed, PUBLISHER_REQUIRED, readOnly, submit } from './test-review.js'
import { OWNER_SNAPSHOT, renamedOrderColumn, startPlane, TOKENS, withColumn, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

/** A nullable column added to the order: drift that blocks nothing and is something to review. */
const DISCOUNT = {
  name: 'discount',
  ordinal: 99,
  databaseType: 'integer',
  type: { kind: 'integer', min: '-2147483648', max: '2147483647' },
  nullable: true,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
} as const

/**
 * The Review step, under review only (0065): the drafts waiting, one opened on white paper
 * through the preview the Preview step draws, and the decisions its
 * reader may make -- approve and publish, reject, withdraw -- offered as
 * the server's `refuses` says and nothing else, with the server's sentence
 * for each it refuses. Every draft here was submitted through the real
 * server by the person its token names.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane({ review: true })
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The Review step, signed in with `token`. */
async function reviewAs(token: string): Promise<{ user: User; review: HTMLElement }> {
  const user = await signIn(plane, token)
  return { user, review: await goTo(user, 'Review') }
}

/** The queue's entries, as a person reads them. */
async function queued(review: HTMLElement): Promise<string[]> {
  const list = await within(review).findByRole('list', { name: 'Waiting for review' })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => paragraphs(item).join(' '))
}

/**
 * Draft `draft` of `form` opened from the queue: its region, once it has
 * been read and the keyboard has gone to it. Not before: a press focused
 * while the studio is still moving the keyboard to the draft's heading
 * lands on the heading, which a person, who cannot press that fast, never
 * meets -- watched failing that way under load.
 */
async function open(user: User, review: HTMLElement, draft: number, form = 'sales-order'): Promise<HTMLElement> {
  await user.click(await within(review).findByRole('button', { name: `Open draft ${String(draft)} of ${form}` }))
  const region = await within(review).findByRole('region', { name: `Draft ${String(draft)} of ${form}` })
  await within(region).findByRole('form')
  await waitFor(() => expect(focusedName()).toBe(`Draft ${String(draft)} of ${form}`))
  return region
}

/** The decisions a region offers, by name. */
function decisions(region: HTMLElement): string[] {
  return within(region)
    .queryAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((name) => name !== 'Validate')
}

describe('the review queue', () => {
  // A publisher sees each draft waiting, by form, number, submitter and
  // base, and opens one to see the form the people filling it in would
  // get: the preview's own paper, the Blueprint theme, nothing of the
  // studio on it. The theme is read from the DOM -- an attribute, which the
  // accessibility tree does not carry -- as the preview's test reads it.
  // The keyboard goes to the draft it opened, which is below the queue. A
  // draft submitted since is listed when the queue is read again, which is
  // the publisher's to ask for: nothing notifies them.
  test('lists the drafts waiting, and opens one on white paper', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    const { user, review } = await reviewAs(TOKENS.publisher)
    expect(await queued(review)).toEqual(['sales-order, draft 1: “Order”, submitted by ada as the first version.'])
    expect(await audit()).toEqual([])
    // Opened, with the keyboard on its heading (open waits for it).
    const region = await open(user, review, 1)
    expect(paragraphs(region).slice(0, 2)).toEqual(['“Order”, 10 fields, bound to sales.order on fixture.', 'Submitted by ada as the first version.'])
    const paper = within(region).getByRole('form', { name: 'Order, draft 1' })
    expect(paper.getAttribute('data-formancy-theme')).toBe('blueprint')
    expect(within(paper).getByLabelText('Notes')).toBeTruthy()
    expect(decisions(region)).toEqual(['Approve and publish', 'Reject'])
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])

    await submit(plane, TOKENS.admin, null, await orderBundle(plane, readOnly(['auditor'])))
    await user.click(within(review).getByRole('button', { name: 'Read the queue again' }))
    await waitFor(async () => expect(await queued(review)).toHaveLength(2))
  })

  // Approved, the draft is the next version, and the version file is the
  // draft's bundle as the store writes it, nothing added: who approved it
  // is the trail's. The queue is read again and the draft has left it;
  // the buttons pressed are gone with its pending state, so the keyboard
  // goes to the draft's heading rather than to the top of the page.
  test('approves another’s draft as the next version, and reads the queue again', async () => {
    const sent = await orderBundle(plane)
    await submit(plane, TOKENS.admin, null, sent)
    const { user, review } = await reviewAs(TOKENS.publisher)
    const region = await open(user, review, 1)
    await pressEnter(user, within(region).getByRole('button', { name: 'Approve and publish' }))
    expect((await within(region).findByRole('status')).textContent).toBe('Published as version 1.')
    expect(paragraphs(region)).toContain('Nothing it rests on has changed since it was generated.')
    expect(await plane.store.read('sales-order', 1)).toEqual(sent)
    expect(await within(review).findByText('No draft is waiting for review.')).toBeTruthy()
    expect(decisions(region)).toEqual([])
    await waitFor(() => expect(focusedName()).toBe('Draft 1 of sales-order'))
    expect(await audit()).toEqual([])
  })

  // The database gained a column after the draft was submitted: that
  // blocks nothing, and the approval publishes, but it is something the
  // publisher should know they published over, listed with the answer.
  test('lists what differs from the database now with an approval it did not block', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    plane.databases.set('fixture', withColumn(OWNER_SNAPSHOT, 'order', DISCOUNT))
    const { user, review } = await reviewAs(TOKENS.publisher)
    const region = await open(user, review, 1)
    await user.click(within(region).getByRole('button', { name: 'Approve and publish' }))
    expect((await within(region).findByRole('status')).textContent).toBe('Published as version 1.')
    const differs = within(region).getByRole('list', { name: 'What differs from the database now, and blocks nothing' })
    expect(
      within(differs)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([expect.stringMatching(/^review column-added on sales\.order, column discount.*Affects no field of this form\.$/)])
    expect(await audit()).toEqual([])
  })

  // Rejected, nothing is published, and the draft leaves the queue: a
  // rejection that wrote a version, or left the draft to be approved by
  // the next publisher, would be no rejection.
  test('rejects another’s draft, and publishes nothing', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    const { user, review } = await reviewAs(TOKENS.publisher)
    const region = await open(user, review, 1)
    await pressEnter(user, within(region).getByRole('button', { name: 'Reject' }))
    expect((await within(region).findByRole('status')).textContent).toBe('Rejected draft 1 of sales-order: nothing was published.')
    expect(await plane.store.latest('sales-order')).toBeNull()
    expect(await within(review).findByText('No draft is waiting for review.')).toBeTruthy()
    await waitFor(() => expect(focusedName()).toBe('Draft 1 of sales-order'))
    expect(await audit()).toEqual([])
  })
})

describe('what a draft offers whom', () => {
  // An author opens anybody's draft and decides on none but their own,
  // which they may withdraw: someone else's offers nothing and says why
  // in the server's sentence, and their own offers no approval, with the
  // server's sentence for that. Buttons the server would refuse are not
  // shown to be refused.
  test('offers an author the withdrawal of their own draft and nothing else, saying why', async () => {
    await submit(plane, TOKENS.both, null, await orderBundle(plane))
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, readOnly(['auditor'])))
    const { user, review } = await reviewAs(TOKENS.admin)
    expect(await queued(review)).toEqual([
      'sales-order, draft 1: “Order”, submitted by lin as the first version.',
      'sales-order, draft 2: “Order”, submitted by ada (you) as the first version.',
    ])
    const theirs = await open(user, review, 1)
    expect(decisions(theirs)).toEqual([])
    expect(paragraphs(theirs)).toContain(PUBLISHER_REQUIRED)
    expect(await audit()).toEqual([])

    const mine = await open(user, review, 2)
    expect(decisions(mine)).toEqual(['Withdraw'])
    expect(paragraphs(mine)).toContain(PUBLISHER_REQUIRED)
    await pressEnter(user, within(mine).getByRole('button', { name: 'Withdraw' }))
    expect((await within(mine).findByRole('status')).textContent).toBe('Withdrew draft 2 of sales-order: nothing was published.')
    await waitFor(async () => expect(await queued(review)).toEqual(['sales-order, draft 1: “Order”, submitted by lin as the first version.']))
    expect(await audit()).toEqual([])
  })

  // Four eyes whatever the roles: someone holding both roles is offered
  // the withdrawal of their own draft, never its approval, in the server's
  // own-draft sentence. A studio that offered it on the strength of the
  // publisher role would be the server's refusal, one press later.
  test('never offers the approval of one’s own draft, publisher or not', async () => {
    await submit(plane, TOKENS.both, null, await orderBundle(plane))
    const { user, review } = await reviewAs(TOKENS.both)
    const region = await open(user, review, 1)
    expect(decisions(region)).toEqual(['Withdraw'])
    expect(paragraphs(region)).toContain(OWN_DRAFT)
    expect(await audit()).toEqual([])
  })

  // The keys a draft's author confirmed (0039) move grants onto what the
  // key stands for now, and the publisher approves that too: a review that
  // did not show them would approve a grant nobody saw move.
  test('shows the keys its author confirmed', async () => {
    const granting = { ...readOnly(), fields: { order_date: { read: ['clerk'], write: [] } } }
    await publishReviewed(plane, null, await orderBundle(plane, granting))
    plane.databases.set('fixture', renamedOrderColumn(OWNER_SNAPSHOT, 'order_date', 'order date'))
    const renamed = await orderBundle(plane, granting)
    const refused = await client(plane, TOKENS.admin).submitDraft('sales-order', 1, renamed)
    const keys = refused.ok ? [] : (refused.keys ?? [])
    expect(keys).toHaveLength(1)
    await submit(plane, TOKENS.admin, 1, renamed, keys)
    const { user, review } = await reviewAs(TOKENS.publisher)
    expect(await queued(review)).toEqual(['sales-order, draft 2: “Order”, submitted by ada over version 1.'])
    const region = await open(user, review, 2)
    const confirmed = within(region).getByRole('list', { name: 'Keys its author confirmed' })
    expect(
      within(confirmed)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(keys.map(describeReassigned))
    expect(await audit()).toEqual([])
  })
})

describe('what a draft shows its reviewer', () => {
  /** A list's items under a name, as a person reads them. */
  const items = (region: HTMLElement, name: string) =>
    within(within(region).getByRole('list', { name }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)

  // A publisher approves the policy as much as the form: who reads and
  // writes which column, which rows a list offers and a person reaches,
  // and what a delete also deletes. A review that drew the paper alone
  // would let a draft granting delete to every role look exactly like one
  // granting none. Said in the Policy step's words, for the order -- a row
  // filter, a filtered lookup, the keys a delete acts through -- and for
  // its lines, which have no tenant and are reached through their order.
  test('shows the policy approving it would put in force', async () => {
    const order = { ...ORDER, lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }], pinned: ['tenant_id'] }
    const granting: FormPolicy = {
      version: 1,
      operations: { read: ['clerk', 'auditor'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] },
      fields: { notes: { read: ['clerk', 'auditor'], write: ['clerk'] } },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
      cascades: [
        { table: { schema: 'sales', name: 'delivery' }, foreignKey: 'fk_delivery_order', onDelete: 'cascade' },
        { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' },
        { table: { schema: 'sales', name: 'parcel' }, foreignKey: 'fk_parcel_delivery', onDelete: 'cascade' },
      ],
    }
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, granting, order))
    const lines = {
      ...ORDER,
      root: { schema: 'sales', name: 'order_line' },
      formId: 'sales-order_line',
      title: 'Order line',
      lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
    }
    const through: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: [], update: [] },
      fields: {},
      rowFilters: [],
      lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] },
      through: ['order'],
    }
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, through, lines))
    const { user, review } = await reviewAs(TOKENS.publisher)

    const region = await open(user, review, 1)
    expect(items(region, 'Who may do what')).toEqual([
      'Roles that may read: clerk, auditor.',
      'Roles that may create: clerk.',
      'Roles that may update: clerk.',
      'Roles that may delete: clerk.',
    ])
    const fields = items(region, 'Fields')
    expect(fields).toContain('Notes (notes): read roles clerk, auditor; write roles clerk.')
    expect(fields).toContain('Order date (order_date): read roles nobody; write roles nobody.')
    expect(items(region, 'Rows')).toEqual([
      'Row filters on sales.order: tenant_id = trusted attribute tenant.',
      'Rows the Customer list may offer: tenant_id = trusted attribute tenant.',
    ])
    expect(items(region, 'What a delete also does')).toEqual([
      'fk_delivery_order of sales.delivery, as ON DELETE CASCADE.',
      'fk_order_line_order of sales.order_line, as ON DELETE CASCADE.',
      'fk_parcel_delivery of sales.parcel, as ON DELETE CASCADE.',
    ])
    expect(await audit()).toEqual([])

    const reached = await open(user, review, 1, 'sales-order_line')
    expect(items(reached, 'Who may do what')).toEqual([
      'Roles that may read: clerk.',
      'Roles that may create: nobody.',
      'Roles that may update: nobody.',
      'Roles that may delete: nobody.',
    ])
    expect(items(reached, 'Rows')).toEqual([
      'No row filter on sales.order_line: its rows are reached through Order alone.',
      'Rows the Order list may offer: tenant_id = trusted attribute tenant. Only rows of sales.order_line whose Order is one of these.',
    ])
    expect(within(reached).queryByRole('list', { name: 'What a delete also does' })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // A list view (0105) is what a person's grid offers above it, and the
  // view the grid opens on: approving the draft puts it in force as much
  // as the form. Said in words beside the policy -- its conditions by the
  // fields' labels, its order, and which view opens the grid -- so what is
  // approved is what was read; a draft without views says nothing of them.
  // Watched failing with the views left out of the draft's view.
  test('shows the list views approving it would offer, in words', async () => {
    const bundle = await orderBundle(plane)
    if (bundle.format !== 2) throw new Error('the order bundle is not format 2')
    const views: ListView[] = [
      { name: 'Placed', filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [{ field: 'order_date', direction: 'desc' }], default: true },
      { name: 'Large', filter: [{ field: 'amount', op: 'range', from: '1000', to: null }], sort: [] },
    ]
    await submit(plane, TOKENS.admin, null, { ...bundle, presentation: { ...bundle.presentation, views } })
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, readOnly(['auditor'])))
    const { user, review } = await reviewAs(TOKENS.publisher)

    const region = await open(user, review, 1)
    expect(items(region, 'List views')).toEqual([
      'Placed: where Status = placed; sorted by Order date descending; opens the grid.',
      'Large: where Amount from 1000.',
    ])
    expect(await audit()).toEqual([])
    const without = await open(user, review, 2)
    expect(within(without).queryByRole('list', { name: 'List views' })).toBeNull()
  })
})

describe('a decision the server refuses', () => {
  // The database lost a column the draft is bound to after it was
  // submitted. The approval runs the submit's checks again against the
  // database now and refuses, with each change that blocks it; nothing is
  // published, the draft stays to decide on, and the keyboard stays on the
  // button pressed, which is still there.
  test('shows the changes that block an approval now, and publishes nothing', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const { user, review } = await reviewAs(TOKENS.publisher)
    const region = await open(user, review, 1)
    await pressEnter(user, within(region).getByRole('button', { name: 'Approve and publish' }))
    const alert = await within(region).findByRole('alert')
    expect(paragraphs(alert)[0]).toBe('Draft 1 cannot be approved: the database differs from the one this version was generated from in a way it cannot serve.')
    const blocking = within(within(alert).getByRole('list', { name: 'What blocks it' })).getAllByRole('listitem')
    expect(blocking.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^blocking column-dropped on sales\.order, column notes.*Affects Notes \(notes\)\.$/),
    ])
    expect(await plane.store.latest('sales-order')).toBeNull()
    expect(decisions(region)).toEqual(['Approve and publish', 'Reject'])
    expect(focusedName()).toBe('Approve and publish')
    expect(await audit()).toEqual([])
  })

  // Withdrawn by its submitter after the publisher opened it: the
  // approval is refused in the server's sentence, the draft is read again
  // and says what happened, and nothing is offered on it any more. The
  // keyboard, on a button that is gone, goes to the draft's heading.
  test('says a draft was withdrawn since it was opened, and offers nothing more', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    const { user, review } = await reviewAs(TOKENS.publisher)
    const region = await open(user, review, 1)
    expect((await client(plane, TOKENS.admin).rejectDraft('sales-order', 1)).ok).toBe(true)
    await pressEnter(user, within(region).getByRole('button', { name: 'Approve and publish' }))
    expect((await within(region).findByRole('alert')).textContent).toBe('Draft 1 of sales-order was withdrawn by its submitter: submit it again for review.')
    await waitFor(() => expect(decisions(region)).toEqual([]))
    expect(paragraphs(region)).toContain('Withdrawn by ada, who submitted it.')
    await waitFor(() => expect(focusedName()).toBe('Draft 1 of sales-order'))
    expect(await plane.store.latest('sales-order')).toBeNull()
    expect(await audit()).toEqual([])
  })

  // Another draft of the form was approved after this one was opened, so
  // its base is not the newest version any more and nothing can approve
  // it. Said as the server says it, and the draft read again says so too.
  test('says a draft went stale since it was opened', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, readOnly(['auditor'])))
    const { user, review } = await reviewAs(TOKENS.publisher)
    const region = await open(user, review, 1)
    expect((await client(plane, TOKENS.publisher).approveDraft('sales-order', 2)).ok).toBe(true)
    await pressEnter(user, within(region).getByRole('button', { name: 'Reject' }))
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'Draft 1 of sales-order was submitted as the first version, and version 1 is the newest now: nothing can approve it. Submit it again over the newest version.',
    )
    await waitFor(() => expect(paragraphs(region)).toContain('Submitted as the first version, and version 1 is the newest now: nothing can approve it.'))
    expect(decisions(region)).toEqual([])
    expect(await within(review).findByText('No draft is waiting for review.')).toBeTruthy()
    expect(await audit()).toEqual([])
  })

  // Another publisher decided both drafts after this one's queue was read:
  // one rejected, one approved. Opened from the stale queue, each says what
  // became of it and offers nothing -- an Approve on a published draft
  // would be a press the server refuses.
  test('says what became of a draft decided since the queue was read', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, readOnly(['auditor'])))
    const { user, review } = await reviewAs(TOKENS.publisher)
    expect(await queued(review)).toHaveLength(2)
    const other = client(plane, TOKENS.both)
    expect((await other.rejectDraft('sales-order', 1)).ok).toBe(true)
    expect((await other.approveDraft('sales-order', 2)).ok).toBe(true)
    const rejected = await open(user, review, 1)
    expect(paragraphs(rejected)).toContain('Rejected by lin.')
    expect(decisions(rejected)).toEqual([])
    const published = await open(user, review, 2)
    expect(paragraphs(published)).toContain('Published as version 1.')
    expect(decisions(published)).toEqual([])
    expect(await audit()).toEqual([])
  })

  // A form whose drafts cannot be read -- an entry edited on disk -- is
  // named, and every other form's drafts are still listed: one damaged
  // file must not hide the queue.
  test('names a form whose drafts cannot be read, and lists every other', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    await submit(plane, TOKENS.admin, null, await orderBundle(plane, readOnly(), { ...ORDER, formId: 'other-order' }))
    await writeFile(join(plane.root, '.drafts', 'other-order', '1.json'), '{ "entry": "draft" }\n')
    const { review } = await reviewAs(TOKENS.publisher)
    expect(await queued(review)).toEqual(['sales-order, draft 1: “Order”, submitted by ada as the first version.'])
    expect(within(review).getByText(/^The drafts of other-order/).textContent).toBe(
      'The drafts of other-order could not be read, and are not listed: the operator’s log says why.',
    )
    expect(await audit()).toEqual([])
  })

  // With every form's drafts unreadable the queue lists nothing, and that
  // is no news that nothing waits: a damaged form may hold drafts. The
  // empty queue says it is only what could be read.
  test('does not say nothing waits when no form’s drafts could be read', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    await writeFile(join(plane.root, '.drafts', 'sales-order', '1.json'), '{ "entry": "draft" }\n')
    const { review } = await reviewAs(TOKENS.publisher)
    expect(await within(review).findByText('No draft that could be read is waiting for review.')).toBeTruthy()
    expect(within(review).queryByText('No draft is waiting for review.')).toBeNull()
    expect(within(review).getByText(/^The drafts of sales-order/)).toBeTruthy()
    expect(await audit()).toEqual([])
  })

  // An approval that wrote the version is news the publisher must keep,
  // even when reading the draft again then fails: a page that showed only
  // the failure would make a version that was written read like a request
  // that was not. The answer stays, and the failure is said beside it as a
  // failure to read the draft again. Watched failing with the answer drawn
  // inside the draft's read: only the failure was left.
  test('keeps the answer to a decision when the draft cannot be read again', async () => {
    await submit(plane, TOKENS.admin, null, await orderBundle(plane))
    let approved = false
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (approved && (init?.method ?? 'GET') === 'GET' && url.endsWith('/v1/forms/sales-order/drafts/1')) throw new TypeError('Failed to fetch')
      const response = await plane.fetch(input, init)
      if (url.endsWith('/approval')) approved = true
      return response
    }
    servedDocument()
    const user = userEvent.setup()
    mount(fetch)
    await user.type(screen.getByLabelText('Host token'), TOKENS.publisher)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation', { name: 'Steps' })
    const review = await goTo(user, 'Review')
    const region = await open(user, review, 1)
    await pressEnter(user, within(region).getByRole('button', { name: 'Approve and publish' }))
    expect((await within(region).findByRole('status')).textContent).toBe('Published as version 1.')
    await waitFor(() => expect(paragraphs(region)).toContain('The draft could not be read again: The data server could not be reached from this page.'))
    expect(within(region).getByRole('status').textContent).toBe('Published as version 1.')
    expect(decisions(region)).toEqual([])
    expect(await plane.store.versions('sales-order')).toEqual([1])
    expect(await audit()).toEqual([])
  })

  // A queue that could not be read says so, in the client's words, rather
  // than reading as a deployment with nothing waiting.
  test('says when the queue could not be read', async () => {
    servedDocument()
    const offline = createAdminClient({ token: TOKENS.publisher, fetch: async () => Promise.reject(new TypeError('Failed to fetch')) })
    render(
      <main aria-label="Review">
        <ReviewStep client={offline} me="grace" />
      </main>,
    )
    expect((await screen.findByText(/could not be reached/)).textContent).toBe('The data server could not be reached from this page.')
    expect(screen.queryByText('No draft is waiting for review.')).toBeNull()
    expect(await audit()).toEqual([])
  })
})
