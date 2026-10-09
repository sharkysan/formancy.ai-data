import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createBuilderSession } from '@formancy/builder-core'
import type { FormPolicy } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Bundle, Proposal } from './api.js'
import { PublishStep } from './publish.js'
import { audit, generateOrder, goTo, paragraphs, servedDocument, signIn, writeOrderPolicy } from './test-studio.js'
import type { User } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 8, publishing: compare-and-swap against the version the studio read
 * (0013), a conflict shown with the version somebody else published and a way
 * onto it, and a refusal shown with every reason the server gives.
 */
let plane: TestPlane
let other: AdminClient

beforeEach(async () => {
  plane = await startPlane()
  // A second administrator, publishing from somewhere else.
  other = createAdminClient({ token: TOKENS.admin, fetch: plane.fetch })
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const POLICY: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: {}, rowFilters: [], lookups: {} }

async function proposal(): Promise<Proposal> {
  const outcome = await other.propose({ connection: 'fixture', root: { schema: 'sales', name: 'order' }, formId: 'sales-order', title: 'Order', lookups: [], pinned: [], versionColumn: 'row_version' })
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.value
}

async function publishedElsewhere(expectedBase: number | null): Promise<void> {
  const { form, bindings, snapshot } = await proposal()
  const bundle: Bundle = { format: 1, connection: 'fixture', form: { ...form, title: 'Their order' }, bindings, policy: POLICY, snapshot }
  const outcome = await other.publish('sales-order', expectedBase, bundle)
  if (!outcome.ok) throw new Error(outcome.message)
}

async function toPublish(user: User): Promise<HTMLElement> {
  await generateOrder(user)
  await writeOrderPolicy(user)
  const publish = await goTo(user, 'Publish')
  await within(publish).findByText(/No version of sales-order is published yet|Version \d+ of sales-order is published/)
  return publish
}

describe('publishing', () => {
  // The first publish names no base; the next names the one just made. A
  // studio that forgot what it published would conflict with itself.
  test('publishes the first version, and the next one over it', async () => {
    const user = await signIn(plane)
    const publish = await toPublish(user)
    await user.click(within(publish).getByRole('button', { name: 'Publish version 1' }))
    expect((await within(publish).findByRole('status')).textContent).toContain('Published version 1 of sales-order.')
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    expect((await within(publish).findByText('Published version 2 of sales-order.')).textContent).toBeTruthy()
    expect(await plane.store.latest('sales-order')).toBe(2)
  })

  // Somebody published while this administrator worked. The server refuses
  // with 409 and the version that is current; the studio shows that version,
  // publishes nothing over it unasked, and offers to rebase -- after which
  // the publish names the new base and lands on top.
  test('shows a conflict with the current version, and rebases onto it', async () => {
    const user = await signIn(plane)
    const publish = await toPublish(user)
    await publishedElsewhere(null)
    await user.click(within(publish).getByRole('button', { name: 'Publish version 1' }))
    const alert = await within(publish).findByRole('alert')
    expect(paragraphs(alert)).toEqual([
      'Somebody published version 1 while you worked. Yours was not published, and theirs is untouched.',
      `Version 1: “Their order”, ${String((await proposal()).form.model.fields.length)} fields, bound to sales.order on fixture.`,
    ])
    expect(await audit()).toEqual([])
    await user.click(within(alert).getByRole('button', { name: 'Rebase on version 1' }))
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    await within(publish).findByText('Published version 2 of sales-order.')
    const first = await plane.store.read('sales-order', 1)
    expect((first as { form: { title: string } }).form.title).toBe('Their order')
  })

  // A version edited on the server's volume is not served (0019), so the
  // studio cannot read its base. It says so, and publishing finds out which
  // version is current through the same conflict -- which is how the
  // operator replaces a damaged version without touching the files.
  test('publishes over a version the server will not serve', async () => {
    await publishedElsewhere(null)
    const file = join(plane.root, 'sales-order', '1.json')
    const stored = JSON.parse(await readFile(file, 'utf8')) as { snapshot: { objects: Array<{ comment: string | null }> } }
    const first = stored.snapshot.objects[0]
    if (first !== undefined) first.comment = 'edited by hand'
    await writeFile(file, JSON.stringify(stored))

    const user = await signIn(plane)
    await generateOrder(user)
    await writeOrderPolicy(user)
    const publish = await goTo(user, 'Publish')
    expect((await within(publish).findByText(/could not be read/)).textContent).toBe(
      'The published version of sales-order could not be read: Version 1 of sales-order no longer validates and is not served. Publishing will find out which version is current.',
    )
    await user.click(within(publish).getByRole('button', { name: 'Publish version 1' }))
    await user.click(await within(publish).findByRole('button', { name: 'Rebase on version 1' }))
    await user.click(within(publish).getByRole('button', { name: 'Publish version 2' }))
    await within(publish).findByText('Published version 2 of sales-order.')
  })

  // The operator took the connection out of the allowlist after the form was
  // generated. The server refuses the bundle (422), and its sentence is shown.
  test('shows the server’s refusal of a bundle', async () => {
    const user = await signIn(plane)
    const publish = await toPublish(user)
    plane.removed.add('fixture')
    await user.click(within(publish).getByRole('button', { name: 'Publish version 1' }))
    expect(paragraphs(await within(publish).findByRole('alert'))).toEqual(['The server refused the bundle: No connection is called fixture.'])
  })

  // The studio checks the policy before it publishes; everything else in a
  // bundle -- that the bindings name the form's fields, that they were
  // generated from the snapshot sent with them -- the server checks alone.
  // When it refuses, every reason it gives is shown, not the first.
  test('shows every problem the server finds in a bundle', async () => {
    servedDocument()
    const generated = await proposal()
    const tampered: Proposal = {
      ...generated,
      bindings: {
        ...generated.bindings,
        snapshotFingerprint: 'sha256:0',
        fields: [...generated.bindings.fields, { kind: 'column', field: 'ghost', column: 'notes', type: { kind: 'text', maxLength: null, fixedLength: false }, nullable: true, writable: false }],
      },
    }
    const user = userEvent.setup()
    render(
      <main aria-label="Publish">
        <PublishStep
          client={other}
          connection="fixture"
          proposal={tampered}
          session={createBuilderSession(generated.form)}
          policy={POLICY}
          stale={false}
          onPublished={() => {}}
          onDrift={() => {}}
        />
      </main>,
    )
    await user.click(await screen.findByRole('button', { name: 'Publish version 1' }))
    const alert = await screen.findByRole('alert')
    expect(paragraphs(alert)).toEqual(['The server refused the bundle: The bundle cannot be published.'])
    expect(within(alert).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'the bindings were not generated from this snapshot',
      'the bindings name ghost, which the form does not have',
    ])
    expect(await audit()).toEqual([])
  })
})
