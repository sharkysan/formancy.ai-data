// A grid's filter in the browser (0104), on the workspace Download CSV's
// states left open: a condition typed in a column header's box and applied
// with Enter, the grid narrowed and its line saying so, the request
// carrying the condition in its body and its words in no URL, and the
// condition a chip; a value the server refuses said on the grid's line,
// with what was typed still in its box and no Ask again; Clear filter
// giving the keyboard to its Undo; the filter line -- its completion open
// over the grid, a line typed and applied with Enter, and a chip removed; a
// column header's box, reached from its header by the keyboard, Tab on to
// the next box and Esc giving an edit up; a lookup column's box offering
// the records its search finds over the page, and the one picked applied
// by its token and said by its label (0135); and = on a cell. Each state is
// measured by the gate's `measured` on the way: the colours and target
// sizes, the chips wrapping inside their row, the completion inside the
// page, and no sideways scroll, down to 320 px.

import { FORM, TOKENS } from './plane.mjs'
import { dataRows, focusedOn, until, WITHIN } from './measure.mjs'

const LISTS = `/v1/forms/${FORM}/records/list`
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
/** The grid's own line: the section's first status with no name. */
const gridLine = (region) => region.getByRole('status', { name: /^$/ }).first()
const lineOf = async (page) => (await gridLine(records(page)).textContent()) ?? ''
const control = (page, role, name) => records(page).getByRole(role, { name, exact: true })

