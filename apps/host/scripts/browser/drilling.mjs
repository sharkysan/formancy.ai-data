// Drill down's states in the browser (0090): a customer made for the pass,
// one of its orders and that order's line three levels down -- each
// measured by the gate's `measured` on the way -- and what only a real
// browser shows: the trail's crumbs reached by Tab in order, its
// separators drawn and not read, Enter on one putting the keyboard on its
// level's heading, the browser's own Back
// going down again, and on a phone the trail's ends and a button that
// draws the rest, which then leaves the keyboard on the crumb it drew.

import { CUSTOMERS } from './plane.mjs'
import { carryOn } from './workspace.mjs'
import { describeFocus, focusedOn, until, WITHIN } from './measure.mjs'

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const trail = (page) => page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
const heading = (page, name) => page.getByRole('heading', { level: 3, name, exact: true })
/** The row of the grid `name` names with a cell that says `text`. */
const row = (page, name, text) =>
  page
    .getByRole('grid', { name, exact: true })
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: text, exact: true }) })
    .first()

/** What the trail says, crumb by crumb. */
async function crumbs(page) {
  return (await trail(page).getByRole('listitem').allTextContents()).map((text) => text.trim())
}

/** Null when `got` is `want`, otherwise both. */
const same = (got, want) => (JSON.stringify(got) === JSON.stringify(want) ? null : `it says ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)

/** Whether the window is a phone's, where the trail draws its ends: the page's own media query. */
const phone = (page) => page.evaluate(() => window.matchMedia('(max-width: 40rem)').matches)

/** How the Records panel and its grid's well are sized, as the browser computed them: what a layout's rules decide. */
const recordsSize = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.lanes > .master')
    const well = panel?.querySelector('.grid-bench.master-bench')
    if (!panel || !well) return null
    const of = (element, keys) => Object.fromEntries(keys.map((key) => [key, getComputedStyle(element)[key]]))
    return { panel: of(panel, ['maxHeight', 'overflowY', 'position']), well: of(well, ['maxHeight', 'flexGrow', 'flexShrink', 'flexBasis', 'minHeight']) }
  })

/** Enter on the first cell of a row, as a person at the keyboard opens one. */
async function enterOn(page, locator) {
  const cell = locator.getByRole('gridcell').first()
  await cell.waitFor(WITHIN)
  await cell.focus()
  await page.keyboard.press('Enter')
}

async function aCustomer(page, at) {
  const { plane, check } = at
  await plane.insertCustomer(at.no, at.name)
  at.order = await plane.order(1, null, at.name)
  at.line = `${at.order},1`
  await carryOn(page, page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Customer ${CUSTOMERS}` }))
  await records(page).getByRole('grid', { name: 'Records', exact: true }).waitFor(WITHIN)
  // Level 0 is Separate views' records view, sized as it is at this width: the panel and the grid's well.
  await page.getByRole('radio', { name: 'Separate views', exact: true }).check()
  const separate = await recordsSize(page)
  await page.getByRole('radio', { name: 'Drill down', exact: true }).check()
  check("Drill down: its records are sized as Separate views' records", same(await recordsSize(page), separate))
  await enterOn(page, row(page, 'Records', at.name))
  await heading(page, `Customer k1:1,${String(at.no)}`).waitFor(WITHIN)
  check('Drill down: a customer is named in the trail by its name', same(await crumbs(page), ['Records', `Customer ${at.name}`]))
  await until(async () => (await focusedOn(page, heading(page, `Customer k1:1,${String(at.no)}`))) === null, 'never').catch(() => null)
  check("Drill down: Enter on a row puts the keyboard on its level's heading", await focusedOn(page, heading(page, `Customer k1:1,${String(at.no)}`)))
}

