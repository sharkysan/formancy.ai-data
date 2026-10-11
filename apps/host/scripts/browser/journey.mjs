// The record's journey in Chromium, state by state, on the workspace the
// gate's workspace states left open: a new order in both renderers, the
// customer list, a record loaded by its token, a save, a stale save, a
// refused selection, a save whose answer was lost and its check, a create
// Chromium sends again on its own, and the confirmation of an unknown create
// (0029, 0031). Each state is measured on the way by the gate.

import { carryOn } from './workspace.mjs'
import { describeFocus, focusedOn, until, WITHIN } from './measure.mjs'
import { rulesReaching } from './styles.mjs'

/** The pieces of the page, by role and accessible name. */
const pane = (page, name) => page.getByRole('region', { name, exact: true })
const paper = (page, name) => pane(page, name).getByRole('form', { name: `Order, ${name}` })
const customer = (page, name) => paper(page, name).getByRole('combobox', { name: 'Customer' })
const saveIn = (page, name) => paper(page, name).getByRole('button', { name: 'Save' })
const status = (page, name, text) => pane(page, name).getByRole('status').filter({ hasText: text })
const unknownNotice = (page) => pane(page, 'React').getByRole('region', { name: 'React It may have been saved' })

/** A new order in the React pane, every field a person types, with `notes` as its notes. Not saved. */
async function newOrder(page, notes) {
  // A form holding an unknown save is work New would drop: the page asks, and the journey discards it.
  await carryOn(page, page.getByRole('region', { name: 'Records', exact: true }).getByRole('button', { name: 'New record' }))
  await customer(page, 'React').fill('Muster')
  await paper(page, 'React').getByRole('option', { name: 'Muster AG' }).click(WITHIN)
  await paper(page, 'React').getByLabel('Order date', { exact: true }).fill('2026-10-08')
  await paper(page, 'React').getByLabel('Amount', { exact: true }).fill('5')
  await paper(page, 'React').getByLabel('Notes', { exact: true }).fill(notes)
}

/**
 * The journey, state by state: each entry brings the page to a state and
 * names it, checking -- and measuring -- through the gate's recorder on the
 * way what only that moment can show. `run` holds what one width's pass
 * needs: its record, its customer number.
 */
