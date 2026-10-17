import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { createSnapshot } from '@formancy/data-core'
import type { DriftChange, MetadataSnapshot } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { Drift } from './api.js'
import { audit, generateOrder, goTo, grantOrderDelete, paragraphs, signIn, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { onServer, OWNER_SNAPSHOT, READER_SNAPSHOT, startPlane, TOKENS, withColumn, withForeignKey, withGap, withoutColumn, withoutDelete } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 9, drift: a published form against its database now, classified by the
 * server against the form's bindings (0010). Each change is shown with its
 * severity and what that severity stops; the expectations are the server's
 * own report for the same form, asked directly.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** Publish the journey's order form, deleting with its keys accepted when `deleting`, and land on the Drift step with its id filled in. */
async function published(user: User, deleting = false): Promise<HTMLElement> {
  await generateOrder(user)
  const policy = await writeOrderPolicy(user)
  if (deleting) await grantOrderDelete(user, policy)
  const publish = await goTo(user, 'Publish')
  await user.click(await within(publish).findByRole('button', { name: 'Publish version 1' }))
  await user.click(await within(publish).findByRole('button', { name: 'Check its drift' }))
  return goTo(user, 'Drift')
}

async function serverReport(): Promise<Drift> {
  const drift = await createAdminClient({ token: TOKENS.admin, fetch: plane.fetch }).drift('sales-order')
  if (!drift.ok) throw new Error(drift.message)
  return drift.value
}

/**
 * The database after `alter table sales.shipment add column order_id bigint
 * references sales."order" on delete cascade`: a key nobody accepted that
 * would delete shipments with an order.
 */
function withShipmentsOfOrders(base: MetadataSnapshot): MetadataSnapshot {
  const id = base.objects.find((object) => object.ref.name === 'order')?.columns.find((column) => column.name === 'id')
  if (id === undefined) throw new Error('the snapshot has no order id')
  const column = { ...structuredClone(id), name: 'order_id', ordinal: 99, nullable: true, generated: 'none' as const }
  return withForeignKey(withColumn(base, 'shipment', column), { from: 'shipment', name: 'fk_shipment_order', columns: ['order_id'], onto: 'order', referencedColumns: ['id'], onDelete: 'cascade' })
}

/**
 * The database after a key was declared onto a partition of the order, as
 * PostgreSQL's discovery says it: a `referenced-by` gap on the order, since
 * this release lists a key only on the table it names (0049). What the gap
 * hides is a key that only refuses here, so a delete of an order no row
 * refers to still runs.
 */
function withKeyOntoAPartition(base: MetadataSnapshot): MetadataSnapshot {
  return withGap(base, {
    subject: { kind: 'object', object: { schema: 'sales', name: 'order' } },
    aspect: 'referenced-by',
    detail:
      'foreign key fk_audit_order of sales.audit refers to sales.order_2026, a partition of this table, and a delete from this table reaches its rows; this release lists a key only on the table it names',
  })
}

/** What the step says when review blocks delete and the server's verdict over the order's own description still lets it through. */
const DELETE_STILL_ALLOWED =
  'The server still allows delete: what blocks it is a change it does not compare when a request arrives (a lookup’s table, what refers to a table a delete reaches, privileges, row security or the account). The database still refuses what the account may not do, and each delete’s own statement refuses a foreign key that acts on it and that the policy does not accept, or a table it reaches that the account may not DELETE from. Review the form and publish it again.'

/** The keys the Policy step asks about, by their boxes' names, with whether each is ticked. */
function boxes(policy: HTMLElement): Array<[string, boolean]> {
  const reach = within(policy).getByRole('group', { name: 'What deleting a record of sales.order also does' })
  return within(reach)
    .getAllByRole('checkbox')
    .map((box) => [computeAccessibleName(box), (box as HTMLInputElement).checked])
}

/** The order table with one more nullable column: the database after `alter table ... add column`. */
function withNewColumn(base: MetadataSnapshot): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const order = contents.objects.find((object) => object.ref.name === 'order')
  order?.columns.push({ name: 'discount', ordinal: 99, databaseType: 'integer', type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, nullable: true, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true } })
  return createSnapshot(contents)
}

