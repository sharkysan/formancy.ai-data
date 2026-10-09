import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { createSnapshot } from '@formancy/data-core'
import type { DriftChange, MetadataSnapshot } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { Drift } from './api.js'
import { audit, generateOrder, goTo, paragraphs, signIn, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { OWNER_SNAPSHOT, READER_SNAPSHOT, startPlane, TOKENS, withoutColumn } from './test-server.js'
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

/** Publish the journey's order form, and land on the Drift step with its id filled in. */
async function published(user: User): Promise<HTMLElement> {
  await generateOrder(user)
  await writeOrderPolicy(user)
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
    expect(items(report, 'What the published form may still do')).toEqual(['Create: still allowed', 'Update: still allowed', 'As a whole: usable as published.'])
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
    expect(items(report, 'What the published form may still do')).toEqual([
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

  // The connection now discovers as the restricted reader, who may not read
  // the customers the lookup offers. That is another account and a revoked
  // privilege, never "customer was dropped" (0004, 0027).
  test('shows another account that may not read a lookup target as privilege and account changes, not a deletion', async () => {
    const user = await signIn(plane)
    const drift = await published(user)
    plane.databases.set('fixture', READER_SNAPSHOT)
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const report = await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const kinds = (await serverReport()).changes.map((change) => change.kind)
    expect(kinds).toContain('account-changed')
    expect(kinds).toContain('privilege-narrowed')
    expect(kinds).not.toContain('root-dropped')
    expect(items(report, 'Blocking').join(' ')).toContain('privilege-narrowed')
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
