import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { createSnapshot, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient } from './api.js'
import { audit, focusedName, generateOrder, goTo, paragraphs, pressEnter, signIn, unnamed, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS, withColumn, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'
import { regenerateForm } from './regenerate.js'

/**
 * Regenerating a published form from the Drift step (0030): the newest
 * version generated again from the database now, its presentation carried
 * by what each field stands for, and every place it could not be carried
 * shown with a choice where one exists -- through the real server, whose
 * own regeneration is what the lists are compared with.
 */
let plane: TestPlane
let admin: AdminClient

beforeEach(async () => {
  plane = await startPlane()
  admin = createAdminClient({ token: TOKENS.admin, fetch: plane.fetch })
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** The order as the journey generates it, with `relabel` applied in Presentation, its policy written and version 1 published. */
async function publishOrder(user: User, relabel: Record<string, string> = {}): Promise<void> {
  await generateOrder(user)
  const presentation = await goTo(user, 'Presentation')
  for (const [key, label] of Object.entries(relabel)) {
    await user.clear(within(presentation).getByLabelText(`Label of ${key}`))
    await user.type(within(presentation).getByLabelText(`Label of ${key}`), label)
  }
  await writeOrderPolicy(user)
  const publish = await goTo(user, 'Publish')
  await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
  await within(publish).findByText('Published version 1 of sales-order.')
}

/** Check the drift of sales-order, then regenerate it: the regeneration's region. */
async function regenerate(user: User): Promise<HTMLElement> {
  const drift = await goTo(user, 'Drift')
  await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
  await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
  await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
  return within(drift).findByRole('region', { name: 'Regenerated from version 1' })
}

function items(container: HTMLElement, name: string): string[] {
  return within(within(container).getByRole('list', { name })).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

/** One column of sales.order in `base` renamed: to the catalog, one dropped and one added at the same place. */
function renamed(column: string, to: string, base: MetadataSnapshot = OWNER_SNAPSHOT): MetadataSnapshot {
  const meta = base.objects.find((object) => object.ref.name === 'order')?.columns.find((candidate) => candidate.name === column)
  if (meta === undefined) throw new Error(`the order has no ${column}`)
  return withColumn(withoutColumn(base, 'order', column), 'order', { ...meta, name: to })
}

/** sales.customer renamed to sales.client, and every foreign key that referenced it with it. */
function customerRenamed(): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
  for (const object of contents.objects) {
    if (object.ref.name === 'customer') object.ref.name = 'client'
    for (const key of object.foreignKeys) if (key.references?.table.name === 'customer') key.references.table.name = 'client'
  }
  return createSnapshot(contents)
}

/** The draft published as version 2, with the Policy step's leftovers from the old form removed and every field granted again. */
async function publishDraft(user: User, orphans: string[], strays: string[]): Promise<void> {
  const policy = await goTo(user, 'Policy')
  for (const key of orphans) await user.click(within(policy).getByRole('button', { name: `Remove ${key}` }))
  for (const key of strays) await user.click(within(policy).getByRole('button', { name: `Remove the ${key} lookup filter` }))
  await user.click(within(policy).getByRole('button', { name: 'Fill every field from the operations' }))
  expect(within(within(policy).getByRole('region', { name: 'Policy check' })).getByRole('status').textContent).toBe('The policy fits this form.')
  const publish = await goTo(user, 'Publish')
  await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
  await within(publish).findByText('Published version 2 of sales-order.')
}

describe('regenerating a published form', () => {
  // A column renamed reads as one dropped and one added, so the label chosen
  // for the old one cannot follow by itself (0030's cost). The studio shows
  // the drop in the server's words and offers the label to the fields that
  // are new -- the one chosen gets it, in one command, which Undo takes back
  // -- with the keyboard left on the button pressed. Without the offer the
  // label is retyped by hand, or lost at the next publish.
  test('renamed columns: the dropped label is reported, and given to the new field chosen', async () => {
    const user = await signIn(plane)
    await publishOrder(user, { notes: 'Delivery notes' })
    plane.databases.set('fixture', renamed('amount', 'total', renamed('notes', 'remarks')))
    const regenerated = await regenerate(user)
    const server = await admin.regenerate('sales-order')
    if (!server.ok) throw new Error(server.message)
    expect(server.value.conflicts.map((conflict) => conflict.kind)).toEqual(['field-gone'])
    expect(items(regenerated, 'Presentation not carried as it was')).toEqual(server.value.conflicts.map((conflict) => conflict.message))
    expect(items(regenerated, 'What the published policy no longer fits')).toEqual(server.value.policyProblems)
    expect(await audit()).toEqual([])

    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    const presentation = await screen.findByRole('main', { name: 'Presentation' })
    const carried = within(presentation).getByRole('region', { name: 'Carried from version 1' })
    const target = within(carried).getByRole('combobox', { name: 'Give “Delivery notes” to' })
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual(['Total (total)', 'Remarks (remarks)'])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
    const give = within(carried).getByRole('button', { name: 'Give “Delivery notes”' })
    await user.selectOptions(target, 'total')
    await pressEnter(user, give)
    expect((within(presentation).getByLabelText('Label of total') as HTMLInputElement).value).toBe('Delivery notes')
    expect(focusedName()).toBe('Give “Delivery notes”')
    await user.click(within(presentation).getByRole('button', { name: 'Undo' }))
    expect((within(presentation).getByLabelText('Label of total') as HTMLInputElement).value).toBe('Total')
    await user.selectOptions(target, 'remarks')
    await user.click(give)
    expect((within(presentation).getByLabelText('Label of remarks') as HTMLInputElement).value).toBe('Delivery notes')

    await publishDraft(user, ['notes', 'amount'], [])
    const latest = await admin.latest('sales-order')
    if (!latest.ok || latest.value.bundle.format !== 2) throw new Error('version 2 is not a format-2 bundle')
    expect(latest.value.bundle.presentation.fields).toEqual([{ field: 'remarks', anchor: { kind: 'column', column: 'remarks' }, label: 'Delivery notes' }])
  })

  // "Generate again" rebases the draft onto a new proposal, and the draft
  // no longer holds a label the regeneration dropped, so that rebase cannot
  // report it. Without the earlier conflicts kept, the step said everything
  // was carried while "Delivery notes" was lost before the next publish, and
  // the offer to give it to the renamed column was gone with it.
  test('generating again after a regeneration keeps the dropped label reported, and the offer to give it', async () => {
    const user = await signIn(plane)
    await publishOrder(user, { notes: 'Delivery notes' })
    plane.databases.set('fixture', renamed('notes', 'remarks'))
    const regenerated = await regenerate(user)
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    await screen.findByRole('region', { name: 'Carried from version 1' })

    const policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Add a row filter' }))
    await user.selectOptions(within(policy).getByLabelText('Column of row filter 2'), 'status')
    await user.click(within(policy).getByRole('button', { name: 'Generate again with these pins' }))
    await screen.findByRole('main', { name: 'Generate' })

    const presentation = await goTo(user, 'Presentation')
    const carried = within(presentation).getByRole('region', { name: 'Carried from version 1, then your earlier draft' })
    expect(within(carried).queryByText('Everything you chose was carried.')).toBeNull()
    expect(within(carried).getByText(/The label "Delivery notes" you chose for notes was dropped/)).toBeTruthy()
    const target = within(carried).getByRole('combobox', { name: 'Give “Delivery notes” to' })
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual(['Remarks (remarks)'])
    await user.click(within(carried).getByRole('button', { name: 'Give “Delivery notes”' }))
    expect((within(presentation).getByLabelText('Label of remarks') as HTMLInputElement).value).toBe('Delivery notes')
    expect(await audit()).toEqual([])
  })

  // The customer list's display column dropped: the runtime would refuse the
  // lookup, so the regeneration leaves it out with the sentence that refused
  // it, and generates the rest. A studio that listed nothing here would let
  // a person publish a form whose customer field silently became plain
  // columns.
  test('a lookup the runtime would now refuse is listed as left out', async () => {
    const user = await signIn(plane)
    await publishOrder(user)
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'customer', 'name'))
    const regenerated = await regenerate(user)
    const server = await admin.regenerate('sales-order')
    if (!server.ok) throw new Error(server.message)
    expect(server.value.lookupsDropped.map((dropped) => dropped.foreignKey)).toEqual(['fk_order_customer'])
    expect(items(regenerated, 'Lookups left out')).toEqual(server.value.lookupsDropped.map((dropped) => `${dropped.foreignKey}: ${dropped.message}`))
    expect(await audit()).toEqual([])
  })

  // The lookup's target renamed: its key follows (customer is now client)
  // and the generator's label changed too, so the person's "Buyer" is kept
  // and the generator's "Client" offered. Choosing it leaves nothing chosen
  // over the base, and the published presentation says so: an override
  // equal to the base would be a second spelling, which the server refuses.
  test('a lookup whose target was renamed: the generator’s label, chosen, publishes no override', async () => {
    const user = await signIn(plane)
    await publishOrder(user, { customer: 'Buyer' })
    plane.databases.set('fixture', customerRenamed())
    const regenerated = await regenerate(user)
    const server = await admin.regenerate('sales-order')
    if (!server.ok) throw new Error(server.message)
    expect(server.value.conflicts.map((conflict) => conflict.kind)).toEqual(['field-rekeyed', 'both-changed'])
    expect(items(regenerated, 'Presentation not carried as it was')).toEqual(server.value.conflicts.map((conflict) => conflict.message))

    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    const presentation = await screen.findByRole('main', { name: 'Presentation' })
    expect((within(presentation).getByLabelText('Label of client') as HTMLInputElement).value).toBe('Buyer')
    const carried = within(presentation).getByRole('region', { name: 'Carried from version 1' })
    await pressEnter(user, within(carried).getByRole('button', { name: 'Use the generator’s label for client' }))
    expect((within(presentation).getByLabelText('Label of client') as HTMLInputElement).value).toBe('Client')
    expect(focusedName()).toBe('Use the generator’s label for client')
    expect(await audit()).toEqual([])

    await publishDraft(user, ['customer'], ['customer'])
    const latest = await admin.latest('sales-order')
    if (!latest.ok || latest.value.bundle.format !== 2) throw new Error('version 2 is not a format-2 bundle')
    expect(latest.value.bundle.presentation).toEqual(EMPTY_PRESENTATION)
  })

  // order_date renamed to "order date": the key order_date now stands for
  // another column, and the clerk's grants on it were written for the old
  // one. The studio holds publishing until a person keeps or removes them,
  // and the server refuses them unless the publish confirms the key (0039):
  // kept, they publish only because the studio sends the decision (watched
  // failing, 422 keys-reassigned, with the studio sending none).
  test('a key that now stands for another column holds publishing until its grants are kept, and the kept key is confirmed', async () => {
    const user = await signIn(plane)
    await publishOrder(user)
    plane.databases.set('fixture', renamed('order_date', 'order date'))
    const regenerated = await regenerate(user)
    expect(items(regenerated, 'Keys that now stand for something else')).toEqual([
      'Grants for order_date were written for column order_date; it now stands for column order date.',
    ])
    await user.click(within(regenerated).getByRole('button', { name: 'Continue to presentation' }))
    await screen.findByRole('main', { name: 'Presentation' })

    let publish = await goTo(user, 'Publish')
    expect(within(publish).getByRole('button', { name: 'Publish version 2' })).toHaveProperty('disabled', true)
    expect(within(publish).getByRole('note').textContent).toContain('Grants for order_date were written for another column or lookup')
    const policy = await goTo(user, 'Policy')
    const reassigned = within(policy).getByRole('region', { name: 'Keys that now stand for something else' })
    expect(paragraphs(reassigned)).toContain('Publishing waits until each is decided, and the server refuses grants nobody decided.')
    expect(await audit()).toEqual([])
    await pressEnter(user, within(reassigned).getByRole('button', { name: 'Keep grants for order_date' }))
    // The decision closes the list, and the button with it: the keyboard goes to the verdict.
    expect(document.activeElement).toBe(within(policy).getByRole('region', { name: 'Policy check' }))
    publish = await goTo(user, 'Publish')
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    await within(publish).findByText('Published version 2 of sales-order.')
    const latest = await admin.latest('sales-order')
    expect(latest.ok && latest.value.bundle.policy.fields['order_date']).toEqual({ read: ['clerk'], write: ['clerk'] })
  })

  // "Generate again" makes a new draft from a new proposal; the key decided
  // on the one before stands for the same column in it, and the decision
  // has to reach the publish with it, or the server refuses grants the
  // person already kept (watched failing with the confirmations left behind
  // by "Generate again": 422 keys-reassigned).
  test('a key kept before "Generate again" is still confirmed when the draft publishes', async () => {
    const user = await signIn(plane)
    await publishOrder(user)
    plane.databases.set('fixture', renamed('order_date', 'order date'))
    await user.click(within(await regenerate(user)).getByRole('button', { name: 'Continue to presentation' }))
    const policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Keep grants for order_date' }))
    await user.click(within(policy).getByRole('button', { name: 'Add a row filter' }))
    await user.selectOptions(within(policy).getByLabelText('Column of row filter 2'), 'status')
    await user.click(within(policy).getByRole('button', { name: 'Generate again with these pins' }))
    await screen.findByRole('main', { name: 'Generate' })
    // status is pinned now, so its write grant is refused: filled again, the
    // policy fits the new form. What this proves is that the confirmation
    // reached the publish; the fill writes order_date's roles either way.
    await user.click(within(await goTo(user, 'Policy')).getByRole('button', { name: 'Fill every field from the operations' }))
    const publish = await goTo(user, 'Publish')
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    await within(publish).findByText('Published version 2 of sales-order.')
    const latest = await admin.latest('sales-order')
    expect(latest.ok && latest.value.bundle.policy.fields['order_date']).toEqual({ read: ['clerk'], write: ['clerk'] })
  })

  // Removing them takes the grants out of the policy, so nothing written for
  // the old column applies to the new one -- and leaves nothing to confirm,
  // so the publish confirms nothing: a removed key sent as confirmed would
  // let any grant that came back after the removal through unasked.
  test('removing a reassigned key’s grants takes them out of the published policy, and confirms nothing', async () => {
    const user = await signIn(plane)
    await publishOrder(user)
    plane.databases.set('fixture', renamed('order_date', 'order date'))
    await user.click(within(await regenerate(user)).getByRole('button', { name: 'Continue to presentation' }))
    const policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Remove grants for order_date' }))
    expect(within(policy).queryByRole('region', { name: 'Keys that now stand for something else' })).toBeNull()
    const publish = await goTo(user, 'Publish')
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    await within(publish).findByText('Published version 2 of sales-order.')
    const latest = await admin.latest('sales-order')
    expect(latest.ok && Object.hasOwn(latest.value.bundle.policy.fields, 'order_date')).toBe(false)
    const sent = plane.requests.filter((request) => request.method === 'POST' && request.path === '/v1/forms/sales-order/versions').at(-1)
    expect(sent?.body).not.toHaveProperty('keysConfirmed')
  })

  // A removal is a decision about the grants the key had, not about any it
  // is given afterwards. Removed and then filled again -- one click on
  // "Fill every field from the operations" -- the clerk's grants were back
  // on order_date, which names "order date" now, and published unasked, as
  // version 1 wrote them (watched failing: nothing asked about order_date
  // again). Given grants again, the key is asked about again, and only Keep
  // confirms it.
  test('a reassigned key whose grants come back after Remove is asked about again', async () => {
    const user = await signIn(plane)
    await publishOrder(user)
    plane.databases.set('fixture', renamed('order_date', 'order date'))
    await user.click(within(await regenerate(user)).getByRole('button', { name: 'Continue to presentation' }))
    let policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Remove grants for order_date' }))
    await user.click(within(policy).getByRole('button', { name: 'Fill every field from the operations' }))
    const reassigned = within(policy).getByRole('region', { name: 'Keys that now stand for something else' })
    expect(within(reassigned).getAllByRole('listitem')).toHaveLength(1)
    expect(within(reassigned).getByText('Grants for order_date were written for column order_date; it now stands for column order date.')).toBeTruthy()
    expect(within(reassigned).getByRole('button', { name: 'Keep grants for order_date' })).toBeTruthy()
    let publish = await goTo(user, 'Publish')
    expect(within(publish).getByRole('button', { name: 'Publish version 2' })).toHaveProperty('disabled', true)
    expect(within(publish).getByRole('note').textContent).toContain('Grants for order_date were written for another column or lookup')

    policy = await goTo(user, 'Policy')
    await user.click(within(policy).getByRole('button', { name: 'Keep grants for order_date' }))
    publish = await goTo(user, 'Publish')
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    await within(publish).findByText('Published version 2 of sales-order.')
    const sent = plane.requests.filter((request) => request.method === 'POST' && request.path === '/v1/forms/sales-order/versions').at(-1)
    expect(sent?.body).toMatchObject({ keysConfirmed: [{ field: 'order_date', was: { kind: 'column', column: 'order_date' }, now: { kind: 'column', column: 'order date' } }] })
  })

  // A regenerated draft's base is the version it was regenerated from, not
  // whatever is newest when the Publish step opens: read afresh, a version
  // somebody published meanwhile would be replaced without a word. Named,
  // it is the server's 409, and the conflict the step already shows. (A
  // label whose column is gone, with no new field to give it to, says that
  // too, rather than offering an empty choice.)
  test('a regenerated draft publishes against the version it came from', async () => {
    const user = await signIn(plane)
    await publishOrder(user, { notes: 'Delivery notes' })
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    await user.click(within(await regenerate(user)).getByRole('button', { name: 'Continue to presentation' }))
    const presentation = await screen.findByRole('main', { name: 'Presentation' })
    const carried = within(presentation).getByRole('region', { name: 'Carried from version 1' })
    expect(paragraphs(carried)).toContain('No field is new in this form to give it to.')
    expect(within(carried).queryByRole('combobox')).toBeNull()
    await user.click(within(await goTo(user, 'Policy')).getByRole('button', { name: 'Remove notes' }))
    const latest = await admin.latest('sales-order')
    if (!latest.ok || latest.value.bundle.format !== 2) throw new Error('version 1 is not a format-2 bundle')
    expect(await admin.publish('sales-order', 1, latest.value.bundle)).toEqual({ ok: true, value: { version: 2 } })

    const publish = await goTo(user, 'Publish')
    expect(within(publish).getByText(/^Regenerated from/).textContent).toBe(
      'Regenerated from version 1 of sales-order. Publishing makes version 2; if somebody has published since, the server says so and replaces nothing.',
    )
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    expect(paragraphs(await within(publish).findByRole('alert'))[0]).toBe('Somebody published version 2 while you worked. Yours was not published, and theirs is untouched.')
    expect(await plane.store.versions('sales-order')).toEqual([1, 2])
  })

  // A version published before 0030 kept no request to generate from. The
  // server says so; the studio says what to do instead, and offers nothing
  // to continue with.
  test('a version published before 0030 says to propose the form again', async () => {
    const proposal = await admin.propose({ connection: 'fixture', root: { schema: 'sales', name: 'order' }, formId: 'sales-order', title: 'Order', lookups: [], pinned: [], versionColumn: 'row_version' })
    if (!proposal.ok) throw new Error(proposal.message)
    const { form, bindings, snapshot } = proposal.value
    const policy: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: {}, rowFilters: [], lookups: {} }
    // Written straight into the store, as a version published before 0030 is: the server no longer accepts format 1.
    await plane.store.publish('sales-order', null, { format: 1, connection: 'fixture', form, bindings, policy, snapshot })
    const user = await signIn(plane)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
    expect(paragraphs(await within(drift).findByRole('alert'))).toEqual([
      'Version 1 was published before 0030 and kept no generation request: propose the form again.',
      'Choose its table again in the Choose step and generate it: publishing that makes the next version, which can be regenerated.',
    ])
    expect(within(drift).queryByRole('button', { name: 'Continue to presentation' })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // The version column dropped after the check: nothing can be generated
  // from the stored request (422 cannot-generate). The studio says so in
  // the server's words, says what to do next, and shows the drift the
  // refusal carried -- newer than the check's, which said nothing changed.
  // Without it the report above would still read "nothing has changed"
  // beside a refusal caused by a change.
  test('a regeneration the database cannot serve shows the refusal, what to do, and the drift it found', async () => {
    const user = await signIn(plane)
    await publishOrder(user)
    const drift = await goTo(user, 'Drift')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const checked = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    expect(within(checked).getByRole('status').textContent).toBe('Nothing this form rests on has changed since version 1 was published.')
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'row_version'))
    const server = await admin.regenerate('sales-order')
    if (server.ok || server.drift === undefined) throw new Error('the server regenerated a form whose version column is gone')
    expect(server.code).toBe('cannot-generate')

    await user.click(within(drift).getByRole('button', { name: 'Regenerate, keeping your presentation' }))
    expect(paragraphs(await within(drift).findByRole('alert'))).toEqual([
      server.message,
      'The report above says what changed. Nothing can be generated from the stored request until the database serves it again.',
    ])
    const report = within(drift).getByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const blocking = server.drift.changes.filter((change) => change.severity === 'blocking').length
    expect(within(report).getByRole('status').textContent).toBe(`${String(server.drift.changes.length)} ${server.drift.changes.length === 1 ? 'change' : 'changes'}, ${String(blocking)} blocking.`)
    expect(within(report).getAllByRole('listitem').some((item) => /concurrency-changed/.test(item.textContent ?? ''))).toBe(true)
    expect(within(drift).queryByRole('button', { name: 'Continue to presentation' })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // The fields a dropped label may be given to are read from the version
  // regenerated from. When that read fails, nothing is offered: offering
  // every field would let a label land on one that already has its own.
  test('offers no field to give a label to when the version regenerated from cannot be read', async () => {
    const user = await signIn(plane)
    await publishOrder(user, { notes: 'Delivery notes' })
    plane.databases.set('fixture', renamed('notes', 'remarks'))
    const unread = createAdminClient({
      token: TOKENS.admin,
      fetch: async (input, init) => (String(input).endsWith('/v1/forms/sales-order/versions/1') ? new Response(null, { status: 503 }) : plane.fetch(input, init)),
    })
    const regenerated = await regenerateForm(unread, 'sales-order')
    if (!regenerated.ok) throw new Error(regenerated.message)
    expect(regenerated.regeneration.conflicts.map((conflict) => conflict.kind)).toEqual(['field-gone'])
    expect(regenerated.fresh).toEqual([])
  })
})
