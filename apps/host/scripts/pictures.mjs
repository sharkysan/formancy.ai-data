// The host page's README pictures (0038): the host scenes of
// scripts/pictures/scenes.json, the hero among them, taken -- or, with
// --check, walked and their text compared -- by scripts/pictures/session.mjs.
// Its header says the arguments; the camera's says what it reads from the DOM
// and why.
//
// Its own plane, not the host gate's with one change. It differs from
// scripts/browser-test.mjs in five ways, because this one is the
// getting-started guide's setup and the gate's is a measuring rig: the server
// connects as `fixture.writer`, the order form's own account, whose grants
// and row-level security bind it, not as the owner, whom they do not; the
// request pins tenant_id; the policy is journey.json's, its fields filled by
// `fieldsFromOperations`, which steps.test.mjs holds to the studio's own;
// there are three identities; and ada has no attributes. The database is a
// real PostgreSQL (POSTGRES_IMAGE) through testcontainers and the real
// driver. ada publishes `pg-order` through `inject` with journey.json's first
// form and EMPTY_PRESENTATION; clara, a clerk of tenant 1, and otto, of
// tenant 2, sign in with literal tokens.
//
// The induced states, as the captions say: the deleted customer is inserted
// and deleted through the owner's connection, which the script opens beside
// the server and also asks the holds' questions over; the lost answer is an
// update the route hands to the server, requires stored with 200 and sent
// once, and then answers with a connection reset; the drift is `status`
// narrowed through the owner's connection after clara loaded the record,
// read from the catalog before and after as the widths the caption gives,
// which drift review, asked as ada, must say stops create and update, and
// the save after it must be sent once, answered 409 `drift` and leave the
// row as it was.
//
// The page is the workspace (0047): clara signs in, chooses pg-order under
// Forms, and the scenes are drawn with both renderers, which the renderer
// switch shows. The connection is the order form's own account, which may
// not read sales.order_line, so no child section is pictured: the guide's
// setup has no line form to publish (0047 says what nothing grants it).
//
// host-delete publishes the getting-started job's second form,
// journey.json's `deleting` -- pg-order with delete granted to whoever may
// read and every key a delete of an order acts through named (0051) -- when
// its scene starts, so the scenes before it show the guide's one form; it
// pictures a row's confirmation under the grid and keeps the order, which
// host-drift loads after it (0053).
//
// Walk order: typeahead, the hero, stale, refused, unknown, the unsaved
// notice, another tenant, a delete's confirmation, drift -- last, because it
// changes the table; the README shows them in scenes.json's order.
// Elements are found by role and accessible name, with one exception, said
// where it is: the host token is a password field, which has no role, so it
// is found by its label.
//
// `pnpm --filter @formancy/data-host pictures`, after `pnpm build`; the root's
// `pnpm pictures` runs it with the others. It needs Docker, for the database.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POSTGRES_IMAGE, startPostgresFixture, WRITER } from '@formancy/data-fixtures'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import postgres from 'postgres'
import journey from '../../../scripts/getting-started/journey.json' with { type: 'json' }
import { EMPTY_PRESENTATION, fieldsFromOperations } from '../../../scripts/getting-started/journey.mjs'
import { HOST } from '../../../scripts/getting-started/walk.mjs'
import { field, pictures, said, untilSnapshot } from '../../../scripts/pictures/session.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ORIGIN = 'http://host.invalid'
const TOKENS = { ada: 'pictures-host-ada', clara: 'pictures-host-clara', otto: 'pictures-host-otto' }
const IDENTITIES = {
  [TOKENS.ada]: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: {} },
  [TOKENS.clara]: { actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } },
  [TOKENS.otto]: { actor: { id: 'otto', roles: ['clerk'] }, attributes: { tenant: '2' } },
}

/** How long Angular may take to arrive, and the server to answer: the host gate's WITHIN. */
const WITHIN = 20_000

