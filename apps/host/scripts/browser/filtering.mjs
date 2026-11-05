// A grid's filter in the browser (0104), on the workspace Download CSV's
// states left open: Build a condition opened from the keyboard and the next
// Tab on Field; a condition chosen and applied with Enter in its box, the
// grid narrowed and its line saying so, the request carrying the condition
// in its body and its words in no URL, and the condition a chip; a value
// the server refuses said on the grid's line, with what was typed still in
// its box and no Ask again; Clear filter giving the keyboard to its Undo;
// the filter line -- its completion open over the grid, a line typed and
// applied with Enter, and a chip removed; and a column header's box,
// reached from its header by the keyboard and applied with Enter. Each state is measured by
// the gate's `measured` on the way: the colours and target sizes, the
// chips wrapping inside their row, the completion inside the page, and no
// sideways scroll, down to 320 px.
//
// A select is chosen with Playwright's selectOption, not its keys: how a
// closed select answers an arrow differs by browser and platform, and is
// the browser's own control, not the page's.

import { FORM, TOKENS } from './plane.mjs'
import { focusedOn, until, WITHIN } from './measure.mjs'

const LISTS = `/v1/forms/${FORM}/records/list`
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
/** The grid's own line: the section's first status with no name. */
const gridLine = (region) => region.getByRole('status', { name: /^$/ }).first()
const lineOf = async (page) => (await gridLine(records(page)).textContent()) ?? ''
const control = (page, role, name) => records(page).getByRole(role, { name, exact: true })
const box = (page, label) => records(page).getByLabel(label, { exact: true })

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
      'A filter, open (Records)',
      async (page) => {
        await plane.order(0, words)
        await plane.order(0, words)
        // Every record, so the filter alone narrows them: no search, as Download CSV's states left it.
        await control(page, 'textbox', 'Search').fill('')
        await control(page, 'button', 'Search').click()
        await until(async () => /^Rows 1–/.test(await lineOf(page)), 'the records were never listed unsearched')
        const filter = control(page, 'button', 'Build a condition')
        await filter.focus()
        await page.keyboard.press('Enter')
        check('Enter on Build a condition opens the panel', same(await filter.getAttribute('aria-expanded'), 'true'))
        check('and leaves the keyboard on Build a condition', await focusedOn(page, filter))
        await page.keyboard.press('Tab')
        check('the next Tab reaches Field', await focusedOn(page, control(page, 'combobox', 'Field')))
        await control(page, 'combobox', 'Field').selectOption({ label: 'Notes' })
        await control(page, 'combobox', 'Condition').selectOption({ label: 'contains' })
        // In another case than the orders' notes: contains finds them in any case.
        await box(page, 'Text').fill(words.toUpperCase())
      },
    ],
    [
      'A filter applied (Records)',
      async (page) => {
        const sent = nextList(page)
        await box(page, 'Text').focus()
        await page.keyboard.press('Enter')
        const request = await sent
        check('a filter applied: the condition is in the list request’s body', same(JSON.parse(request.postData() ?? '{}').filter, [contains]))
        check('a filter applied: its words are in no URL', request.url().toLowerCase().includes(words) ? `the URL is ${request.url()}` : null)
        await until(async () => (await lineOf(page)) === 'Rows 1–2. Filtered by Notes.', 'the grid never said it listed the two orders, filtered')
        check('a filter applied: the keyboard stays in Text', await focusedOn(page, box(page, 'Text')))
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
        await control(page, 'combobox', 'Field').selectOption({ label: 'Id' })
        await control(page, 'combobox', 'Condition').selectOption({ label: 'is' })
        await box(page, 'Value').fill('12x')
        await box(page, 'Value').press('Enter')
        await until(async () => (await lineOf(page)) === sentence, `the grid never said the server's sentence "${sentence}"`)
        check('a filter refused: what was typed is still in Value', same(await box(page, 'Value').inputValue(), '12x'))
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
        // Closed again, as the journeys after this one found the panel.
        const filter = control(page, 'button', 'Build a condition')
        await filter.focus()
        await page.keyboard.press('Enter')
        check('a filter cleared: Enter on Build a condition closes the panel', same(await filter.getAttribute('aria-expanded'), 'false'))
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
