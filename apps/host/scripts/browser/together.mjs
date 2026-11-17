// An order's lines saved with it (0155), in the browser: the lines' tab
// beside a saved order, measured at every width as every state is; the
// keyboard's path through it -- Add, typing, Done, Go to Save and Save --
// with the keyboard where each leaves it; no rule of host.css on a line's
// paper; and a new order saved with its line whose answer the TCP hop
// drops after the server stored it, which the browser sends again on its
// own, or not, as 0058's table says of a lost POST on the connection it
// took: one order is stored either way, and the page says what is true --
// the order created, or that it may have been saved, the keyboard on that.
//
// Found by role and accessible name. What the accessibility tree cannot
// answer is read off the DOM: which grid row holds the keyboard after Done
// -- the focused element's nearest role=row, and the cells of the rows
// that share its aria-rowindex, since AG Grid draws one row in each of its
// pinned containers, and the tree gives no row a state that says the
// keyboard is in it.

import { lostCreate } from '../../../../scripts/browser-gate.mjs'
import { FORM, SAVED_ORDER } from './plane.mjs'
import { carryOn } from './workspace.mjs'
import { describeFocus, focusedOn, until, WITHIN } from './measure.mjs'
import { rulesReaching } from './styles.mjs'

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const lines = (page) => page.getByRole('region', { name: 'Order line', exact: true })
const pane = (page, name) => page.getByRole('region', { name, exact: true })
const recordPaper = (page, name) => pane(page, name).getByRole('form', { name: `Order, ${name}` })
const railPaper = (page, row, name) => lines(page).getByRole('form', { name: `${row}, ${name}` })
const unknownNotice = (page) => pane(page, 'React').getByRole('region', { name: 'React It may have been saved' })
/** What the lines' tab's line says: its first status with no name of its own. */
const lineOf = async (page) => ((await lines(page).getByRole('status').first().textContent()) ?? '').trim()
const formLink = (page, title, id) => page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `${title} ${id}`, exact: true })

/** The saved order form chosen under Forms, after discarding whatever the page holds. */
async function chooseSavedOrders(page) {
  await carryOn(page, formLink(page, 'Order', SAVED_ORDER))
  await records(page).getByRole('grid', { name: 'Records', exact: true }).waitFor(WITHIN)
}

/** A new line added from the keyboard, its number and quantity typed in its React paper: the rail's first field takes the keyboard. */
async function addLine(page, check, no, quantity, state) {
  const add = lines(page).getByRole('button', { name: 'Add Order line', exact: true })
  await add.focus()
  await page.keyboard.press('Enter')
  const first = railPaper(page, 'New Order line 1', 'React').getByLabel(/^Line no\b/)
  await first.waitFor(WITHIN)
  await until(async () => (await focusedOn(page, first)) === null, 'never').catch(() => null)
  check(`${state}: Add puts the keyboard in the new line's first field`, await focusedOn(page, first))
  await page.keyboard.type(no)
  await railPaper(page, 'New Order line 1', 'React')
    .getByLabel(/^Quantity\b/)
    .fill(quantity)
}

/**
 * Whether the keyboard is in the new line's own row of the lines' tab: its
 * number `no` and its New mark among the cells of the row the keyboard is
 * in. Read off the DOM: see the header.
 */
async function onNewLine(page, no) {
  return lines(page).evaluate((region, number) => {
    const row = document.activeElement?.closest('[role="row"]')
    const index = row?.getAttribute('aria-rowindex')
    if (row === null || row === undefined || index === null || index === undefined || !region.contains(row)) return false
    const cells = [...region.querySelectorAll(`[role="row"][aria-rowindex="${index}"] [role="gridcell"]`)].map((cell) => (cell.textContent ?? '').trim())
    return cells.includes(number) && cells.includes('New')
  }, no)
}

/** Done from the keyboard, and Go to Save from it: the keyboard back on the new line's row, numbered `no`, then on the order's Save. */
async function doneAndGo(page, check, no, state) {
  const done = railPaper(page, 'New Order line 1', 'React').getByRole('button', { name: 'Done', exact: true })
  await done.focus()
  await page.keyboard.press('Enter')
  await railPaper(page, 'New Order line 1', 'React').waitFor({ state: 'detached', ...WITHIN })
  await until(async () => onNewLine(page, no), 'never').catch(() => null)
  const onRow = await onNewLine(page, no)
  check(`${state}: Done gives the keyboard back to the line's row`, onRow ? null : `the focus is on ${await describeFocus(page)}`)
  const go = lines(page).getByRole('button', { name: 'Go to Save', exact: true })
  await go.focus()
  await page.keyboard.press('Enter')
  const save = recordPaper(page, 'React').getByRole('button', { name: 'Save', exact: true })
  await until(async () => (await focusedOn(page, save)) === null, 'never').catch(() => null)
  check(`${state}: Go to Save puts the keyboard on the order's Save`, await focusedOn(page, save))
}

/**
 * The journey, state by state, each measured by the gate on the way: `run`
 * holds the pass's customer number, which marks its orders, and `reached`,
 * the connections the run's lost POSTs took (scripts/browser-gate.mjs).
 */
