import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, within, waitFor } from '@testing-library/react'
import { createSnapshot, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { createAdminClient } from './api.js'
import type { Bundle } from './api.js'
import { audit, focusedName, goTo, paragraphs, pressEnter, signIn } from './test-studio.js'
import type { User } from './test-studio.js'
import { OWNER_SNAPSHOT, renamedOrderColumn, SQLSERVER_SNAPSHOT, startPlane, TOKENS, withoutColumn } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Importing a version another deployment published (0062), from the Drift
 * step: the version file that deployment's studio downloads, written here as
 * the next version after the server checks it as a publish and gates it on
 * this deployment's database as a restore. Two real servers with a store
 * each: `source`, where the order is published, and `target`, where the
 * studio runs. Every answer is the target server's own.
 */
let source: TestPlane
let target: TestPlane

beforeEach(async () => {
  source = await startPlane()
  target = await startPlane()
})

afterEach(async () => {
  cleanup()
  await Promise.all([source.close(), target.close()])
})

/** Clerks read the order, order_date by name: a grant that follows its key (0039). */
const POLICY: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: { order_date: { read: ['clerk'], write: [] } }, rowFilters: [], lookups: {} }

/** The order, generated and published on `plane` over `expectedBase` as an administrator there would. */
async function publishOn(plane: TestPlane, expectedBase: number | null): Promise<void> {
  const admin = createAdminClient({ token: TOKENS.admin, fetch: plane.fetch })
  const proposal = await admin.propose({ connection: 'fixture', root: { schema: 'sales', name: 'order' }, formId: 'sales-order', title: 'Order', lookups: [], pinned: [], versionColumn: 'row_version' })
  if (!proposal.ok) throw new Error(proposal.message)
  const { form, bindings, snapshot, generation } = proposal.value
  const bundle: Bundle = { format: 2, connection: 'fixture', generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy: POLICY, snapshot }
  const outcome = await admin.publish('sales-order', expectedBase, bundle)
  if (!outcome.ok) throw new Error(outcome.message)
}

const stored = (plane: TestPlane, version: number) => readFile(join(plane.root, 'sales-order', `${String(version)}.json`))

/** The source's version file, as its studio downloads it. */
async function exported(version = 1): Promise<File> {
  return new File([await stored(source, version)], `sales-order-${String(version)}.json`, { type: 'application/json' })
}

/** The Drift step's import region, signed in to the target. */
async function importRegion(user: User): Promise<HTMLElement> {
  const drift = await goTo(user, 'Drift')
  return within(drift).getByRole('region', { name: 'Import a version' })
}

/** `file` chosen as the version file, and the button that imports it, once the target's versions are read. */
async function choose(user: User, region: HTMLElement, file: File): Promise<HTMLElement> {
  await user.upload(within(region).getByLabelText('Version file'), file)
  return within(region).findByRole('button', { name: /^Import as version \d+$/ })
}

function items(container: HTMLElement, name: string): string[] {
  return within(within(container).getByRole('list', { name })).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

/** The order table with one more nullable column: the target's database after `alter table ... add column`. */
function withDiscount(base: MetadataSnapshot): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  contents.objects
    .find((object) => object.ref.name === 'order')
    ?.columns.push({ name: 'discount', ordinal: 99, databaseType: 'integer', type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, nullable: true, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true } })
  return createSnapshot(contents)
}

const imports = (plane: TestPlane) => plane.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/imports'))