const [FORM] = journey.forms
/** The fixture's edge-case order, by its record token: id 2^53+1, the largest numeric(18,4) amount, customer Muster AG. */
const RECORD = 'k1:9007199254740993'
const ID = '9007199254740993'
const NOTES = 'Deliver to the side door'
/** The customer the refused scene chooses and has deleted before Save: tenant 1, a number the fixture does not use. */
const DELETED = { no: 1002, name: 'Brunner Logistik AG' }
/**
 * What clara types into the typeahead: a search the fixture's customers of
 * both tenants match -- tenant 1's Muster AG and tenant 2's Other Tenant
 * GmbH, under the same customer number -- so the list shows that she is
 * offered her tenant's alone. journey.json's "Muster" matches Muster AG only,
 * which is what any typeahead would show.
 */
const SEARCH = 'er'
const OTHER_TENANT = { tenant: 2, name: 'Other Tenant GmbH' }
/**
 * The drift host-drift induces, through the owner: `status` narrowed from
 * varchar(20) to varchar(8), the shape of DRIFTING's `tightened-text`, whose
 * verdict stops create and update and leaves read. Every status
 * ck_order_status allows fits, and no view names the column.
 */
const NARROWED = 'alter table sales."order" alter column status type varchar(8)'
/**
 * The widths host-drift's caption and docs/images/README.md give `status`,
 * before and after NARROWED. Neither is in the text pictured, so the act
 * reads them from the catalog and throws when they are not these: a fixture
 * that changed the width, or a NARROWED that changed the narrowing, fails it.
 */
const WIDTHS = { before: 20, after: 8 }
/** What clara types into the notes after the change: a field the change never touched. */
const DRIFT_NOTES = 'Call before delivery'

/** The plane over a fresh fixture, with pg-order published as the guide publishes it. */
async function startPlane() {
  let fixture
  try {
    // The default, named: the pictures say the image they were taken on, and
    // FORMANCY_IMAGES left set in a shell must not move them to another.
    fixture = await startPostgresFixture(POSTGRES_IMAGE)
  } catch (error) {
    throw new Error(`the host pictures need Docker, for their PostgreSQL, and testcontainers could not start one: ${String(error instanceof Error ? error.message : error).split('\n')[0]}`)
  }
  const url = new URL(fixture.writer)
  const registry = createConnectionRegistry(
    [{ id: FORM.connection, kind: 'postgres', host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: WRITER.user, password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } }],
    DRIVER_FACTORIES,
    { env: { PG_PASSWORD: WRITER.postgresPassword }, readFile: async () => '' },
  )
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-host-pictures-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = async (token) => (IDENTITIES[token] === undefined ? { ok: false, reason: 'ERR_JWS_INVALID' } : { ok: true, identity: IDENTITIES[token] })
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const server = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  const owner = postgres(fixture.admin, { onnotice: () => {} })
  const close = async () => {
    await server.close()
    await registry.close()
    await owner.end()
    rmSync(root, { recursive: true, force: true })
    await fixture.stop()
  }
  try {
    const ada = { authorization: `Bearer ${TOKENS.ada}` }
    const { connection, root: table, formId, title, lookups, pinned, versionColumn } = FORM
    const proposal = await server.inject({ method: 'POST', url: '/v1/form-proposals', headers: ada, payload: { connection, root: table, formId, title, lookups, pinned, versionColumn } })
    if (proposal.statusCode !== 200) throw new Error(`the proposal for ${formId} answered ${String(proposal.statusCode)}`)
    const { form, bindings, snapshot, generation } = proposal.json()
    const policy = { version: 1, ...journey.policy, fields: fieldsFromOperations(journey.policy, bindings) }
    const bundle = { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot }
    const published = await server.inject({ method: 'POST', url: `/v1/forms/${formId}/versions`, headers: ada, payload: { expectedBase: null, bundle } })
    if (published.statusCode !== 201) throw new Error(`publishing ${formId} answered ${String(published.statusCode)}`)
  } catch (error) {
    await close()
    throw error
  }
  const secrets = [...Object.values(TOKENS), fixture.admin, fixture.writer, WRITER.postgresPassword, decodeURIComponent(new URL(fixture.admin).password)]
  return { server, owner, secrets, close }
}

