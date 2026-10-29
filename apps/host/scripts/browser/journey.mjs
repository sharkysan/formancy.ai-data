// The record's journey in the browser, state by state, on the workspace the
// gate's workspace states left open: a new order in both renderers, the
// customer list, a record loaded by its token, a save, a stale save, a
// refused selection, a save whose answer was lost and its check, a create
// the network lost after the server stored it -- which the browser sends
// again on its own, or not, as 0058's table says of it and the connection
// it took -- the confirmation of an unknown create (0029, 0031), and the
// record loaded again and copied into a new one (0107). Each state is
// measured on the way by the gate.

import { fromTheTop, lostCreate } from '../../../../scripts/browser-gate.mjs'
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

/**
 * Save pressed from the keyboard, as every save of the journey is: focused,
 * then Enter. A pointer press in WebKit sent nothing in five of about 175
 * presses on 2026-10-13 (two of 120 in a probe of this sequence, three in
 * five gate runs): the button took the press and the focus, the document
 * scrolled by 24 px before the release, which landed on the form beside
 * it, and settled back about 130 ms later. What moved it was not
 * established (0058); a keyboard press has no release to miss.
 */
async function pressSave(page, name) {
  await saveIn(page, name).focus()
  await page.keyboard.press('Enter')
}

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
 * needs -- its record, its customer number -- and `reached`, the run's set
 * of connections its lost creates took, which the gate holds once the run
 * is over (scripts/browser-gate.mjs's rowUnmeasured).
 */
export function recordJourney(plane, hop, { check, measure, asked }, run) {
  return [
    ['Open', async (page) => {
      for (const name of ['React', 'Angular']) await customer(page, name).waitFor(WITHIN)
      // From the top of the open page, as the harness puts it there: the skip link, then the first control of main.
      await fromTheTop(page)
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
      // after sending. The browser's own answer to a lost response, not
      // jsdom's.
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
      // The check's answer and "Load the saved record", drawn in the browser:
      // their contrast and target size are measured nowhere else.
      await unknownNotice(page).getByRole('button', { name: 'Check whether it was saved' }).click()
      await unknownNotice(page).getByRole('button', { name: 'Load the saved record' }).waitFor(WITHIN)
    }],
    ['A create the network lost after the server stored it (React)', async (page) => {
      // The page reaches the server through the hop. The hop drops the answer
      // carrying this order's notes, the server having stored it, and once
      // the order is in the database closes the connection that carried it:
      // what an idle reset by a balancer, or a dropped link, does. Whether
      // the browser then sends the create again on its own, below the page,
      // is its own and depends on the connection it took (0058): the hop
      // says which, how many requests that connection carried first, and
      // how many kept-alive connections stood idle beside it, passed over.
      const notes = `lost after it was stored ${String(run.customer)} ${String(Date.now())}`
      let resentAfter = null
      await newOrder(page, notes)
      const marker = Buffer.from(notes, 'utf8')
      const sent = hop.sentOn(marker)
      const lost = hop.swallowAnswersFrom(marker)
      // Collected, not awaited: in a browser that sends nothing again no 201 arrives.
      const created = []
      const collect = (response) => {
        if (response.url().endsWith('/records/create') && response.status() === 201) created.push(response)
      }
      page.on('response', collect)
      const said = status(page, 'React', 'Created record').or(unknownNotice(page))
      try {
        await pressSave(page, 'React')
        await Promise.race([lost.matched, new Promise((_, reject) => setTimeout(() => reject(new Error('the create never answered through the hop')), WITHIN.timeout))])
        await until(async () => (await plane.ordersWithNotes(notes)) === 1, 'the create never reached the database')
        const cutAt = performance.now()
        lost.cut()
        // Polled every 5 ms rather than through until(), whose 100 ms step
        // would be the measurement: how soon a resend follows the close is
        // what the server's kept answers have to outlast. The count is final
        // once the page says either sentence: a browser sends again below
        // fetch, before it rejects.
        while (performance.now() - cutAt < WITHIN.timeout) {
          if (sent().length >= 2) {
            resentAfter = performance.now() - cutAt
            break
          }
          if (await said.first().isVisible()) break
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        await said.first().waitFor(WITHIN)
      } finally {
        page.off('response', collect)
      }
      const sendings = sent()
      const held = lostCreate(asked, sendings)
      if (held.connection !== null) {
        run.reached.add(held.connection)
        measure({ name: 'requests the lost create’s connection carried before it', value: sendings[0].earlier, unit: 'requests' })
        measure({ name: 'kept-alive connections that stood idle while the lost create took another', value: sendings[0].passedOver, unit: 'connections' })
      }
      check('the lost create went out on the connection 0058’s table says of this browser', held.took)
      check('the browser sent the lost create as often as 0058’s table says for that connection', held.often)
      check('and one order is stored: a second sending was answered, not applied', (await plane.ordersWithNotes(notes)) === 1 ? null : `${String(await plane.ordersWithNotes(notes))} orders are stored`)
      // Where it was sent again: how soon after the close, and the answer the page got, the second sending's.
      if (resentAfter !== null) measure({ name: 'the browser resent the create after its connection closed', value: resentAfter, unit: 'ms' })
      if (created.length > 0) measure({ name: "the create's answer", value: (await created[0].body()).length, unit: 'bytes' })
      const resent = sendings.length >= 2
      const truth = resent ? await status(page, 'React', 'Created record').isVisible() : (await unknownNotice(page).isVisible()) && (await focusedOn(page, unknownNotice(page))) === null
      check(
        'and the page says what is true, with the keyboard where 0031 puts it',
        truth ? null : resent ? 'the browser sent it again and the page does not say "Created record"' : `nothing was sent again and the page does not show "It may have been saved" with the keyboard on it: ${String(await focusedOn(page, unknownNotice(page)))}`,
      )
    }],
    ['Unknown create, confirming (React)', async (page) => {
      // A create lost on the way, which nothing can find -- the database
      // numbers orders -- checked, and "Enter it again anyway" pressed: the
      // confirmation, drawn in the browser, with the keyboard on its answer.
      await newOrder(page, `lost and confirming ${String(run.customer)} ${String(Date.now())}`)
      await page.route('**/v1/forms/*/records/create', async (route) => {
        await route.fetch()
        await route.abort('connectionreset')
      })
      try {
        await pressSave(page, 'React')
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
    ['Copied', async (page) => {
      // Duplicate record (0107): the record loaded again -- over the
      // unknown create the state before left, which the page asks about and
      // the journey discards -- and copied into a new record in both
      // renderers, with the keyboard on the new record's heading.
      const disclosure = page.getByRole('button', { name: 'Open by record token' })
      if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
      await page.getByRole('textbox', { name: 'Record token' }).fill(run.record)
      await carryOn(page, page.getByRole('button', { name: 'Load', exact: true }))
      await page.getByRole('region', { name: `Order ${run.record}`, exact: true }).getByRole('status').filter({ hasText: 'Loaded record' }).waitFor(WITHIN)
      await page.getByRole('button', { name: 'Duplicate record' }).click()
      await page.getByRole('region', { name: 'New record', exact: true }).getByRole('status').filter({ hasText: `Copied ${run.record}` }).waitFor(WITHIN)
      for (const name of ['React', 'Angular']) await until(async () => (await customer(page, name).inputValue()) === 'Muster AG', `the ${name} copy never showed Muster AG`)
      check("after Duplicate record, the keyboard is on the new record's heading", await focusedOn(page, page.getByRole('heading', { level: 3, name: 'New record', exact: true })))
    }],
  ]
}

