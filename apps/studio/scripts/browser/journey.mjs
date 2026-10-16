// The studio's journey in the browser, state by state, on a plane where every
// administrator publishes: from a restricted connection discovered, and a
// server this release was not tested on (0068), to a
// version restored, through the policy, the presentation, the preview's
// paper, a publish and its conflict, drift, a download, a refused restore and
// import, and a regeneration and what it carried (0030, 0052, 0062). Each
// state is measured on the way by the gate.

import { createSnapshot } from '@formancy/data-core'
import { renamedColumn } from '@formancy/data-fixtures'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { focusAfterEnter } from './measure.mjs'
import { snapshot, TOKENS } from './plane.mjs'
import { checkThePaper } from './styles.mjs'

/** The step on screen, and its button in the step list, by role and accessible name. */
export const step = (page, name) => page.getByRole('main', { name })
export const nav = (page, name) => page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: new RegExp(`^\\d+\\. ${name}$`) })

/**
 * The order the journey builds, from the Connect step with the fixture
 * discovered: the customer lookup, the tenant pinned, the version column
 * confirmed, generated; then a policy that fits -- clerks may read, create
 * and update, every field filled from the operations.
 */
export async function chooseOrder(page) {
  await page.getByRole('button', { name: 'Choose a root' }).click()
  const choose = step(page, 'Choose')
  await choose.getByLabel('Root table or view').selectOption({ label: 'sales.order' })
  await choose.getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }).check()
  await choose.getByRole('checkbox', { name: 'Pin tenant_id' }).check()
  await choose.getByLabel('Version column').selectOption('row_version')
}

export async function fillThePolicy(page) {
  const policy = step(page, 'Policy')
  for (const operation of ['read', 'create', 'update']) await policy.getByLabel(`Roles that may ${operation}`).fill('clerk')
  await policy.getByRole('button', { name: 'Fill every field from the operations' }).click()
  await policy.getByText('The policy fits this form.').waitFor()
}

/**
 * The journey, step by step: each entry brings the studio to a state and
 * names it, checking on the way what only that moment can show.
 */