async function anOrderLine(page, at) {
  const { check } = at
  await enterOn(page, row(page, 'Order', at.order.slice(3)))
  await heading(page, `Order ${at.order}`).waitFor(WITHIN)
  await enterOn(page, row(page, 'Order line', '1'))
  await heading(page, `Order line ${at.line}`).waitFor(WITHIN)
  const all = ['Records', `Customer ${at.name}`, `Order ${at.order}`, `Order line ${at.line}`]
  at.compact = await phone(page)
  check('Drill down: three levels down, the trail names every level, or on a phone its ends', same(await crumbs(page), at.compact ? ['Records', '…', `Order ${at.order}`, `Order line ${at.line}`] : all))
  // The separator between crumbs is drawn, never read: Playwright's
  // accessibility tree takes a pseudo-element's `content`, and its
  // alternative text when the rule gives one, as the browsers do.
  const said = await trail(page).ariaSnapshot()
  check("Drill down: the trail's separators are drawn and not read", said.includes('›') ? `the trail reads ${JSON.stringify(said)}` : null)
  // From the Layout group, Tab reaches the trail's buttons in order, and the level shown is no stop of it.
  await page.getByRole('radio', { name: 'Drill down', exact: true }).focus()
  const reached = []
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Tab')
    reached.push(await page.evaluate(() => (document.activeElement?.closest('nav') === null ? null : (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? null))))
  }
  check('Drill down: Tab reaches each crumb above the level shown, in order', same(reached, at.compact ? ['Records', 'Show all 4 levels', `Order ${at.order}`] : ['Records', `Customer ${at.name}`, `Order ${at.order}`]))
}

async function upByTheTrail(page, at) {
  const { check } = at
  const customer = trail(page).getByRole('button', { name: `Customer ${at.name}`, exact: true })
  if (at.compact) {
    const more = trail(page).getByRole('button', { name: 'Show all 4 levels', exact: true })
    check('Drill down, on a phone: the button that draws the rest says it is collapsed', (await more.getAttribute('aria-expanded')) === 'false' ? null : 'aria-expanded is not "false"')
    await more.focus()
    await page.keyboard.press('Enter')
    await customer.waitFor(WITHIN)
    check('Drill down, on a phone: drawn, the trail names every level', same(await crumbs(page), ['Records', `Customer ${at.name}`, `Order ${at.order}`, `Order line ${at.line}`]))
    check('Drill down, on a phone: the keyboard is on the first crumb it drew', await focusedOn(page, customer))
  }
  await customer.focus()
  await page.keyboard.press('Enter')
  const shown = heading(page, `Customer k1:1,${String(at.no)}`)
  await shown.waitFor(WITHIN)
  await until(async () => (await focusedOn(page, shown)) === null, `Enter on a crumb left the keyboard on ${await describeFocus(page)}`)
  check('Drill down: a level above shown by its crumb keeps the levels below', (await page.getByRole('heading', { name: `Order line ${at.line}`, exact: true }).count()) === 0 ? null : 'the line is still shown')
}

async function back(page, at) {
  const { check } = at
  await page.goBack()
  const line = heading(page, `Order line ${at.line}`)
  await line.waitFor(WITHIN)
  await until(async () => (await focusedOn(page, line)) === null, 'never').catch(() => null)
  check("Drill down: the browser's Back goes down to the level the crumb left, keyboard on its heading", await focusedOn(page, line))
  check('Drill down: and the address says that level', (await page.evaluate(() => window.location.hash)).endsWith('&layout=drill&view=record&level=3') ? null : await page.evaluate(() => window.location.hash))
  // Back to the layout the later journeys start from: the address keeps a
  // layout across a sign-in, and Drill down's records show no renderer switch.
  await page.getByRole('radio', { name: 'Side by side', exact: true }).check()
}

/** The states, in order; `run` holds this width's pass. */
export function drillJourney(plane, { check }, run) {
  // A customer of the pass's own, after the numbers the record's journey takes.
  const no = run.customer - 1000
  const at = { plane, check, no, name: `Drill Kunde ${String(no)}` }
  const states = [
    ['Drill down, a customer', aCustomer],
    ['Drill down, an order line', anOrderLine],
    ['Drill down, up by the trail', upByTheTrail],
    ['Drill down, Back', back],
  ]
  return states.map(([state, act]) => [state, (page) => act(page, at)])
}