function items(container: HTMLElement, name: string): string[] {
  return within(within(container).getByRole('list', { name })).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

/** How the step writes one change, built from the server's report rather than retyped. */
function written(change: DriftChange, labels: Record<string, string>): string {
  const subject =
    change.subject.kind === 'scope'
      ? 'the discovery scope'
      : change.subject.kind === 'schema'
        ? `schema ${change.subject.schema}`
        : change.subject.kind === 'object'
          ? `${change.subject.object.schema}.${change.subject.object.name}`
          : `${change.subject.object.schema}.${change.subject.object.name}, ${change.subject.kind} ${change.subject.name}`
  const affects = change.affects.length === 0 ? 'Affects no field of this form.' : `Affects ${change.affects.map((key) => `${labels[key] ?? key} (${key})`).join(', ')}.`
  return `${change.severity} ${change.kind} on ${subject}${change.message}${affects}`
}

describe('drift', () => {
  // Nothing changed: said as a finding, with what the form may still do.
  test('says when nothing the form rests on has changed', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    expect(within(report).getByRole('status').textContent).toBe('Nothing this form rests on has changed since version 1 was published.')
    expect(items(report, 'What the published form may still do')).toEqual(['Read: still allowed', 'Create: still allowed', 'Update: still allowed', 'As a whole: usable as published.'])
    expect(await audit()).toEqual([])
  })

  // A bound column dropped: blocking, with what blocking stops, the field it
  // touches by its label, and the writes the published form can no longer do.
  test('shows a dropped bound column as blocking, and what it blocks', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    expect(server.changes.map((change) => [change.kind, change.severity])).toEqual([['column-dropped', 'blocking']])
    expect(items(report, 'Blocking')).toEqual(server.changes.map((change) => written(change, { notes: 'Notes' })))
    expect(paragraphs(report)).toContain('Blocks the form as published: a write it offers is stopped, or a field it shows can no longer be read, until it is reviewed.')
    // The Read line is the report's `readable` (0041): a dropped bound column breaks reads.
    expect(server.readable).toBe(false)
    expect(items(report, 'What the published form may still do')).toEqual([
      'Read: blocked by the changes below',
      `Create: ${server.writable.create ? 'still allowed' : 'blocked by the changes below'}`,
      `Update: ${server.writable.update ? 'still allowed' : 'blocked by the changes below'}`,
      'As a whole: not to be used as published until the blocking changes are reviewed.',
    ])
    expect(await audit()).toEqual([])
  })

  // A new nullable column is something to decide, not something broken: it
  // is under Review, and nothing is stopped.
  test('shows a new column as something to review that blocks nothing', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    plane.databases.set('fixture', withNewColumn(OWNER_SNAPSHOT))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    expect(server.blocking).toBe(false)
    expect(items(report, 'Review')).toEqual(server.changes.filter((change) => change.severity === 'review').map((change) => written(change, {})))
    expect(paragraphs(report)).toContain('Blocks nothing. A person has something to decide.')
    expect(within(report).queryByRole('list', { name: 'Blocking' })).toBeNull()
  })

  // The same catalog on a server this release was not tested on (0068): the
  // fingerprint is the published one, so a studio that took "nothing in the
  // catalog changed" for "nothing to say" would hide the one change there
  // is. Under Review, naming the server, and the form usable as published:
  // nothing is stopped for it.
  test('shows a server this release was not tested on as something to review that blocks nothing', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    plane.databases.set('fixture', onServer(OWNER_SNAPSHOT, '14.24', { product: 'postgresql', major: 14 }))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    expect(server.changes.map((change) => [change.kind, change.severity])).toEqual([['server-untested', 'review']])
    expect(within(report).getByRole('status').textContent).toBe('1 change, 0 blocking.')
    expect(items(report, 'Review')).toEqual(server.changes.map((change) => written(change, {})))
    expect(items(report, 'Review')[0]).toContain('This release of Formancy Data was not tested on PostgreSQL 14:')
    expect(items(report, 'What the published form may still do')).toEqual(['Read: still allowed', 'Create: still allowed', 'Update: still allowed', 'As a whole: usable as published.'])
    expect(await audit()).toEqual([])
  })

  // The connection now discovers as the restricted reader, who may not read
  // the customers the lookup offers. That is another account and a revoked
  // privilege, never "customer was dropped" (0004, 0027).
  test('shows another account that may not read a lookup target as privilege and account changes, not a deletion', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    plane.databases.set('fixture', READER_SNAPSHOT)
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    const kinds = server.changes.map((change) => change.kind)
    expect(kinds).toContain('account-changed')
    expect(kinds).toContain('privilege-narrowed')
    expect(kinds).not.toContain('root-dropped')
    expect(items(report, 'Blocking').join(' ')).toContain('privilege-narrowed')
    // Only review sees an account and a privilege: what it blocks and the
    // server still allows is said, so an administrator does not take a
    // blocked form for one nobody can use (0041).
    const blockedHere = [...(!server.readable && server.runtime.readable ? ['read'] : []), ...(['create', 'update'] as const).filter((operation) => !server.writable[operation] && server.runtime.writable[operation])]
    expect(blockedHere.length).toBeGreaterThan(0)
    const said = items(report, 'What the published form may still do').filter((item) => item.startsWith('The server still allows'))
    expect(said).toEqual([expect.stringContaining(`The server still allows ${blockedHere.length === 1 ? blockedHere[0] : `${blockedHere.slice(0, -1).join(', ')} and ${blockedHere.at(-1) as string}`}: what blocks`)])
    expect(said[0]).toMatch(/a lookup’s table, privileges, row security or the account\)\. The database still refuses what the account may not do\. Review the form and publish it again\.$/)
  })

  // Where review and the server agree, nothing more is said: a line that
  // appeared for every blocked form would teach an administrator to skip it.
  test('says nothing of the server when it refuses what review blocks', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    expect((await serverReport()).runtime).toEqual({ readable: false, writable: { create: false, update: false, delete: false } })
    expect(items(report, 'What the published form may still do').some((item) => item.startsWith('The server still allows'))).toBe(false)
  })

  // Delete is said only where the policy grants it -- the line above has
  // none for a form nobody may delete with. A key nobody accepted that would
  // act on a delete of an order is a `referrer-added` change that blocks it
  // (0051); only review compares what refers to the order, so the runtime's
  // verdict still allows delete, and the step says so, as it would of a
  // create or an update (0041), with what each delete's own statement still
  // refuses: that key (watched failing with delete never among what "the
  // server still allows"). The Policy step lists the keys of the snapshot
  // the form was generated from, so the new key is asked about only once
  // the form is generated again.
  test('says delete where the policy grants it, blocked by a key nobody accepted and still allowed by the server', async () => {
    const user = await signIn(plane)
    const drift = await published(user, true)
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    let report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    expect(items(report, 'What the published form may still do')).toEqual([
      'Read: still allowed',
      'Create: still allowed',
      'Update: still allowed',
      'Delete: still allowed',
      'As a whole: usable as published.',
    ])

    plane.databases.set('fixture', withShipmentsOfOrders(OWNER_SNAPSHOT))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await waitFor(() => expect(within(drift).getByRole('region', { name: 'Version 1 of sales-order, against the database now' }).querySelector('[data-severity="blocking"]')).not.toBeNull())
    report = within(drift).getByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    expect(server.changes.filter((change) => change.severity === 'blocking').map((change) => change.kind)).toEqual(['referrer-added'])
    expect({ review: server.writable.delete, runtime: server.runtime.writable.delete }).toEqual({ review: false, runtime: true })
    expect(items(report, 'Blocking')).toEqual(server.changes.filter((change) => change.severity === 'blocking').map((change) => written(change, {})))
    expect(items(report, 'What the published form may still do')).toEqual([
      'Read: still allowed',
      'Create: still allowed',
      'Update: still allowed',
      'Delete: blocked by the changes below',
      'As a whole: not to be used as published until the blocking changes are reviewed.',
      DELETE_STILL_ALLOWED,
    ])
    expect(await audit()).toEqual([])

    // The draft's keys are the discovery's: fk_shipment_order is not asked about ...
    const shipments = 'Also deletes the rows of sales.shipment that refer to it (fk_shipment_order, ON DELETE CASCADE)'
    expect(boxes(await goTo(user, 'Policy')).map(([name]) => name)).not.toContain(shipments)
    // ... until the form is generated again from the database as it is now.
    await user.click(within(await goTo(user, 'Choose')).getByRole('button', { name: 'Generate the form' }))
    await screen.findByRole('main', { name: 'Generate' })
    expect(boxes(await goTo(user, 'Policy'))).toContainEqual([shipments, false])
  })

  // What review alone blocks a delete for is not always what its statement
  // refuses: a key declared onto a partition of the order is a gap over
  // what refers to it, which stops delete in review, while neither the
  // runtime nor the statement's guard -- which refuses a key that acts, and
  // this one only refuses -- stops a delete of an order no row refers to.
  // So the step says the server still allows delete (watched failing with
  // the step silent about the server, as when it never said delete).
  test('says the server still allows delete behind a gap over what refers to the order', async () => {
    const user = await signIn(plane)
    const drift = await published(user, true)
    plane.databases.set('fixture', withKeyOntoAPartition(OWNER_SNAPSHOT))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    expect(server.changes.filter((change) => change.severity === 'blocking').map((change) => change.kind)).toEqual(['access-narrowed'])
    expect({ review: server.writable.delete, runtime: server.runtime.writable.delete }).toEqual({ review: false, runtime: true })
    expect(items(report, 'What the published form may still do').slice(3)).toEqual([
      'Delete: blocked by the changes below',
      'As a whole: not to be used as published until the blocking changes are reviewed.',
      DELETE_STILL_ALLOWED,
    ])
    expect(await audit()).toEqual([])
  })

  // DELETE revoked on the parcels, which a delete of an order reaches
  // through its deliveries: review blocks delete for it (0051), the
  // runtime's verdict over the order's own description does not, and the
  // step says so (watched failing as above). Each delete's statement asks
  // for DELETE on every table it reaches, which the sentence says.
  test('says the server still allows delete when DELETE is revoked on a table it reaches', async () => {
    const user = await signIn(plane)
    const drift = await published(user, true)
    plane.databases.set('fixture', withoutDelete(OWNER_SNAPSHOT, 'parcel'))
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const server = await serverReport()
    expect(server.changes.filter((change) => change.severity === 'blocking').map((change) => [change.kind, change.subject])).toEqual([
      ['privilege-narrowed', { kind: 'object', object: { schema: 'sales', name: 'parcel' } }],
    ])
    expect({ review: server.writable.delete, runtime: server.runtime.writable.delete }).toEqual({ review: false, runtime: true })
    expect(items(report, 'What the published form may still do').slice(3)).toEqual([
      'Delete: blocked by the changes below',
      'As a whole: not to be used as published until the blocking changes are reviewed.',
      DELETE_STILL_ALLOWED,
    ])
  })

  // A form id nobody published is the server's 404, in its words; one that
  // cannot be a form id is not sent.
  test('says when there is no such form, and sends nothing for an impossible id', async () => {
    const user = await signIn(plane)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'nothing-here')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    expect((await within(drift).findByRole('alert')).textContent).toBe('No form is called nothing-here.')
    const sent = plane.requests.length
    await user.clear(within(drift).getByLabelText('Form id'))
    await user.type(within(drift).getByLabelText('Form id'), 'Nothing Here')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    expect(within(drift).getByRole('alert').textContent).toMatch(/is not a form id/)
    expect(plane.requests.length).toBe(sent)
  })
})