export function journey(plane, check) {
  return [
    ['Connect, a restricted connection discovered', async (page) => {
      await page.getByRole('button', { name: 'Test fixture', exact: true }).click()
      // The SQL Server reader: since 0027 the one whose catalog hides what it may not use behind gaps.
      await page.getByRole('button', { name: 'Discover fixture-sqlserver-reader' }).click()
      // Inside the list of objects: the gaps above it name sales.order too.
      await page
        .getByRole('region', { name: 'What fixture-sqlserver-reader can see' })
        .getByRole('list', { name: 'Tables and views' })
        .getByText('sales.order', { exact: true })
        .click()
    }],
    // 0068: a server this release was not tested on, said in the warm
    // colour twice -- the rest of the connection test's answer, and a
    // sentence under the metadata's server line. The writer's capture as a
    // PostgreSQL 14 would answer it, made as src/test-server.ts's onServer
    // makes it: the server is outside the fingerprint, so the catalog is
    // the one captured. No database answers this here, only the gate's plane.
    ['Connect, a server this release was not tested on', async (page) => {
      const { fingerprint: _, ...contents } = snapshot('postgres-writer.json')
      plane.databases.set('fixture-writer', createSnapshot({ ...contents, serverVersion: '14.24', server: { product: 'postgresql', major: 14 } }))
      const untested = /This release of Formancy Data was not tested on PostgreSQL 14: /
      await page.getByRole('button', { name: 'Test fixture-writer', exact: true }).click()
      await page.getByRole('status').filter({ hasText: untested }).waitFor()
      await page.getByRole('button', { name: 'Discover fixture-writer', exact: true }).click()
      await page.getByRole('region', { name: 'What fixture-writer can see', exact: true }).getByText(untested).waitFor()
    }],
    ['Choose, the order with a lookup, a pin and a version column', async (page) => {
      await page.getByRole('button', { name: 'Discover fixture', exact: true }).click()
      await chooseOrder(page)
    }],
    ['Generate', async (page) => {
      await step(page, 'Choose').getByRole('button', { name: 'Generate the form' }).click()
      await step(page, 'Generate').waitFor()
    }],
    ['Policy, refused', async (page) => {
      await nav(page, 'Policy').click()
      // The Customer list's only filter: removing it takes its row, and the
      // button pressed, with it.
      const policy = step(page, 'Policy')
      const remove = policy.getByRole('button', { name: 'Remove Customer filter 1' })
      check(
        'removing the last Customer filter leaves the keyboard on Add a filter',
        await focusAfterEnter(page, remove, () => remove.waitFor({ state: 'detached' }), policy.getByRole('button', { name: 'Add a filter to the Customer list' })),
      )
    }],
    ['Policy, fitting', async (page) => {
      await step(page, 'Policy').getByRole('button', { name: 'Add a filter to the Customer list' }).click()
      await fillThePolicy(page)
    }],
    // Delete granted and the keys it acts through not yet accepted, then
    // each accepted by its own box (0052): the order is published deleting
    // from here on.
    ['Policy, delete refused for what it also does', async (page) => {
      const policy = step(page, 'Policy')
      await policy.getByLabel('Roles that may delete').fill('clerk')
      await policy.getByText('3 problems: the server refuses this policy until they are fixed.').waitFor()
    }],
    ['Policy, with a reach', async (page) => {
      const policy = step(page, 'Policy')
      const reach = policy.getByRole('group', { name: 'What deleting a record of sales.order also does' })
      for (const box of await reach.getByRole('checkbox').all()) await box.check()
      await policy.getByText('The policy fits this form.').waitFor()
    }],
    ['Presentation, a field moved down by keyboard', async (page) => {
      await nav(page, 'Presentation').click()
      // React moves the row that holds the button pressed, and a browser may
      // drop the focus of an element taken out of the document, even to be
      // put back, as Chromium does; React then gives it back. Watched
      // failing with the rows keyed by position, which remounts the row
      // instead of moving it.
      const presentation = step(page, 'Presentation')
      const down = presentation.getByRole('button', { name: 'Move down Customer' })
      check('Move down keeps the keyboard on the button pressed', await focusAfterEnter(page, down, () => presentation.getByText('Moved Customer down.').waitFor(), down))
    }],
    ['Presentation, a label refused', async (page) => {
      await step(page, 'Presentation').getByLabel('Label of notes').fill('')
    }],
    ['Preview, after a failed submit', async (page) => {
      await step(page, 'Presentation').getByLabel('Label of notes').fill('Remarks')
      await nav(page, 'Preview').click()
      await step(page, 'Preview').getByRole('button', { name: 'Validate' }).click()
      await page.waitForFunction(() => document.querySelector('form.sheet [aria-invalid="true"]') !== null, undefined, { timeout: 10_000 })
      await checkThePaper(page, check, 'the preview')
    }],
    ['Publish, published', async (page) => {
      await nav(page, 'Publish').click()
      await step(page, 'Publish').getByRole('button', { name: 'Publish version 1' }).click()
      await page.getByText('Published version 1 of sales-order.').waitFor()
    }],
    ['Publish, a conflict', async (page) => {
      // Another administrator publishes version 2 from elsewhere.
      const latest = (await plane.server.inject({ method: 'GET', url: '/v1/forms/sales-order/versions/latest', headers: { authorization: `Bearer ${TOKENS.admin}` } })).json()
      await plane.server.inject({ method: 'POST', url: '/v1/forms/sales-order/versions', headers: { authorization: `Bearer ${TOKENS.admin}` }, payload: { expectedBase: 1, bundle: latest.bundle } })
      await step(page, 'Publish').getByRole('button', { name: 'Publish version 2' }).click()
      await page.getByRole('button', { name: 'Rebase on version 2' }).waitFor()
    }],
    ['Publish, rebased by keyboard', async (page) => {
      // Rebasing closes the conflict the button sits in. What is left to do
      // is publish, on top of the version just rebased onto.
      const publish = step(page, 'Publish')
      const rebase = publish.getByRole('button', { name: 'Rebase on version 2' })
      const again = publish.getByRole('button', { name: 'Publish over version 2' })
      check('rebasing leaves the keyboard on Publish', await focusAfterEnter(page, rebase, () => again.waitFor(), again))
    }],
    ['Drift, blocking', async (page) => {
      const { fingerprint: _, ...contents } = structuredClone(plane.databases.get('fixture'))
      const order = contents.objects.find((object) => object.ref.name === 'order')
      order.columns = order.columns.filter((column) => column.name !== 'notes')
      plane.databases.set('fixture', createSnapshot(contents))
      await nav(page, 'Drift').click()
      await step(page, 'Drift').getByRole('button', { name: 'Check drift' }).click()
      await page.getByRole('region', { name: /^Version \d+ of sales-order, against the database now$/ }).waitFor()
    }],
    // 0062's export: what the browser saves from the newest version's link
    // is the file the store wrote, byte for byte, under the form's name. In
    // the browser because what a click on a `download` link of an object URL
    // saves is the browser's to say, where the suite only holds the Blob.
    // Watched failing, in Chromium, with the studio's trailing newline dropped.
    ['Drift, a version downloaded', async (page) => {
      const link = step(page, 'Drift').getByRole('region', { name: 'Download a version' }).getByRole('link', { name: /^Download version \d+$/ })
      const version = Number(/\d+$/.exec(await link.innerText())[0])
      const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
      const failure = await download.failure()
      const saved = failure === null ? readFileSync(await download.path()) : null
      const stored = readFileSync(join(plane.root, 'sales-order', `${String(version)}.json`))
      const differs = saved === null ? `the download failed: ${failure}` : `${String(saved.length)} bytes saved, ${String(stored.length)} in the store`
      check('the version downloaded is the file the store wrote, byte for byte', saved?.equals(stored) ? null : differs)
      check('and is named after the form and the version', download.suggestedFilename() === `sales-order-${String(version)}.json` ? null : `named ${download.suggestedFilename()}`)
    }],
    // 0030's answers to drift. Version 1 is bound to the dropped notes, so its
    // restore is refused, with what blocks it; the button stays, and keeps
    // the keyboard.
    ['Drift, a restore refused', async (page) => {
      const versions = step(page, 'Drift').getByRole('region', { name: 'Versions of sales-order' })
      const restore = versions.getByRole('button', { name: 'Restore version 1' })
      check('a refused restore leaves the keyboard on its button', await focusAfterEnter(page, restore, () => versions.getByRole('alert').waitFor(), restore))
    }],
    // 0062's import, of version 1's own file as another deployment would
    // take it: the database here lost the notes it is bound to, so the
    // import is refused with what blocks it, and the button keeps the keyboard.
    ['Drift, a version file chosen', async (page) => {
      const importing = step(page, 'Drift').getByRole('region', { name: 'Import a version' })
      const buffer = readFileSync(join(plane.root, 'sales-order', '1.json'))
      await importing.getByLabel('Version file').setInputFiles({ name: 'sales-order-1.json', mimeType: 'application/json', buffer })
      await importing.getByRole('button', { name: /^Import as version \d+$/ }).waitFor()
    }],
    ['Drift, an import refused by drift', async (page) => {
      const importing = step(page, 'Drift').getByRole('region', { name: 'Import a version' })
      const button = importing.getByRole('button', { name: /^Import as version \d+$/ })
      // The list of what blocks it, not any alert: every refusal is one, and
      // a state refused for another reason would measure a state not named here.
      const blocks = importing.getByRole('list', { name: 'What blocks it' })
      check('a refused import leaves the keyboard on its button', await focusAfterEnter(page, button, () => blocks.waitFor(), button))
    }],
    ['Drift, regenerated', async (page) => {
      // notes renamed to memo: the label chosen for notes is dropped, and memo is a field to give it to.
      plane.databases.set('fixture', renamedColumn(snapshot('postgres-owner.json'), { schema: 'sales', name: 'order' }, 'notes', 'memo'))
      const drift = step(page, 'Drift')
      await drift.getByRole('button', { name: 'Regenerate, keeping your presentation' }).click()
      await drift.getByRole('region', { name: /^Regenerated from version \d+$/ }).waitFor()
    }],
    ['Presentation, carried', async (page) => {
      await step(page, 'Drift').getByRole('button', { name: 'Continue to presentation' }).click()
      const presentation = step(page, 'Presentation')
      const give = presentation.getByRole('region', { name: /^Carried from version \d+$/ }).getByRole('button', { name: 'Give “Remarks”' })
      check('giving a dropped label to memo leaves the keyboard on the button pressed', await focusAfterEnter(page, give, () => presentation.getByText('Labelled memo “Remarks”.').waitFor(), give))
    }],
    ['Drift, restored', async (page) => {
      // The database put back: version 1 can be served again, and is restored as the next version.
      plane.databases.set('fixture', snapshot('postgres-owner.json'))
      await nav(page, 'Drift').click()
      const drift = step(page, 'Drift')
      await drift.getByRole('button', { name: 'Check drift' }).click()
      const versions = drift.getByRole('region', { name: 'Versions of sales-order' })
      await versions.getByRole('button', { name: 'Restore version 1' }).click()
      await versions.getByText(/^Restored version 1 as version \d+/).waitFor()
    }],
  ]
}