describe('importing a version', () => {
  // What runs here is what was reviewed there: the file the source's store
  // wrote, sent as it was read and written by the target's store, byte for
  // byte. A studio that rebuilt the bundle -- from its own types, or by
  // asking for a proposal here -- would import something nobody reviewed.
  // The drift that allowed it is shown, as a restore's would be: a column
  // added here blocks nothing and is something to review. The keyboard
  // stays on the button pressed, which now names the next version.
  test("imports another deployment's version file as the same bytes, and shows the drift that allowed it", async () => {
    await publishOn(source, null)
    target.databases.set('fixture', withDiscount(OWNER_SNAPSHOT))
    const user = await signIn(target)
    const region = await importRegion(user)
    const button = await choose(user, region, await exported())
    expect(paragraphs(region)).toContain('sales-order version file: “Order”, 10 fields, bound to sales.order on fixture.')
    expect(button.textContent).toBe('Import as version 1')
    expect(await audit()).toEqual([])
    await pressEnter(user, button)
    expect((await within(region).findByRole('status')).textContent).toBe(
      'Imported as version 1 of sales-order: the runtime here serves it from now on, with the policy and the snapshot it was published with. The database was not changed.',
    )
    expect((await stored(target, 1)).equals(await stored(source, 1))).toBe(true)
    expect(imports(target).map((request) => request.body)).toEqual([{ expectedBase: null, bundle: JSON.parse((await stored(source, 1)).toString('utf8')) as unknown }])
    expect(items(region, 'What differs here, and blocks nothing')).toEqual([expect.stringMatching(/^review column-added on sales\.order, column discount.*Affects no field of this form\.$/)])
    await within(region).findByRole('button', { name: 'Import as version 2' })
    expect(focusedName()).toBe('Import as version 2')
    expect(await audit()).toEqual([])
  })

  // The target lost a column the version is bound to. The server refuses
  // the import as it refuses a restore, and the studio shows each change
  // that blocks it, with the field it takes; nothing is written. The
  // keyboard stays on the button, which is still there.
  test('shows the changes that block an import here, and writes nothing', async () => {
    await publishOn(source, null)
    target.databases.set('fixture', withoutColumn(OWNER_SNAPSHOT, 'order', 'notes'))
    const user = await signIn(target)
    const region = await importRegion(user)
    await pressEnter(user, await choose(user, region, await exported()))
    const alert = await within(region).findByRole('alert')
    expect(paragraphs(alert)[0]).toBe("This version cannot be imported: this deployment's database differs from the one it was published from in a way it cannot serve.")
    expect(items(alert, 'What blocks it')).toEqual([expect.stringMatching(/^blocking column-dropped on sales\.order, column notes.*Affects Notes \(notes\)\.$/)])
    expect(await target.store.latest('sales-order')).toBeNull()
    expect(focusedName()).toBe('Import as version 1')
    expect(await audit()).toEqual([])
  })

  // order_date renamed to "order date" in both databases, and the source
  // published from that: the key order_date stands here, in version 1, for
  // another column than in the file, and the clerk's grant would follow it
  // unasked. The server refuses until the keys are confirmed (0039); the
  // studio lists them in the server's words and confirms exactly the keys
  // the server listed, no more and no other. Confirming closes the list
  // and the button pressed: the keyboard goes back to the import button.
  test('lists the keys that stand for something else here, and confirms exactly those', async () => {
    await publishOn(target, null)
    const renamed = renamedOrderColumn(OWNER_SNAPSHOT, 'order_date', 'order date')
    target.databases.set('fixture', renamed)
    source.databases.set('fixture', renamed)
    await publishOn(source, null)
    const user = await signIn(target)
    const region = await importRegion(user)
    await pressEnter(user, await choose(user, region, await exported()))
    const alert = await within(region).findByRole('alert')
    expect(paragraphs(alert)[0]).toMatch(/^Version 1 bound order_date to other columns or lookups/)
    expect(items(alert, 'Keys that stand for something else here')).toEqual(['Grants for order_date were written for column order_date; it now stands for column order date.'])
    expect(await target.store.versions('sales-order')).toEqual([1])
    expect(await audit()).toEqual([])
    await pressEnter(user, within(alert).getByRole('button', { name: 'Confirm these keys and import' }))
    expect((await within(region).findByRole('status')).textContent).toMatch(/^Imported as version 2 of sales-order/)
    const [refused, confirmed] = imports(target)
    expect(confirmed?.body).toEqual({ ...(refused?.body as object), keysConfirmed: [{ field: 'order_date', was: { kind: 'column', column: 'order_date' }, now: { kind: 'column', column: 'order date' } }] })
    await waitFor(() => expect(focusedName()).toBe('Import as version 3'))
  })

  // Each refusal of the file is the server's sentence, with every problem
  // it lists, and nothing written: a connection this deployment's allowlist
  // does not have, a database of another engine, a base edited by hand
  // (which this deployment's generator does not write), and a database that
  // does not answer -- said without the address the driver gave.
  test('says why the server refuses the file, in its words, and writes nothing', async () => {
    await publishOn(source, null)
    const user = await signIn(target)
    const region = await importRegion(user)
    const button = await choose(user, region, await exported())
    // The alert of the press before is replaced, not added to: waited for until it says the next refusal.
    const refused = async (said: RegExp, problems = 0) => {
      await pressEnter(user, button)
      await waitFor(() => expect(paragraphs(within(region).getByRole('alert'))[0]).toMatch(said))
      expect(within(within(region).getByRole('alert')).queryAllByRole('listitem')).toHaveLength(problems)
    }

    target.removed.add('fixture')
    await refused(/^No connection is called fixture in this deployment: an import keeps the connection's name, which each deployment's allowlist resolves to its own database\.$/)
    target.removed.delete('fixture')

    target.databases.set('fixture', SQLSERVER_SNAPSHOT)
    await refused(/^This version cannot be imported: connection fixture is a sqlserver database here, and the version is bound to postgres\. A form's bindings belong to one engine\.$/)
    target.databases.set('fixture', OWNER_SNAPSHOT)

    target.unreachable.add('fixture')
    await refused(/^Connection fixture cannot be reached\.$/)
    expect(within(region).getByRole('alert').textContent).not.toMatch(/10\.0\.0\.5|5432/)
    target.unreachable.delete('fixture')

    // The base relabelled by hand: a form this deployment's generator does not write.
    const edited = JSON.parse((await stored(source, 1)).toString('utf8')) as { base: { title: string }; form: { title: string } }
    edited.base.title = 'Relaxed'
    edited.form.title = 'Relaxed'
    const relabelled = await choose(user, region, new File([`${JSON.stringify(edited, null, 2)}\n`], 'sales-order-1.json', { type: 'application/json' }))
    await pressEnter(user, relabelled)
    await waitFor(() => expect(paragraphs(within(region).getByRole('alert'))[0]).toBe('The bundle cannot be published.'))
    expect(within(within(region).getByRole('alert')).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(await target.store.latest('sales-order')).toBeNull()
    expect(await audit()).toEqual([])
  })

  // Somebody published here after the versions were read. The import names
  // the newest version it saw, so the server refuses it (409) rather than
  // writing over theirs; the studio says so, reads the versions again, and
  // the button names the version an import now makes.
  test('says when somebody published here since the versions were read', async () => {
    await publishOn(source, null)
    await publishOn(target, null)
    const user = await signIn(target)
    const region = await importRegion(user)
    const button = await choose(user, region, await exported())
    expect(button.textContent).toBe('Import as version 2')
    await publishOn(target, 1)
    await pressEnter(user, button)
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'Somebody published version 2 of sales-order here since its versions were read. Nothing was imported; importing now makes version 3.',
    )
    await within(region).findByRole('button', { name: 'Import as version 3' })
    expect(await target.store.versions('sales-order')).toEqual([1, 2])
  })

  // A file that is not a version file is the studio's to say, before any
  // request: it cannot even name the form to import into. Sending it would
  // ask the server about a form id the studio made up.
  test('says a file is not a version file, and sends nothing', async () => {
    const user = await signIn(target)
    const region = await importRegion(user)
    const before = target.requests.length
    await user.upload(within(region).getByLabelText('Version file'), new File(['{ "format": 2, '], 'sales-order-1.json', { type: 'application/json' }))
    expect((await within(region).findByRole('alert')).textContent).toBe('sales-order-1.json is not a version file: it is not JSON. Nothing was sent.')
    await user.upload(within(region).getByLabelText('Version file'), new File(['{ "hello": "world" }'], 'hello.json', { type: 'application/json' }))
    await within(region).findByText(/^hello\.json/)
    expect(within(region).getByRole('alert').textContent).toBe('hello.json is not a version file: it names no form, connection or bound table. Nothing was sent.')
    expect(within(region).queryByRole('button')).toBeNull()
    expect(target.requests.slice(before)).toEqual([])
    expect(await audit()).toEqual([])
  })

  // The drift report and the versions on the step are of the form checked.
  // An import of that form makes a newer version, and a report still
  // headed with the old one would describe a version the runtime no longer
  // serves; so the step checks it again.
  test('checks the form again when the version imported is of the form the step shows', async () => {
    await publishOn(source, null)
    await publishOn(target, null)
    const user = await signIn(target)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const region = within(drift).getByRole('region', { name: 'Import a version' })
    await user.click(await choose(user, region, await exported()))
    await within(region).findByRole('status')
    await within(drift).findByRole('region', { name: 'Version 2 of sales-order, against the database now' })
    const versions = within(drift).getByRole('region', { name: 'Versions of sales-order' })
    await within(versions).findByRole('button', { name: 'Restore version 1' })
  })

  // An answer is about the file it was sent for. Another file chosen while
  // the import is on its way replaces the first under the region's
  // description; the first file's answer shown beneath it -- a success, or
  // keys whose confirmation would send the first file's keys with the second
  // file's bundle -- would be about a file nobody has chosen any more. The
  // version it wrote is still a version of the form the step shows, so the
  // step is still told: the report heading moving to version 2 is the sign
  // the answer arrived and was handled.
  test("shows no answer about a file once another has been chosen, and still tells the step it wrote", async () => {
    await publishOn(source, null)
    await publishOn(target, null)
    const user = await signIn(target)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    await within(drift).findByRole('region', { name: 'Version 1 of sales-order, against the database now' })
    const region = within(drift).getByRole('region', { name: 'Import a version' })
    const button = await choose(user, region, await exported())
    const slow = target.hold(/\/imports$/)
    await pressEnter(user, button)
    await waitFor(() => expect(imports(target)).toHaveLength(1))
    await user.upload(within(region).getByLabelText('Version file'), new File(['{ "hello": "world" }'], 'hello.json', { type: 'application/json' }))
    await within(region).findByText(/^hello\.json is not a version file/)
    slow.release()
    await within(drift).findByRole('region', { name: 'Version 2 of sales-order, against the database now' })
    expect(within(region).queryByRole('status')).toBeNull()
    expect(within(region).getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'hello.json is not a version file: it names no form, connection or bound table. Nothing was sent.',
    ])
  })

  // A restore on the same step writes a version too. The import names the
  // newest version it read, so a button still naming the version before the
  // restore would be refused as somebody else's publish -- the
  // administrator's own restore, said as a conflict. The step tells the
  // import a version was written, and the import names the one after it.
  test('names the version after a restore made on the same step, and imports without a conflict', async () => {
    await publishOn(source, null)
    await publishOn(target, null)
    await publishOn(target, 1)
    const user = await signIn(target)
    const drift = await goTo(user, 'Drift')
    await user.type(within(drift).getByLabelText('Form id'), 'sales-order')
    await user.click(within(drift).getByRole('button', { name: 'Check drift' }))
    const region = within(drift).getByRole('region', { name: 'Import a version' })
    expect((await choose(user, region, await exported())).textContent).toBe('Import as version 3')
    const versions = within(drift).getByRole('region', { name: 'Versions of sales-order' })
    await user.click(await within(versions).findByRole('button', { name: 'Restore version 1' }))
    await within(versions).findByText(/^Restored version 1 as version 3/)
    await pressEnter(user, await within(region).findByRole('button', { name: 'Import as version 4' }))
    expect((await within(region).findByRole('status')).textContent).toMatch(/^Imported as version 4 of sales-order/)
    expect(within(region).queryByRole('alert')).toBeNull()
    expect(await target.store.versions('sales-order')).toEqual([1, 2, 3, 4])
  })
})
