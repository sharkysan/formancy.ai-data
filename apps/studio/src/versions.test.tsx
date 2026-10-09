import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import { applyPresentation, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormPolicy, PresentationOverrides } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { AdminClient, Bundle } from './api.js'
import { audit, focusedName, goTo, paragraphs, pressEnter, servedDocument, signIn } from './test-studio.js'
import type { User } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS, withoutColumn } from './test-server.js'
import { VersionsPanel } from './versions.js'
import type { TestPlane } from './test-server.js'

/**
 * Restoring an older version from the Drift step (0030): republished as the
 * next version, the same document, only when drift against it blocks nothing,
 * and against the newest version the list was read with.
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

const POLICY: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: {}, rowFilters: [], lookups: {} }

/** The order, published by another administrator as `formId`: `notes` relabelled `label`, or as generated. */
async function publishOrder(expectedBase: number | null, label?: string, formId = 'sales-order'): Promise<void> {
  const proposal = await admin.propose({ connection: 'fixture', root: { schema: 'sales', name: 'order' }, formId, title: 'Order', lookups: [], pinned: [], versionColumn: 'row_version' })
  if (!proposal.ok) throw new Error(proposal.message)
  const { form: base, bindings, snapshot, generation } = proposal.value
  const presentation: PresentationOverrides =
    label === undefined ? EMPTY_PRESENTATION : { version: 1, fields: [{ field: 'notes', anchor: { kind: 'column', column: 'notes' }, label }], sections: [] }
  const applied = applyPresentation(base, presentation, bindings)
  if (!applied.ok) throw new Error(applied.problems.join('; '))
  const bundle: Bundle = { format: 2, connection: 'fixture', generation, base, presentation, form: applied.form, bindings, policy: POLICY, snapshot }
  const outcome = await admin.publish(formId, expectedBase, bundle)
  if (!outcome.ok) throw new Error(outcome.message)
}

/** The Drift step with `formId` checked: its versions region. */
async function versionsOf(user: User, formId = 'sales-order'): Promise<HTMLElement> {
  const drift = await goTo(user, 'Drift')
  await user.clear(within(drift).getByLabelText('Form id'))
  await user.type(within(drift).getByLabelText('Form id'), formId)
  await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
  const versions = await within(drift).findByRole('region', { name: `Versions of ${formId}` })
  await within(versions).findByRole('button', { name: /^Restore version \d+$/ })
  return versions
}

