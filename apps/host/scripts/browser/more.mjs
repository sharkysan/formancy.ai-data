// A customer list that goes on, in the browser (0085): signed out and in
// again as the third clerk, whose tenant's customers are one lookup page and
// ten more, a new order, and in each renderer the keyboard on Customer and
// Down, which opens the first page with the renderer's sentence that there
// are more under it. Last in each pass, because it changes who is signed in.
//
// What jsdom cannot see of that state: the paper's colours and targets with
// the list open, and nothing past either edge at 320 px with the sentence
// said, which the gate's `measured` reads. Its axe audit runs after the gate
// blurs whatever has the keyboard, which closes a typeahead and silences it,
// so each state also audits the paper itself while the list is open and
// saying so. Every check has one name in every browser (0058).
//
// Where the sentence is drawn, held as 0085's cost: every reference theme of
// formancy 0.6.0 and 0.7.0, whose stylesheets are byte-identical, places the open list at the foot of the box (`top: 100%`,
// `z-index: 20`, up to 14rem tall), over the line under it, which is where
// the status is. Measured on 2026-10-18 in Chromium 153 and Firefox 155 on
// Windows at 1280 and 320 px: the window showed the option "First 01" at
// the sentence's middle, so a sighted person does not read it while the
// list is open, and axe cannot decide its contrast. Each state checks that
// the open list's box covers the sentence's -- which fails the day a
// release draws them apart, and the cost is to be read again -- and that
// every text axe could not decide lies under the open list, so a text left
// undecided for any other reason still fails; and it prints what the
// window shows there, nothing when the sentence is below the window.
//
// In Separate views, where the record is drawn alone: the third clerk's
// orders fit the Records grid's columns to other widths than the first
// clerk's, and at 360 px a cell of it lay under the grid's own scrollbar,
// where the gate reads no pixel of it (measured on 2026-10-18 in Chromium).

import { createFormText } from '@formancy/core/words'
import { DEFAULT_MAX_PAGE_SIZE } from '@formancy/data-core'
import { FORM, TOKENS } from './plane.mjs'
import { audit, focusedOn, until, WITHIN } from './measure.mjs'
import { carryOn } from './workspace.mjs'

/** What an open typeahead says over a page that goes on, in the renderer's words, with the page the source states. */
const MORE = createFormText({ locale: '' })('options.more', { count: DEFAULT_MAX_PAGE_SIZE })

const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const pane = (page, name) => page.getByRole('region', { name, exact: true })
const paper = (page, name) => pane(page, name).getByRole('form', { name: `Order, ${name}` })
const customer = (page, name) => paper(page, name).getByRole('combobox', { name: 'Customer' })

/** Tab until the keyboard is on `name`'s Customer, as a person reaches it: bounded, and the check says where it ended. */
async function tabTo(page, name) {
  const box = customer(page, name)
  for (let step = 0; step < 40 && !(await box.evaluate((element) => element === document.activeElement)); step += 1) await page.keyboard.press('Tab')
}

