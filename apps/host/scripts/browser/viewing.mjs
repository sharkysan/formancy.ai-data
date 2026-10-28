// A form's list views in the browser (0105), on the workspace the filter's
// states left: every record, no condition, the panel closed. The order form
// offers two views and opens on neither (plane.mjs). The View picker is
// reached by Tab between Search and Filter; a view picked asks for exactly
// one first page, with its filter and its sort in the request's body and
// nothing of it in the address, the keyboard staying on View and the
// headers showing its two sorted columns; a header the person sorts by
// makes the picker say "Your own filter and sort", in one request; and "All
// records" asks one first page with neither. Each state is measured by the
// gate's `measured` on the way: the picker's colours and target size, the
// sorted headers' text decided on the pixels, and no sideways scroll, down
// to 320 px.
//
// A select is chosen with Playwright's selectOption, not its keys, for the
// reason filtering.mjs gives: how a closed select answers an arrow differs
// by browser and platform, and is the browser's own control, not the page's.

import { FORM, ORDER_VIEWS } from './plane.mjs'
import { focusedOn, until } from './measure.mjs'

const LISTS = `/v1/forms/${FORM}/records/list`
const OWN = 'Your own filter and sort'
const [PLACED, NOTED] = ORDER_VIEWS
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
/** The grid's own line: the section's first status with no name. */
const lineOf = async (page) => (await records(page).getByRole('status', { name: /^$/ }).first().textContent()) ?? ''
const picker = (page) => records(page).getByRole('combobox', { name: 'View', exact: true })
/** A header's sort, as its aria-sort says it; null for a column that is not sorted. A sorted header's name holds its sort's number too, so it is found by how it starts. */
const sortOf = async (page, label) => {
  const sort = await page.getByRole('grid', { name: 'Records', exact: true }).getByRole('columnheader', { name: new RegExp(`^${label}`) }).getAttribute('aria-sort')
  return sort === 'none' ? null : sort
}

/** Null when `got` is `want`, otherwise both. */
const same = (got, want) => (JSON.stringify(got) === JSON.stringify(want) ? null : `it is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)

/** The picker's choices, and the one it shows. */
async function choices(page) {
  return { offered: await picker(page).getByRole('option').allTextContents(), shown: await picker(page).getByRole('option', { selected: true }).textContent() }
}

const isList = (request) => request.method() === 'POST' && new URL(request.url()).pathname === LISTS

/**
 * The bodies of the list requests the page sends while `act` runs, until
 * one has been answered and the grid's line matches `line`, and two frames
 * more, by when a second request would have been sent.
 */
async function listsWhile(page, act, line) {
  const bodies = []
  let answers = 0
  const heard = (request) => {
    if (isList(request)) bodies.push(JSON.parse(request.postData() ?? '{}'))
  }
  const answered = (response) => {
    if (isList(response.request())) answers += 1
  }
  page.on('request', heard)
  page.on('response', answered)
  try {
    await act()
    await until(async () => answers > 0 && line.test(await lineOf(page)), `the grid never answered with a line like ${String(line)}`)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  } finally {
    page.off('request', heard)
    page.off('response', answered)
  }
  return bodies.map(({ filter, sort, offset }) => ({ filter, sort, offset }))
}

/** The states, in order. */
export function viewJourney(plane, { check }) {
  return [
    ['Views offered (Records)', async (page) => {
      // From Search, as the filter's states left it: the next Tab is View, and the one after it Filter.
      await records(page).getByRole('button', { name: 'Search', exact: true }).focus()
      await page.keyboard.press('Tab')
      check('Tab from Search reaches View', await focusedOn(page, picker(page)))
      await page.keyboard.press('Tab')
      check('and the next Tab Filter', await focusedOn(page, records(page).getByRole('button', { name: 'Filter', exact: true })))
      check('views offered: every view, and the grid on every record', same(await choices(page), { offered: ['All records', PLACED.name, NOTED.name], shown: 'All records' }))
    }],
    ['A view picked (Records)', async (page) => {
      const before = page.url()
      await picker(page).focus()
      const sent = await listsWhile(page, () => picker(page).selectOption({ label: NOTED.name }), /^Rows 1–\d+(; more follow)?\. Filtered by Notes\.$/)
      check('a view picked: one first page, with its filter and its sort', same(sent, [{ filter: NOTED.filter, sort: NOTED.sort, offset: 0 }]))
      check('a view picked: the headers show its two columns', same([await sortOf(page, 'Amount'), await sortOf(page, 'Id')], ['descending', 'ascending']))
      check('a view picked: the picker names it', same((await choices(page)).shown, NOTED.name))
      check('a view picked: the keyboard stays on View', await focusedOn(page, picker(page)))
      check('a view picked: nothing of it is in the address', page.url() === before ? null : `the address became ${page.url()}`)
    }],
    ['A sort of your own (Records)', async (page) => {
      const header = page.getByRole('grid', { name: 'Records', exact: true }).getByRole('columnheader', { name: /^Order date/ })
      const sent = await listsWhile(
        page,
        async () => {
          await header.focus()
          await page.keyboard.press('Enter')
        },
        /^Rows 1–\d+(; more follow)?\. Filtered by Notes\.$/,
      )
      check('a sort of your own: one first page, in the view’s filter and the header’s sort', same(sent, [{ filter: NOTED.filter, sort: [{ field: 'order_date', direction: 'asc' }], offset: 0 }]))
      check('a sort of your own: the Order date header says it sorts ascending', same(await sortOf(page, 'Order date'), 'ascending'))
      check('a sort of your own: the picker says so', same(await choices(page), { offered: ['All records', PLACED.name, NOTED.name, OWN], shown: OWN }))
      check('a sort of your own: the view’s columns no longer sorted', same([await sortOf(page, 'Amount'), await sortOf(page, 'Id')], [null, null]))
    }],
    ['All records again (Records)', async (page) => {
      await picker(page).focus()
      const sent = await listsWhile(page, () => picker(page).selectOption({ label: 'All records' }), /^Rows 1–\d+(; more follow)?\.$/)
      check('all records: one first page, with neither a filter nor a sort', same(sent, [{ filter: [], sort: [], offset: 0 }]))
      check('all records: no header sorted', same(await sortOf(page, 'Order date'), null))
      check('all records: the picker says so, and offers no filter of your own', same(await choices(page), { offered: ['All records', PLACED.name, NOTED.name], shown: 'All records' }))
    }],
  ]
}