/** Null when `got` is `want`, otherwise both. */
const same = (got, want) => (JSON.stringify(got) === JSON.stringify(want) ? null : `it is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)

/** The list request the page sends next, for the gate to read its body and URL. */
const nextList = (page) => page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === LISTS, WITHIN)

/** The states, in order. Each pass makes two orders noted with words of its own, which the filter finds. */
export function filterJourney(plane, { check }) {
  const words = `filtered${Date.now().toString(36)}`
  const contains = { field: 'notes', op: 'contains', text: words.toUpperCase() }
  return [
    [
      'A filter applied (Records)',
      async (page) => {
        await plane.order(0, words)
        await plane.order(0, words)
        // Every record, so the filter alone narrows them: no search, as Download CSV's states left it.
        await control(page, 'textbox', 'Search').fill('')
        await control(page, 'button', 'Search').click()
        await until(async () => /^Rows 1–/.test(await lineOf(page)), 'the records were never listed unsearched')
        // In another case than the orders' notes: contains finds them in any case.
        const box = control(page, 'textbox', 'Filter Notes')
        await box.fill(`contains ${words.toUpperCase()}`)
        const sent = nextList(page)
        await box.press('Enter')
        const request = await sent
        check('a filter applied: the condition is in the list request’s body', same(JSON.parse(request.postData() ?? '{}').filter, [contains]))
        check('a filter applied: its words are in no URL', request.url().toLowerCase().includes(words) ? `the URL is ${request.url()}` : null)
        await until(async () => (await lineOf(page)) === 'Rows 1–2. Filtered by Notes.', 'the grid never said it listed the two orders, filtered')
        check('a filter applied: the keyboard stays in its box', await focusedOn(page, box))
        const listed = await control(page, 'list', 'Filtered by').getByRole('listitem').allTextContents()
        check('a filter applied: it is a chip', same(listed, [`Notes contains “${words.toUpperCase()}”`]))
      },
    ],
    [
      'A filter refused (Records)',
      async (page) => {
        const filter = [contains, { field: 'id', op: 'equals', value: '12x' }]
        const reply = await plane.server.inject({
          method: 'POST',
          url: LISTS,
          headers: { authorization: `Bearer ${TOKENS.clerk}`, 'content-type': 'application/json' },
          payload: JSON.stringify({ filter }),
        })
        check('the server refuses 12x for an id as not-filterable', same([reply.statusCode, reply.json().code], [400, 'not-filterable']))
        const sentence = reply.json().message
        const box = control(page, 'textbox', 'Filter Id')
        await box.fill('12x')
        await box.press('Enter')
        await until(async () => (await lineOf(page)) === sentence, `the grid never said the server's sentence "${sentence}"`)
        check('a filter refused: what was typed is still in its box', same(await box.inputValue(), '12x'))
        check('a filter refused: nothing offers to ask again', (await control(page, 'button', 'Ask again').count()) === 0 ? null : 'Ask again is there')
      },
    ],
    [
      'A filter cleared (Records)',
      async (page) => {
        const clear = control(page, 'button', 'Clear filter')
        await clear.focus()
        await page.keyboard.press('Enter')
        await until(async () => /^Rows 1–\d+(; more follow)?\.$/.test(await lineOf(page)), 'the grid never listed the records unfiltered')
        check('a filter cleared: the keyboard is on its Undo', await focusedOn(page, control(page, 'button', 'Undo clearing the filter')))
      },
    ],
    [
      'A filter line completing (Records)',
      async (page) => {
        const line = control(page, 'combobox', 'Filter')
        await line.focus()
        await page.keyboard.type('not')
        const options = control(page, 'listbox', 'What may come next')
        await options.waitFor({ state: 'visible', ...WITHIN })
        check('a line completing: the field begun is offered by its name', same(await options.getByRole('option').allTextContents(), ['notesNotes']))
        check('a line completing: the line says it is expanded', same(await line.getAttribute('aria-expanded'), 'true'))
      },
    ],
    [
      'A filter line applied (Records)',
      async (page) => {
        const line = control(page, 'combobox', 'Filter')
        await page.keyboard.press('Escape')
        await line.fill(`notes contains ${words.toUpperCase()}`)
        const sent = nextList(page)
        await page.keyboard.press('Enter')
        const request = await sent
        check('a line applied: what it reads is in the list request’s body', same(JSON.parse(request.postData() ?? '{}').filter, [contains]))
        check('a line applied: its words are in no URL', request.url().toLowerCase().includes(words) ? `the URL is ${request.url()}` : null)
        await until(async () => (await lineOf(page)) === 'Rows 1–2. Filtered by Notes.', 'the grid never listed the two orders the line asked for')
        check('a line applied: the keyboard stays in the line', await focusedOn(page, line))
      },
    ],
    [
      'A filter line chip removed (Records)',
      async (page) => {
        await control(page, 'button', `Remove Notes contains “${words.toUpperCase()}”`).click()
        await until(async () => /^Rows 1–\d+(; more follow)?\.$/.test(await lineOf(page)), 'the grid never listed the records once the chip was removed')
        check(
          'a chip removed: the keyboard is on its Undo',
          await focusedOn(page, control(page, 'button', `Undo removing Notes contains “${words.toUpperCase()}”`)),
        )
        check('a chip removed: the line is empty', same(await control(page, 'combobox', 'Filter').inputValue(), ''))
      },
    ],
    [
      'A header box applied (Records)',
      async (page) => {
        // From the keyboard: a header, Down to its box's cell, Enter into the box.
        await records(page).getByRole('columnheader', { name: 'Amount' }).focus()
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        const box = control(page, 'textbox', 'Filter Amount')
        check('a header box: Down from its header and Enter put the keyboard in it', await focusedOn(page, box))
        await page.keyboard.type('> 0')
        const sent = nextList(page)
        await page.keyboard.press('Enter')
        const request = await sent
        check(
          'a header box applied: its condition is in the list request’s body',
          same(JSON.parse(request.postData() ?? '{}').filter, [{ field: 'amount', op: 'range', from: '0', to: null, exclusive: 'from' }]),
        )
        check('a header box applied: the line says it', same(await control(page, 'combobox', 'Filter').inputValue(), 'amount > 0'))
        // Tab goes on to the next column's box, as AG Grid's floating row walks.
        await page.keyboard.press('Tab')
        check('a header box: Tab reaches the next column’s box', await focusedOn(page, control(page, 'textbox', 'Filter Notes')))
        // Esc gives an edit up: the box shows its column's condition again, and the filter is as it was.
        await page.keyboard.type('given up')
        await page.keyboard.press('Escape')
        check('a header box: Esc gives up what was typed', same(await control(page, 'textbox', 'Filter Notes').inputValue(), ''))
        check('a header box: and the filter is as it was', same(await control(page, 'combobox', 'Filter').inputValue(), 'amount > 0'))
      },
    ],
    [
      'A lookup’s records offered (Records)',
      async (page) => {
        // From the keyboard: Customer's header, Down to its box, Enter into it, and part of a name (0135).
        await records(page).getByRole('columnheader', { name: 'Customer' }).focus()
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        const box = control(page, 'combobox', 'Filter Customer')
        check('a lookup’s box: Down from its header and Enter put the keyboard in it', await focusedOn(page, box))
        await page.keyboard.type('Muster')
        // Drawn over the page, under the box: measured open for sideways scroll
        // and the window's edges, down to 320 px. Axe runs once the gate has
        // left the box, which closes the list and reads "Muster" as the line
        // would -- no record is called that -- saying so on the grid's line.
        await page.getByRole('listbox', { name: 'Records of Customer' }).getByRole('option', { name: 'Muster AG' }).waitFor(WITHIN)
        check('a lookup’s box: the keyboard stays in it while it offers records', await focusedOn(page, box))
      },
    ],
    [
      'A lookup’s record applied (Records)',
      async (page) => {
        // Back into the box the gate's measure left, its search still found: Down offers it again.
        await control(page, 'combobox', 'Filter Customer').focus()
        const sent = nextList(page)
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        const request = await sent
        const filter = JSON.parse(request.postData() ?? '{}').filter
        const customer = filter.find((term) => term.field === 'customer')
        check(
          'a lookup’s record applied: its token is the condition in the list request’s body',
          customer?.op === 'equals' && /^k1:/.test(customer.value) ? null : `it sent ${JSON.stringify(filter)}`,
        )
        check('a lookup’s record applied: the box says it by its label', same(await control(page, 'combobox', 'Filter Customer').inputValue(), 'Muster AG'))
        check(
          'a lookup’s record applied: the line says it by its label',
          same(await control(page, 'combobox', 'Filter').inputValue(), 'amount > 0 and customer = "Muster AG"'),
        )
        // Measured once the list it asked for has answered: measured while it
        // was on its way, its rows were drawn between axe's audit and the
        // gate's reading of the cells axe left, which were then gone (CI run
        // 43355345952, Chromium at 320 px).
        await until(async () => /Filtered by [^.]*Customer\./.test(await lineOf(page)), 'the grid never said the list filtered by the customer')
      },
    ],
    [
      'A cell’s example applied (Records)',
      async (page) => {
        // From the keyboard: a data row's Amount cell, and = on it.
        const grid = records(page).getByRole('grid', { name: 'Records', exact: true })
        const amount = await grid.getByRole('columnheader', { name: /^Amount/ }).getAttribute('aria-colindex')
        const cell = dataRows(grid, page)
          .first()
          .locator(`[role="gridcell"][aria-colindex="${String(amount)}"]`)
        await cell.focus()
        const sent = nextList(page)
        await page.keyboard.press('=')
        const request = await sent
        const terms = JSON.parse(request.postData() ?? '{}').filter
        check(
          'a cell’s example: = keeps the rows with its value',
          terms.some((term) => term.field === 'amount' && term.op === 'equals') ? null : `the filter is ${JSON.stringify(terms)}`,
        )
        // The keyboard back on a data cell once the grid lists again, to point at the next value: a gridcell outside the header's row of boxes, read from the DOM, which says where a cell is.
        const back = await until(
          () => page.evaluate(() => document.activeElement?.getAttribute('role') === 'gridcell' && document.activeElement.closest('.ag-header') === null),
          'the keyboard never came back to a cell of the grid after =',
        )
          .then(() => null)
          .catch((error) => error.message)
        check('a cell’s example: the keyboard is back on a cell of the grid', back)
      },
    ],
    [
      'A header box cleared (Records)',
      async (page) => {
        // Cleared again, as the journeys after this one found the filter.
        await control(page, 'button', 'Clear filter').click()
        await until(async () => /^Rows 1–\d+(; more follow)?\.$/.test(await lineOf(page)), 'the grid never listed the records once the filter was cleared')
        check('a header box cleared: the box is empty', same(await control(page, 'textbox', 'Filter Amount').inputValue(), ''))
      },
    ],
  ]
}