export function togetherJourney(plane, hop, { check, measure, asked }, run) {
  const at = { record: '', note: '' }
  return [
    [
      'The lines’ tab of a saved order',
      async (page) => {
        at.note = `together ${String(run.customer)} ${String(Date.now())}`
        at.record = await plane.savedOrder(at.note, 2)
        await chooseSavedOrders(page)
        const search = records(page).getByRole('textbox', { name: 'Search' })
        await search.fill(at.note)
        await records(page).getByRole('button', { name: 'Search', exact: true }).click()
        // The one order its note finds, once the search has answered: an earlier pass's order may show its number in another column.
        await until(
          async () => ((await records(page).getByRole('status', { name: /^$/ }).first().textContent()) ?? '') === 'Rows 1–1.',
          'the search never listed the order alone',
        )
        const cell = records(page)
          .getByRole('grid', { name: 'Records', exact: true })
          .getByRole('gridcell', { name: at.record.slice(3), exact: true })
          .first()
        await cell.focus()
        await page.keyboard.press('Enter')
        await page.getByRole('heading', { level: 3, name: `Order ${at.record}`, exact: true }).waitFor(WITHIN)
        await page.getByRole('tab', { name: 'Order line', exact: true }).click()
        await until(
          async () => (await lineOf(page)) === '2 Order line rows; each Order holds 1 to 3. You may not remove saved rows here.',
          'the lines of the saved order were never listed',
        )
      },
    ],
    [
      'A line added on the rail',
      async (page) => {
        await addLine(page, check, '3', '4', 'a line added')
        for (const name of ['React', 'Angular']) {
          const paper = railPaper(page, 'New Order line 1', name)
          await paper.getByLabel(/^Line no\b/).waitFor(WITHIN)
          const found = await rulesReaching(paper)
          check(`a line's ${name} paper: no rule of host.css selects anything on it`, found.reached.length === 0 ? null : found.reached.slice(0, 6).join('; '))
          const missing = ['label', 'input', 'button'].filter((tag) => !found.tags.includes(tag))
          check(
            `which matched host.css against the whole ${name} paper`,
            found.rules > 0 && missing.length === 0 ? null : `${String(found.rules)} rules, and no ${missing.join(', ')}`,
          )
        }
      },
    ],
    [
      'Saved with its line (React)',
      async (page) => {
        await doneAndGo(page, check, '3', 'a line added')
        await page.keyboard.press('Enter')
        await pane(page, 'React').getByRole('status').filter({ hasText: 'Saved the Order: 1 Order line row added.' }).waitFor(WITHIN)
        const held = await plane.savedWithNote(at.note)
        check('saved with its line: the order holds three lines', held.lines === 3 ? null : `it holds ${String(held.lines)}`)
      },
    ],
    [
      'A new order and its line, the answer lost after it was stored (React)',
      async (page) => {
        // The save reaches the server through the hop, which drops its answer
        // once the server has stored it and closes the connection that carried
        // it, as for the record's lost create (journey.mjs).
        const note = `together lost ${String(run.customer)} ${String(Date.now())}`
        await chooseSavedOrders(page)
        await carryOn(page, records(page).getByRole('button', { name: 'New record', exact: true }))
        await recordPaper(page, 'React')
          .getByLabel(/^Note\b/)
          .fill(note)
        await page.getByRole('tab', { name: 'Order line', exact: true }).click()
        await addLine(page, check, '1', '2', 'a lost save')
        await doneAndGo(page, check, '1', 'a lost save')
        const marker = Buffer.from(note, 'utf8')
        const sent = hop.sentOn(marker)
        const lost = hop.swallowAnswersFrom(marker)
        const said = pane(page, 'React').getByRole('status').filter({ hasText: 'Created record' }).or(unknownNotice(page))
        await page.keyboard.press('Enter')
        await Promise.race([
          lost.matched,
          new Promise((_, reject) => setTimeout(() => reject(new Error('the save never answered through the hop')), WITHIN.timeout)),
        ])
        await until(async () => (await plane.savedWithNote(note)).orders === 1, 'the save never reached the database')
        const cutAt = performance.now()
        lost.cut()
        while (performance.now() - cutAt < WITHIN.timeout) {
          if (sent().length >= 2) break
          if (await said.first().isVisible()) break
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        await said.first().waitFor(WITHIN)
        const sendings = sent()
        const held = lostCreate(asked, sendings)
        if (held.connection !== null) {
          run.reached.add(held.connection)
          measure({ name: 'requests the lost save’s connection carried before it', value: sendings[0].earlier, unit: 'requests' })
        }
        check('the lost save went out on the connection 0058’s table says of this browser', held.took)
        check('the browser sent the lost save as often as 0058’s table says for that connection', held.often)
        const stored = await plane.savedWithNote(note)
        check(
          'and one order is stored, with its one line: a second sending was answered, not applied',
          stored.orders === 1 && stored.lines === 1 ? null : `${String(stored.orders)} orders and ${String(stored.lines)} lines are stored`,
        )
        const resent = sendings.length >= 2
        const truth = resent
          ? await pane(page, 'React')
              .getByRole('status')
              .filter({ hasText: /^Created record k1:\d+ with 1 Order line row\.$/ })
              .isVisible()
          : (await unknownNotice(page).isVisible()) && (await focusedOn(page, unknownNotice(page))) === null
        check(
          'and the page says what is true, with the keyboard where 0031 puts it',
          truth
            ? null
            : resent
              ? 'the browser sent it again and the page does not say the order was created with its line'
              : `nothing was sent again and the page does not show "It may have been saved" with the keyboard on it: ${String(await focusedOn(page, unknownNotice(page)))}`,
        )
      },
    ],
    [
      'Back to the orders',
      async (page) => {
        // The orders the journeys after this one use, the unknown save discarded.
        await carryOn(page, formLink(page, 'Order', FORM))
        await records(page).getByRole('grid', { name: 'Records', exact: true }).waitFor(WITHIN)
      },
    ],
  ]
}