export function recordJourney(plane, hop, { check, measure }, run) {
  return [
    ['Open', async (page) => {
      for (const name of ['React', 'Angular']) await customer(page, name).waitFor(WITHIN)
      // From the top of the open page: the skip link, then the first control of main.
      await page.mouse.click(1, 1)
      await page.keyboard.press('Tab')
      check('open: the first Tab reaches the skip link', await focusedOn(page, page.getByRole('link', { name: 'Skip to the workspace' })))
      // Enter must move the focus to main itself and change nothing else: the
      // address, which holds the workspace's state, and the history.
      const before = await page.evaluate(() => ({ hash: window.location.hash, length: window.history.length }))
      await page.keyboard.press('Enter')
      const onMain = await page.getByRole('main').evaluate((main) => main === document.activeElement)
      check('open: Enter on the skip link puts the keyboard on main', onMain ? null : `the focus is on ${await describeFocus(page)}`)
      const after = await page.evaluate(() => ({ hash: window.location.hash, length: window.history.length }))
      check('open: and leaves the address and the history as they were', JSON.stringify(after) === JSON.stringify(before) ? null : `${JSON.stringify(before)} became ${JSON.stringify(after)}`)
      await page.keyboard.press('Tab')
      const into = await page.getByRole('main').evaluate((main) => {
        const tabbable = [...main.querySelectorAll('*')].filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0)
        return tabbable[0] === document.activeElement
      })
      check('open: through it the next Tab reaches the first control of the page', into ? null : `the focus is on ${await describeFocus(page)}`)
    }],
    ['Customer list open (React)', async (page) => {
      await customer(page, 'React').fill('Muster')
      await paper(page, 'React').getByRole('listbox').waitFor(WITHIN)
    }],
    ['Loaded', async (page) => {
      await customer(page, 'React').press('Escape')
      const disclosure = page.getByRole('button', { name: 'Open by record token' })
      if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
      await page.getByRole('textbox', { name: 'Record token' }).fill(run.record)
      await page.getByRole('button', { name: 'Load', exact: true }).click()
      await page.getByRole('region', { name: `Order ${run.record}`, exact: true }).getByRole('status').filter({ hasText: 'Loaded record' }).waitFor(WITHIN)
      // Both panes show the customer by the label the resolve route gives it.
      for (const name of ['React', 'Angular']) await until(async () => (await customer(page, name).inputValue()) === 'Muster AG', `the ${name} customer never showed Muster AG`)
    }],
    ['Saved (React)', async (page) => {
      await paper(page, 'React').getByLabel('Amount', { exact: true }).fill('3')
      const save = saveIn(page, 'React')
      await save.focus()
      await page.keyboard.press('Enter')
      await status(page, 'React', 'Saved.').waitFor(WITHIN)
      check('after a save that worked, the keyboard is still on Save', await focusedOn(page, save))
    }],
    ['Stale notice (Angular)', async (page) => {
      await paper(page, 'Angular').getByLabel('Amount', { exact: true }).fill('4')
      const save = saveIn(page, 'Angular')
      await save.focus()
      await page.keyboard.press('Enter')
      const notice = pane(page, 'Angular').getByRole('region', { name: 'Angular Not saved' })
      await notice.waitFor(WITHIN)
      check('after a stale save, the keyboard is on the notice', await focusedOn(page, notice))
    }],
    ['Refused selection (React)', async (page) => {
      await plane.insertCustomer(run.customer, `Frisch Kunde ${String(run.customer)}`)
      await customer(page, 'React').fill('Frisch')
      await paper(page, 'React').getByRole('option', { name: `Frisch Kunde ${String(run.customer)}` }).click(WITHIN)
      await plane.deleteCustomer(run.customer)
      const save = saveIn(page, 'React')
      await save.focus()
      await page.keyboard.press('Enter')
      const summary = paper(page, 'React').getByRole('heading', { name: 'There is 1 problem to fix' })
      await summary.waitFor(WITHIN)
      // The summary has no role of its own: it is the focused element that holds its heading.
      const inSummary = await summary.evaluate((heading) => document.activeElement !== document.body && document.activeElement?.contains(heading) === true)
      check('after a refused selection, the keyboard is in the error summary', inSummary ? null : `the focus is on ${await describeFocus(page)}`)
      for (const name of ['React', 'Angular']) {
        const found = await rulesReaching(paper(page, name))
        check(`the ${name} paper: no rule of host.css selects anything on it`, found.reached.length === 0 ? null : found.reached.slice(0, 6).join('; '))
        // A guard on the guard: real rules, matched against a whole form.
        const missing = ['label', 'input', 'button'].filter((tag) => !found.tags.includes(tag))
        check(`which matched host.css against the whole ${name} form`, found.rules > 0 && missing.length === 0 ? null : `${String(found.rules)} rules, and no ${missing.join(', ')} on the paper`)
      }
    }],
    ['Unknown notice (React)', async (page) => {
      await customer(page, 'React').fill('Muster')
      await paper(page, 'React').getByRole('option', { name: 'Muster AG' }).click(WITHIN)
      // The update reaches the real server, which stores it and answers; the
      // page is then told the connection was reset, as when a network drops
      // after sending. Chromium's own answer to a lost response, not jsdom's.
      let lost = 0
      await page.route('**/v1/forms/*/records/update', async (route) => {
        lost += 1
        await route.fetch()
        await route.abort('connectionreset')
      })
      try {
        const save = saveIn(page, 'React')
        await save.focus()
        await page.keyboard.press('Enter')
        const notice = pane(page, 'React').getByRole('region', { name: 'React It may have been saved' })
        await notice.waitFor(WITHIN)
        check('after a save whose answer was lost, the keyboard is on the notice', await focusedOn(page, notice))
        check('and the save was sent once', lost === 1 ? null : `it was sent ${String(lost)} times`)
      } finally {
        await page.unroute('**/v1/forms/*/records/update')
      }
    }],
    ['Unknown notice, checked (React)', async (page) => {
      // The check's answer and "Load the saved record", drawn in Chromium:
      // their contrast and target size are measured nowhere else.
      await unknownNotice(page).getByRole('button', { name: 'Check whether it was saved' }).click()
      await unknownNotice(page).getByRole('button', { name: 'Load the saved record' }).waitFor(WITHIN)
    }],
    ['Create resent by Chromium (React)', async (page) => {
      // The page reaches the server through the hop. The hop drops the answer
      // carrying this order's notes, the server having stored it, and once
      // the order is in the database closes the connection that carried it:
      // what an idle reset by a balancer, or a dropped link, does. Chromium
      // then sends the create again on a new connection, on its own.
      const notes = `resent by Chromium ${String(run.customer)} ${String(Date.now())}`
      await newOrder(page, notes)
      const marker = Buffer.from(notes, 'utf8')
      const sent = hop.countSent(marker)
      const lost = hop.swallowAnswersFrom(marker)
      // The answer the page does get: the second sending's, which the server
      // answers from what it kept for the first (0031).
      const answered = page.waitForResponse((response) => response.url().endsWith('/records/create') && response.status() === 201, WITHIN)
      await saveIn(page, 'React').click()
      await Promise.race([lost.matched, new Promise((_, reject) => setTimeout(() => reject(new Error('the create never answered through the hop')), WITHIN.timeout))])
      await until(async () => (await plane.ordersWithNotes(notes)) === 1, 'the create never reached the database')
      const cutAt = performance.now()
      lost.cut()
      // Polled every 5 ms rather than through until(), whose 100 ms step
      // would be the measurement: how soon a resend follows the close is
      // what the server's kept answers have to outlast.
      while (sent() < 2 && performance.now() - cutAt < WITHIN.timeout) await new Promise((resolve) => setTimeout(resolve, 5))
      const resentAfter = performance.now() - cutAt
      await status(page, 'React', 'Created record').waitFor(WITHIN)
      const answerBytes = (await (await answered).body()).length
      measure({ name: 'Chromium resent the create after its connection closed', value: resentAfter, unit: 'ms' })
      measure({ name: "the create's answer", value: answerBytes, unit: 'bytes' })
      check('Chromium sent the create again on its own: the marker crossed the hop twice', sent() === 2 ? null : `it crossed ${String(sent())} time(s): Chromium did not resend, so this measured nothing`)
      check('and one order is stored: the second sending was answered, not applied', (await plane.ordersWithNotes(notes)) === 1 ? null : `${String(await plane.ordersWithNotes(notes))} orders are stored`)
    }],
    ['Unknown create, confirming (React)', async (page) => {
      // A create lost on the way, which nothing can find -- the database
      // numbers orders -- checked, and "Enter it again anyway" pressed: the
      // confirmation, drawn in Chromium, with the keyboard on its answer.
      await newOrder(page, `lost and confirming ${String(run.customer)} ${String(Date.now())}`)
      await page.route('**/v1/forms/*/records/create', async (route) => {
        await route.fetch()
        await route.abort('connectionreset')
      })
      try {
        await saveIn(page, 'React').click()
        await unknownNotice(page).waitFor(WITHIN)
      } finally {
        await page.unroute('**/v1/forms/*/records/create')
      }
      await unknownNotice(page).getByRole('button', { name: 'Check whether it was saved' }).click()
      const again = unknownNotice(page).getByRole('button', { name: 'Enter it again anyway' })
      await again.waitFor(WITHIN)
      await again.focus()
      await page.keyboard.press('Enter')
      const allow = unknownNotice(page).getByRole('button', { name: 'Allow saving it again' })
      await allow.waitFor(WITHIN)
      check('after "Enter it again anyway", the keyboard is on "Allow saving it again"', await focusedOn(page, allow))
    }],
  ]
}