function actsOver(plane) {
  const { owner } = plane
  const pane = (page, name) => page.getByRole('region', { name, exact: true })
  const paper = (page, name) => pane(page, name).getByRole('form', { name: `Order, ${name}`, exact: true })
  const box = (page, name, label) => paper(page, name).getByRole('textbox', { name: field(label) })
  const customer = (page, name) => paper(page, name).getByRole('combobox', { name: field(journey.order.customer.label) })
  const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
  /** The detail: the region its heading names -- the open record's, or "No record open". */
  const detail = (page, name) => page.getByRole('region', { name, exact: true })
  const save = (page, name) => paper(page, name).getByRole('button', { name: HOST.save, exact: true }).click()
  const row = async () => (await owner`select status, notes, row_version from sales."order" where id = ${ID}`)[0]
  /** Press `button`, and Discard and continue if the page asks first: a scene's work is not the next one's. */
  const carryOn = async (page, button) => {
    await button.click()
    const notice = page.getByRole('region', { name: 'Unsaved changes', exact: true })
    if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: 'Discard and continue', exact: true }).click()
  }
  const load = async (page) => {
    const disclosure = page.getByRole('button', { name: HOST.openByToken, exact: true })
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
    await page.getByRole('textbox', { name: HOST.record, exact: true }).fill(RECORD)
    await carryOn(page, page.getByRole('button', { name: HOST.load, exact: true }))
    await detail(page, `Order ${RECORD}`).getByRole('status').filter({ hasText: `Loaded record ${RECORD} into both forms.` }).waitFor()
    // Each pane names the loaded customer after asking the runtime plane, so after the detail's status.
    const named = new RegExp(`combobox "${journey.order.customer.label}\\*?": ${journey.order.customer.choose}`)
    for (const name of ['React', 'Angular']) await untilSnapshot(pane(page, name), named, { within: WITHIN, what: `the ${name} pane's customer` })
  }
  const both = (page) => ({ React: pane(page, 'React'), Angular: pane(page, 'Angular') })
  return {
    'host-typeahead': async (page) => {
      // "As clara types, the page asks the runtime plane": the answer to her
      // search itself, waited for. A list on the screen is not that, nor is
      // a query counted from here: @formancy/react 0.5.0's typeahead
      // searches from no characters, so the page asks this lookup with an
      // empty search once the panes are drawn, and again later, and the box
      // keeps its last answer -- tenant 1's Muster AG -- on the screen until
      // the next arrives. A check that counted the queries routed after the
      // act began found her customer offered before her search was asked,
      // none counted, in 2 of 3 runs of --check once the pages drew their
      // own faces (0072), and again in 2 of 3 instrumented, whose pass had
      // counted an empty search asked while she typed; main's --check,
      // which refused the faces, passed 3 of 3 (Chromium 153.0.8010.12 on
      // Linux, 2026-10-16).
      // Settled to a yes or a no at once, so a premise refused below leaves
      // no wait to reject unheard when the page closes.
      const answered = page
        .waitForResponse((response) => {
          const request = response.request()
          return request.method() === 'POST' && /\/lookups\/[^/]+\/query$/.test(new URL(response.url()).pathname) && request.postDataJSON()?.search === SEARCH
        })
        .then(
          () => true,
          () => false,
        )
      // The caption's premise, asked of the database's owner, whom row-level security does not bind.
      const matching = await owner`select tenant_id, customer_no, name from sales.customer where name ilike ${`%${SEARCH}%`}`
      const number = (tenant, name) => matching.find((row) => row.tenant_id === tenant && row.name === name)?.customer_no
      const hers = number(1, journey.order.customer.choose)
      if (hers === undefined || number(OTHER_TENANT.tenant, OTHER_TENANT.name) !== hers) {
        throw new Error(`"${SEARCH}" matches ${JSON.stringify(matching)}, not tenant 1's ${journey.order.customer.choose} and tenant 2's ${OTHER_TENANT.name} under one customer number`)
      }
      await customer(page, 'React').pressSequentially(SEARCH)
      if (!(await answered)) throw new Error(`no lookup query for "${SEARCH}" was answered by the runtime plane within ${String(WITHIN)} ms`)
      // The list drawn from that answer: the box is busy until it is (a DOM
      // read, as scripts/pictures/session.mjs's quiet() says why).
      await customer(page, 'React').and(page.locator('[aria-busy="true"]')).waitFor({ state: 'detached' })
      const list = paper(page, 'React').getByRole('listbox')
      await list.getByRole('option', { name: journey.order.customer.choose, exact: true }).waitFor()
      // Her tenant's customer alone, though the other tenant's matches too.
      const offered = await list.getByRole('option').count()
      if (offered !== 1) throw new Error(`the list offers ${String(offered)} customers for "${SEARCH}", not ${journey.order.customer.choose} alone`)
      // Focus kept, because the list closes on blur.
      return { parts: { React: pane(page, 'React'), List: list }, keepFocus: true }
    },

    'host-loaded': async (page) => {
      await customer(page, 'React').press('Escape')
      await load(page)
      // Both panes, digit for digit, each said: "both" is the caption's claim.
      const wanted = { Id: ID, Amount: '99999999999999.9999', Customer: journey.order.customer.choose }
      const wrong = []
      for (const name of ['React', 'Angular']) {
        const held = { Id: await box(page, name, 'Id').inputValue(), Amount: await box(page, name, 'Amount').inputValue(), Customer: await customer(page, name).inputValue() }
        if (JSON.stringify(held) !== JSON.stringify(wanted)) wrong.push(`the ${name} pane holds ${JSON.stringify(held)}`)
      }
      if (wrong.length > 0) throw new Error(`${wrong.join('; ')}, not ${JSON.stringify(wanted)}`)
      // The grid's row, opened: the page set the grid's selection from the record it loaded.
      const open = records(page).getByRole('row', { selected: true })
      await open.waitFor()
      // The workspace whole: Forms, and main -- the form's heading, its operations and layout, the records and the record.
      return { parts: { Forms: page.getByRole('navigation', { name: HOST.forms, exact: true }), Workspace: page.getByRole('main') } }
    },

    'host-stale': async (page) => {
      await box(page, 'React', journey.order.update.label).fill(journey.order.update.value)
      await save(page, 'React')
      await pane(page, 'React').getByRole('status').filter({ hasText: HOST.saved }).waitFor()
      // Angular, still at the version it read.
      await box(page, 'Angular', 'Notes').fill(NOTES)
      await save(page, 'Angular')
      await pane(page, 'Angular').getByRole('region', { name: 'Angular Not saved', exact: true }).waitFor()
      const stored = await row()
      if (stored.status !== journey.order.update.value || stored.notes !== null) throw new Error(`the order is ${JSON.stringify(stored)}: the stale save overwrote the saved one`)
      return { parts: both(page) }
    },

    'host-refused': async (page) => {
      await carryOn(page, records(page).getByRole('button', { name: HOST.newRecord, exact: true }))
      await owner`insert into sales.customer (tenant_id, customer_no, name) values (1, ${DELETED.no}, ${DELETED.name})`
      await customer(page, 'React').pressSequentially('Brunner')
      // The renderer asks the runtime plane to name the value it now holds
      // (lookups/…/resolve), and names it from that answer once a later search
      // no longer offers it. Answered after the delete, the field shows the
      // bare token instead of the name (measured: with every lookup answer a
      // second late, 2026-10-10), so the customer is deleted only once the
      // page has heard its name, as it would be by somebody else a moment later.
      const named = page.waitForResponse((response) => response.request().method() === 'POST' && /\/lookups\/[^/]+\/resolve$/.test(new URL(response.url()).pathname))
      await paper(page, 'React').getByRole('option', { name: DELETED.name, exact: true }).click()
      if ((await named).status() !== 200) throw new Error('the page could not have the chosen customer named')
      for (const entry of journey.order.create) await box(page, 'React', entry.label).fill(entry.value)
      await owner`delete from sales.customer where tenant_id = 1 and customer_no = ${DELETED.no}`
      await save(page, 'React')
      await paper(page, 'React').getByRole('heading', { name: 'There is 1 problem to fix', exact: true }).waitFor()
      // The whole refusal, not the summary alone: the pane's line and the
      // field's own sentence. (Measured once: with only the heading waited for,
      // the camera refused the picture because the pane shrank by 24px while
      // it was taken -- about one status line; the search wait in session.mjs
      // is the likelier fix, and the cause was not established.)
      await untilSnapshot(pane(page, 'React'), /status: Not saved\.[\s\S]*paragraph: This is not one of the options this form offers\./, { within: WITHIN, what: 'the refusal on the Customer field' })
      const [{ n }] = await owner`select count(*)::int as n from sales."order" where customer_no = ${DELETED.no}`
      if (n !== 0) throw new Error(`${String(n)} orders were stored for the deleted customer`)
      return { parts: { React: pane(page, 'React') } }
    },

    'host-unknown': async (page) => {
      await load(page)
      // Notes, not Status: a status outside draft, placed and shipped is refused by ck_order_status, and nothing would be stored.
      await box(page, 'React', 'Notes').fill(NOTES)
      let sent = 0
      const answers = []
      const lost = '**/v1/forms/*/records/update'
      await page.route(lost, async (route) => {
        sent += 1
        const request = route.request()
        const path = new URL(request.url())
        const reply = await plane.server.inject({ method: request.method(), url: `${path.pathname}${path.search}`, headers: await request.allHeaders(), payload: request.postDataBuffer() })
        answers.push(reply.statusCode)
        await route.abort('connectionreset')
      })
      await save(page, 'React')
      await pane(page, 'React').getByRole('region', { name: 'React It may have been saved', exact: true }).waitFor()
      await page.unroute(lost)
      // Counted when the page says so: a resend by the browser would come before the page heard of the reset.
      if (sent !== 1 || answers[0] !== 200) throw new Error(`the update was sent ${String(sent)} times and answered ${answers.join(', ')}, not once with 200`)
      const stored = await row()
      if (stored.notes !== NOTES) throw new Error(`the order's notes are ${JSON.stringify(stored.notes)}: the server did not store the save whose answer was lost`)
      // React alone: Angular's pane, which saved nothing, is host-stale's picture again.
      return { parts: { React: pane(page, 'React') } }
    },

    'host-unsaved': async (page) => {
      // The React pane holds the save whose answer was lost: New record would drop it, so the page asks.
      await records(page).getByRole('button', { name: HOST.newRecord, exact: true }).click()
      const notice = page.getByRole('region', { name: 'Unsaved changes', exact: true })
      await notice.waitFor()
      if (!(await notice.evaluate((element) => element === document.activeElement))) throw new Error('the unsaved notice did not take the keyboard')
      return { parts: { Notice: notice }, keepFocus: true }
    },

    'host-other-tenant': async (page) => {
      await page.getByRole('region', { name: 'Unsaved changes', exact: true }).getByRole('button', { name: 'Keep editing', exact: true }).click()
      await carryOn(page, page.getByRole('button', { name: HOST.signOut, exact: true }))
      await signIn(page, TOKENS.otto)
      // otto's grid holds no order of tenant 1's: the fixture's is clara's.
      await records(page).getByRole('status').filter({ hasText: 'No records.' }).waitFor()
      await page.getByRole('button', { name: HOST.openByToken, exact: true }).click()
      await page.getByRole('textbox', { name: HOST.record, exact: true }).fill(RECORD)
      await page.getByRole('button', { name: HOST.load, exact: true }).click()
      await detail(page, 'No record open').getByRole('alert').waitFor()
      // What otto may do, beside the refusal: he may read records with this
      // form, so "No such record." is the token's answer, not a permission's.
      return { parts: { Records: records(page), Record: detail(page, 'No record open') } }
    },

    'host-delete': async (page) => {
      // The guide's second form, published as the getting-started job publishes it (journey.mjs, `deletion`).
      const formId = `${FORM.formId}${journey.deleting.formSuffix}`
      const ada = { authorization: `Bearer ${TOKENS.ada}` }
      const { connection, root: table, title, lookups, pinned, versionColumn } = FORM
      const proposal = await plane.server.inject({ method: 'POST', url: '/v1/form-proposals', headers: ada, payload: { connection, root: table, formId, title, lookups, pinned, versionColumn } })
      if (proposal.statusCode !== 200) throw new Error(`the proposal for ${formId} answered ${String(proposal.statusCode)}`)
      const { form, bindings, snapshot, generation } = proposal.json()
      const operations = { ...journey.policy.operations, delete: [...journey.policy.operations.read] }
      const policy = { version: 1, ...journey.policy, operations, fields: fieldsFromOperations(journey.policy, bindings), cascades: journey.deleting.cascades }
      const published = await plane.server.inject({ method: 'POST', url: `/v1/forms/${formId}/versions`, headers: ada, payload: { expectedBase: null, bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } } })
      if (published.statusCode !== 201) throw new Error(`publishing ${formId} answered ${String(published.statusCode)}: ${published.body}`)
      await carryOn(page, page.getByRole('button', { name: HOST.signOut, exact: true }))
      await signIn(page, TOKENS.clara, formId)
      // The order's own row: its Delete is a button named for it, which asks under the grid.
      const question = `Delete Order ${RECORD}?`
      await records(page).getByRole('button', { name: `Delete Order ${RECORD}`, exact: true }).click()
      const confirmation = records(page).getByRole('region', { name: question, exact: true })
      await confirmation.waitFor()
      if (!(await confirmation.evaluate((element) => element === document.activeElement))) throw new Error('the confirmation did not take the keyboard')
      // "Keep it" first, so the keyboard is never put on the button that deletes: the next Tab is on it.
      const answers = await confirmation.getByRole('button').allTextContents()
      if (JSON.stringify(answers.map((text) => text.trim())) !== JSON.stringify(['Keep it', 'Delete it'])) throw new Error(`the confirmation's answers are ${JSON.stringify(answers)}, not Keep it then Delete it`)
      return { parts: { Records: records(page) }, keepFocus: true }
    },

    'host-drift': async (page) => {
      // The delete's confirmation, kept: the order is the drift scene's.
      await records(page).getByRole('button', { name: 'Keep it', exact: true }).click()
      await carryOn(page, page.getByRole('button', { name: HOST.signOut, exact: true }))
      await signIn(page, TOKENS.clara)
      // Stacked, as clara arrived, whatever layout the address kept through Sign out.
      await page.getByRole('radio', { name: 'Stacked', exact: true }).check()
      await load(page)
      const width = async () => Number((await owner`select character_maximum_length as width from information_schema.columns where table_schema = 'sales' and table_name = 'order' and column_name = 'status'`)[0]?.width)
      const wide = await width()
      // After the form was opened and the record read: what somebody changing the table would do.
      await owner.unsafe(NARROWED)
      const narrow = await width()
      if (wide !== WIDTHS.before || narrow !== WIDTHS.after) throw new Error(`status was varchar(${String(wide)}) and is varchar(${String(narrow)}), not varchar(${String(WIDTHS.before)}) and varchar(${String(WIDTHS.after)}) as the caption says`)
      // The caption's premise, asked of drift review as ada: reads go on, create and update stop, and the runtime refuses the same.
      const review = await plane.server.inject({ method: 'POST', url: `/v1/forms/${FORM.formId}/drift`, headers: { authorization: `Bearer ${TOKENS.ada}` } })
      const report = review.json()
      const writesStop = (verdict) => verdict?.readable === true && verdict.writable?.create === false && verdict.writable?.update === false
      if (review.statusCode !== 200 || !writesStop(report) || !writesStop(report.runtime)) {
        throw new Error(`drift review answered ${String(review.statusCode)} with ${JSON.stringify({ readable: report.readable, writable: report.writable, runtime: report.runtime })}, not reads allowed and writes stopped`)
      }
      const before = await row()
      let sent = 0
      const update = '**/v1/forms/*/records/update'
      await page.route(update, async (route) => {
        sent += 1
        await route.fallback()
      })
      const answered = page.waitForResponse((response) => response.request().method() === 'POST' && /\/records\/update$/.test(new URL(response.url()).pathname))
      await box(page, 'React', 'Notes').fill(DRIFT_NOTES)
      await save(page, 'React')
      const answer = await answered
      const { code } = await answer.json()
      await pane(page, 'React').getByRole('region', { name: 'React Not saved', exact: true }).waitFor()
      await page.unroute(update)
      // Counted when the page says so; refused by the server, not by the page.
      if (sent !== 1 || answer.status() !== 409 || code !== 'drift') throw new Error(`the update was sent ${String(sent)} times and answered ${String(answer.status())} ${String(code)}, not once with 409 drift`)
      const after = await row()
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the order was ${JSON.stringify(before)} and is ${JSON.stringify(after)}: the refused save wrote it`)
      return { parts: { React: pane(page, 'React') } }
    },
  }
}

/** Signed in with `token`, pg-order -- or `formId` -- chosen under Forms and its records listed. The token is a password field, which has no role. */
async function signIn(page, token, formId = FORM.formId) {
  await page.getByLabel(HOST.token, { exact: true }).fill(token)
  await page.getByRole('button', { name: HOST.signIn, exact: true }).click()
  await page.getByRole('navigation', { name: HOST.forms, exact: true }).getByRole('link', { name: `${FORM.title} ${formId}`, exact: true }).click()
  await page.getByRole('region', { name: 'Records', exact: true }).getByRole('status').filter({ hasText: /^(Rows|No records)/ }).waitFor()
}

/**
 * clara's arrival: signed in, the records stacked above the record -- so the
 * two papers stand side by side under the grid -- both renderers on, and a
 * new order open for the typeahead's scene.
 */
async function arrive(page) {
  await signIn(page, TOKENS.clara)
  await page.getByRole('radio', { name: 'Stacked', exact: true }).check()
  await page.getByRole('region', { name: 'Records', exact: true }).getByRole('button', { name: HOST.newRecord, exact: true }).click()
  await page.getByRole('radio', { name: 'Both', exact: true }).check()
  for (const name of ['React', 'Angular']) {
    await page.getByRole('region', { name, exact: true }).getByRole('combobox', { name: field(journey.order.customer.label) }).waitFor()
  }
}

const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
let plane
try {
  const { chromium } = await import('playwright')
  plane = await startPlane()
  await pictures({
    app: 'host',
    chromium,
    playwright: require('playwright/package.json').version,
    // Past the workspace's widest breakpoint, 80rem, where Forms is a sidebar.
    width: 1440,
    css: { directory: join(app, 'src'), entry: 'host.css' },
    themes: manifest.dependencies['@formancy/themes'],
    origin: ORIGIN,
    dist: join(app, 'dist'),
    inject: (request) => plane.server.inject(request),
    within: WITHIN,
    secrets: plane.secrets,
    database: async () => `${(await plane.owner`select version() as v`)[0].v}, from ${POSTGRES_IMAGE}, as ${WRITER.user}`,
    open: async (page) => {
      await page.goto(`${ORIGIN}/`)
      await arrive(page)
    },
    acts: actsOver(plane),
  })
} catch (error) {
  console.error(`host pictures: ${said(error, [...Object.values(TOKENS), WRITER.postgresPassword, ...(plane?.secrets ?? [])])}`)
  process.exitCode = 1
} finally {
  await plane?.close()
}