function offered(versions: HTMLElement): string[] {
  return within(within(versions).getByRole('combobox', { name: 'Version to restore' }))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

const file = (version: number) => readFile(join(plane.root, 'sales-order', `${String(version)}.json`))

describe('restoring a version', () => {
  // The restore is a copy, not a regeneration: the new version's file holds
  // the old one's document (the same bytes, since the store wrote both),
  // and the drift report above moves to it. The
  // keyboard stays on the button pressed, which is still there.
  test('restores an older version as the next one, the same document', async () => {
    await publishOrder(null)
    await publishOrder(1, 'Their notes')
    const user = await signIn(plane)
    const versions = await versionsOf(user)
    expect(offered(versions)).toEqual(['Version 1'])
    expect(await within(versions).findByText('Version 1: “Order”, 10 fields, bound to sales.order on fixture.')).toBeTruthy()
    expect(await audit()).toEqual([])
    await pressEnter(user, within(versions).getByRole('button', { name: 'Restore version 1' }))
    expect((await within(versions).findByRole('status')).textContent).toBe(
      'Restored version 1 as version 3: the runtime serves it from now on, with the policy it had. The database was not changed.',
    )
    expect((await file(3)).equals(await file(1))).toBe(true)
    const drift = within(document.body).getByRole('main', { name: 'Drift' })
    await within(drift).findByRole('region', { name: 'Version 3 of sales-order, against the database now' })
    await waitFor(() => expect(offered(versions)).toEqual(['Version 1', 'Version 2']))
    // Once the list is read again, with version 2 now older too: the keyboard
    // is still on the button it pressed, and that button still restores what
    // the person chose. Checked before the re-read, this passed by timing;
    // after it, the choice had quietly become version 2 under the focus --
    // found on CI, where the re-read came first.
    expect(focusedName()).toBe('Restore version 1')
    expect(await audit()).toEqual([])
  })

  // The database lost a column version 1 is bound to. The server refuses the
  // restore, and the studio shows each change that blocks it, as the drift
  // report shows one; nothing is written.
  test('shows the changes that block a restore, and writes nothing', async () => {
    await publishOrder(null)
    await publishOrder(1, 'Their notes')
    plane.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const user = await signIn(plane)
    const versions = await versionsOf(user)
    await user.click(within(versions).getByRole('button', { name: 'Restore version 1' }))
    const alert = await within(versions).findByRole('alert')
    expect(paragraphs(alert)[0]).toBe('Version 1 cannot be restored: the database has changed in a way it cannot serve.')
    const blocking = within(within(alert).getByRole('list', { name: 'What blocks it' })).getAllByRole('listitem')
    expect(blocking.map((item) => item.textContent)).toEqual([expect.stringMatching(/^blocking column-dropped on sales\.order, column notes.*Affects Notes \(notes\)\.$/)])
    expect(await plane.store.versions('sales-order')).toEqual([1, 2])
    expect(await audit()).toEqual([])
  })

  // Somebody published after the list was read. The restore names the
  // newest version it saw, so the server refuses it (409) rather than
  // replacing theirs; the studio says so and reads the list again.
  test('says when somebody published since the list was read', async () => {
    await publishOrder(null)
    await publishOrder(1, 'Their notes')
    const user = await signIn(plane)
    const versions = await versionsOf(user)
    await publishOrder(2, 'Newer notes')
    await user.click(within(versions).getByRole('button', { name: 'Restore version 1' }))
    expect((await within(versions).findByRole('alert')).textContent).toBe('Somebody published version 3 since the list was read. Nothing was restored; the list now shows it.')
    await within(versions).findByRole('option', { name: 'Version 2' })
    expect(offered(versions)).toEqual(['Version 1', 'Version 2'])
    expect(await plane.store.versions('sales-order')).toEqual([1, 2, 3])
    // The choice is the select's: the button and the line under it follow it.
    await user.selectOptions(within(versions).getByRole('combobox', { name: 'Version to restore' }), '2')
    expect(within(versions).getByRole('button', { name: 'Restore version 2' })).toBeTruthy()
    expect(await within(versions).findByText('Version 2: “Order”, 10 fields, bound to sales.order on fixture.')).toBeTruthy()
  })

  // A restore the server could not even try -- the connection taken out of
  // the allowlist -- is its sentence, not a silence.
  test('says why a restore could not be tried', async () => {
    await publishOrder(null)
    await publishOrder(1, 'Their notes')
    const user = await signIn(plane)
    const versions = await versionsOf(user)
    plane.removed.add('fixture')
    await user.click(within(versions).getByRole('button', { name: 'Restore version 1' }))
    expect((await within(versions).findByRole('alert')).textContent).toBe('No connection is called fixture.')
  })

  // The panel is one form's. Checked after another, it must not keep that
  // form's outcome: "Restored version 1 as version 3" under another form's
  // heading is a false status about a form nobody restored.
  test('checking another form shows its versions, and nothing of the last one', async () => {
    await publishOrder(null)
    await publishOrder(1, 'Their notes')
    await publishOrder(null, undefined, 'other-order')
    await publishOrder(1, 'Other notes', 'other-order')
    const user = await signIn(plane)
    const first = await versionsOf(user)
    await user.click(within(first).getByRole('button', { name: 'Restore version 1' }))
    await within(first).findByRole('status')
    const second = await versionsOf(user, 'other-order')
    expect(within(second).queryByRole('status')).toBeNull()
    expect(within(second).queryByRole('alert')).toBeNull()
    expect(offered(second)).toEqual(['Version 1'])
    expect(await audit()).toEqual([])
  })

  // The newest version edited on disk is not served, so the drift check
  // refuses it; restoring an older version over it is the way back, and the
  // server allows it. A panel shown only after a successful check hid that
  // way exactly when it is needed.
  test('restores an older version over a newest one edited on disk', async () => {
    await publishOrder(null)
    await publishOrder(1, 'Their notes')
    const damaged = JSON.parse((await file(2)).toString('utf8')) as { snapshot: { objects: Array<{ comment: string | null }> } }
    for (const object of damaged.snapshot.objects) object.comment = 'edited'
    await writeFile(join(plane.root, 'sales-order', '2.json'), JSON.stringify(damaged, null, 2))
    const user = await signIn(plane)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    expect((await within(drift).findByRole('alert')).textContent).toBe('Version 2 of sales-order no longer validates and is not served.')
    const versions = await within(drift).findByRole('region', { name: 'Versions of sales-order' })
    await pressEnter(user, await within(versions).findByRole('button', { name: 'Restore version 1' }))
    expect((await within(versions).findByRole('status')).textContent).toMatch(/^Restored version 1 as version 3/)
    await within(drift).findByRole('region', { name: 'Version 3 of sales-order, against the database now' })
    expect(await audit()).toEqual([])
  })

  // A list that could not be read says so, in the client's words, rather
  // than reading as a form with nothing to restore.
  test('says when the versions could not be read', async () => {
    servedDocument()
    const offline = createAdminClient({ token: TOKENS.admin, fetch: async () => Promise.reject(new TypeError('Failed to fetch')) })
    render(
      <main aria-label="Drift">
        <VersionsPanel client={offline} formId="sales-order" onRestored={() => {}} />
      </main>,
    )
    expect((await screen.findByText(/could not be reached/)).textContent).toBe('The data server could not be reached from this page.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  // One version has nothing older to restore, and says so rather than
  // offering itself.
  test('says when there is nothing older to restore', async () => {
    await publishOrder(null)
    const user = await signIn(plane)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const versions = await within(drift).findByRole('region', { name: 'Versions of sales-order' })
    expect(await within(versions).findByText('Only version 1 is published: there is nothing older to restore.')).toBeTruthy()
    expect(within(versions).queryByRole('button')).toBeNull()
  })
})