/** One renderer's state: Customer reached by Tab, Down, and the open list saying there are more, audited on its paper while it does. */
function listSaysMore(name, { check }) {
  return async (page) => {
    await tabTo(page, name)
    check(`a list that goes on (${name}): Tab reaches Customer`, await focusedOn(page, customer(page, name)))
    await page.keyboard.press('ArrowDown')
    const sentence = pane(page, name).getByRole('status').filter({ hasText: MORE })
    const said = await until(async () => (await sentence.count()) === 1, 'the list never said there are more')
      .then(() => null)
      .catch((error) => error.message)
    check(`a list that goes on (${name}): Down opens it, saying there are more`, said)
    const options = await paper(page, name).getByRole('listbox', { name: 'Customer suggestions' }).getByRole('option').count()
    check(`a list that goes on (${name}): it offers one page`, options === DEFAULT_MAX_PAGE_SIZE ? null : `it offers ${String(options)}`)
    check(`a list that goes on (${name}): the keyboard stays on Customer`, await focusedOn(page, customer(page, name)))
    // The paper while the list is open and saying so: the gate's own audit runs after a blur, which closes it.
    const open = await audit(page, await paper(page, name).elementHandle())
    check(`a list that goes on (${name}): axe finds nothing on the paper with it open`, open.violations.length === 0 ? null : open.violations.join('; '))
    check(`a list that goes on (${name}): contrast and target size measured on the paper, over something`, open.measured.length === 2 ? null : `only ${open.measured.join(', ') || 'nothing'}`)
    const under = await page.evaluate(() => {
      const list = [...document.querySelectorAll('[role="listbox"]')].find((candidate) => !candidate.hidden)?.getBoundingClientRect()
      const covered = (box) => list !== undefined && box.top < list.bottom && box.bottom > list.top && box.left < list.right && box.right > list.left
      const elsewhere = (window.formancyGateUndecided ?? []).filter((element) => !covered(element.getBoundingClientRect())).map((element) => element.outerHTML.slice(0, 60))
      const status = [...document.querySelectorAll('[role="status"]')].find((candidate) => (candidate.textContent ?? '').includes('there are more'))?.getBoundingClientRect()
      const hit = status === undefined ? null : document.elementFromPoint(status.left + Math.min(20, status.width / 2), status.top + status.height / 2)
      const within = status !== undefined && list !== undefined && status.top >= list.top - 1 && status.bottom <= list.bottom + 1 && status.left >= list.left - 1 && status.right <= list.right + 1
      return { elsewhere, within, shown: hit === null ? 'nothing' : `${hit.getAttribute('role') ?? hit.tagName.toLowerCase()} "${(hit.textContent ?? '').trim().slice(0, 30)}"` }
    })
    check(`a list that goes on (${name}): the open list covers the sentence, as 0085 says formancy 0.6.0 and 0.7.0 draw it`, under.within ? null : 'the sentence lies outside the open list: read 0085’s cost again')
    check(`a list that goes on (${name}): every text on the paper whose contrast axe left undecided lies under the open list`, under.elsewhere.length === 0 ? null : `undecided elsewhere: ${under.elsewhere.slice(0, 4).join('; ')}`)
    console.log(`  where the sentence is, the window shows ${under.shown}; ${String(open.undecided.length)} texts lie under the open list`)
  }
}

/** The states, in order, after every other journey of the pass. */
export function moreJourney(plane, gate) {
  return [
    ['A list that goes on (React)', async (page) => {
      // Signed out from wherever the downloads left the page, which may ask about unsaved work first.
      await carryOn(page, page.getByRole('button', { name: 'Sign out', exact: true }))
      await page.getByLabel('Host token').fill(TOKENS.thirdClerk)
      await page.getByRole('button', { name: 'Sign in' }).click()
      // Signed in again, the page opens the form its address names, which the downloads left: chosen anew all the same.
      await page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Order ${FORM}` }).click()
      await page.getByRole('heading', { level: 2, name: `Order ${FORM}` }).waitFor(WITHIN)
      await until(async () => /^Rows 1–/.test((await records(page).getByRole('status', { name: /^$/ }).first().textContent()) ?? ''), 'the third clerk’s orders were never listed')
      await page.getByRole('radio', { name: 'Both', exact: true }).check()
      await page.getByRole('radio', { name: 'Separate views', exact: true }).check()
      await records(page).getByRole('button', { name: 'New record' }).click()
      await page.getByRole('heading', { level: 3, name: 'New record' }).waitFor(WITHIN)
      for (const name of ['React', 'Angular']) await customer(page, name).waitFor(WITHIN)
      await listSaysMore('React', gate)(page)
    }],
    ['A list that goes on (Angular)', async (page) => {
      // From React's Customer, where the last state left the keyboard before the gate's blur, onward into the Angular paper.
      await customer(page, 'React').focus()
      await listSaysMore('Angular', gate)(page)
    }],
  ]
}
