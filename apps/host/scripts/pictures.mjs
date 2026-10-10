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
// once, and then answers with a connection reset.
//
// Walk order: typeahead, the hero, stale, refused, unknown, another tenant;
// the README shows them in scenes.json's order. Elements are found by role and
// accessible name, with two exceptions, each said where it is: the host token
// is a password field, which has no role, so it is found by its label; and
// the line saying what the signed-in person may do is a paragraph, which has
// no name, so it is found by its role and filtered by its text, and the card
// it sits in, which has no role, as its parent.
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

/** The plane over a fresh fixture, with pg-order published as the guide publishes it. */
async function startPlane() {
  let fixture
  try {
    fixture = await startPostgresFixture()
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
  const record = (page) => page.getByRole('region', { name: 'Record', exact: true })
  const save = (page, name) => paper(page, name).getByRole('button', { name: HOST.save, exact: true }).click()
  const row = async () => (await owner`select status, notes from sales."order" where id = ${ID}`)[0]
  const load = async (page) => {
    await record(page).getByRole('textbox', { name: HOST.record, exact: true }).fill(RECORD)
    await record(page).getByRole('button', { name: HOST.load, exact: true }).click()
    await record(page).getByRole('status').filter({ hasText: `Loaded record ${RECORD} into both forms.` }).waitFor()
    // Each pane names the loaded customer after asking the runtime plane, so after the bar's status.
    const named = new RegExp(`combobox "${journey.order.customer.label}\\*?": ${journey.order.customer.choose}`)
    for (const name of ['React', 'Angular']) await untilSnapshot(pane(page, name), named, { within: WITHIN, what: `the ${name} pane's customer` })
  }
  const both = (page) => ({ React: pane(page, 'React'), Angular: pane(page, 'Angular') })
  // The card saying what the signed-in person may do, with Sign out beside
  // it. A paragraph has no name, so the line is found by its role and
  // filtered by its text; the card has no role at all, so it is the line's
  // parent. The card, not the line: as the last part of a picture, the line
  // left the card's own padding and border at the picture's edge.
  const allowed = (page) => ({ Allowed: page.getByRole('paragraph').filter({ hasText: /records with this form\.$/ }).locator('..') })
  let lookups = 0
  return {
    'host-typeahead': async (page) => {
      await page.route('**/v1/forms/*/lookups/*/query', async (route) => {
        lookups += 1
        await route.fallback()
      })
      // The caption's premise, asked of the database's owner, whom row-level security does not bind.
      const matching = await owner`select tenant_id, customer_no, name from sales.customer where name ilike ${`%${SEARCH}%`}`
      const number = (tenant, name) => matching.find((row) => row.tenant_id === tenant && row.name === name)?.customer_no
      const hers = number(1, journey.order.customer.choose)
      if (hers === undefined || number(OTHER_TENANT.tenant, OTHER_TENANT.name) !== hers) {
        throw new Error(`"${SEARCH}" matches ${JSON.stringify(matching)}, not tenant 1's ${journey.order.customer.choose} and tenant 2's ${OTHER_TENANT.name} under one customer number`)
      }
      await customer(page, 'React').pressSequentially(SEARCH)
      const list = paper(page, 'React').getByRole('listbox')
      await list.getByRole('option', { name: journey.order.customer.choose, exact: true }).waitFor()
      // "As clara types, the page asks the runtime plane": counted, never printed.
      if (lookups === 0) throw new Error('the list was offered without a lookup query reaching the runtime plane')
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
      return { parts: { Record: record(page), ...allowed(page), ...both(page) } }
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
      await record(page).getByRole('button', { name: HOST.newRecord, exact: true }).click()
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

    'host-other-tenant': async (page) => {
      await page.getByRole('button', { name: HOST.signOut, exact: true }).click()
      await signIn(page, TOKENS.otto)
      await record(page).getByRole('textbox', { name: HOST.record, exact: true }).fill(RECORD)
      await record(page).getByRole('button', { name: HOST.load, exact: true }).click()
      await record(page).getByRole('alert').waitFor()
      // What otto may do, beside the refusal: he may read records with this
      // form, so "No such record." is the token's answer, not a permission's.
      return { parts: { Record: record(page), ...allowed(page) } }
    },
  }
}

/** Signed in with `token` and pg-order open in both panes. The token is a password field, which has no role. */
async function signIn(page, token) {
  await page.getByLabel(HOST.token, { exact: true }).fill(token)
  await page.getByLabel(HOST.formId, { exact: true }).fill(FORM.formId)
  await page.getByRole('button', { name: HOST.open, exact: true }).click()
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
    width: 1200,
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
      await signIn(page, TOKENS.clara)
    },
    acts: actsOver(plane),
  })
} catch (error) {
  console.error(`host pictures: ${said(error, [...Object.values(TOKENS), WRITER.postgresPassword, ...(plane?.secrets ?? [])])}`)
  process.exitCode = 1
} finally {
  await plane?.close()
}
