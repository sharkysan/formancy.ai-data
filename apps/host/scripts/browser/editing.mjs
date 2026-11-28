// The open record edited in its row of the Records grid (0179), in the
// browser, on the order form: a cell of the open row in edit, its row saved
// from the keyboard and its row not saved -- each measured by the gate's
// `measured` on the way, and axe, colour contrast and target size among
// it, run inside two of them over what the measure after would no longer
// see: the editor while it is open, and the row's Not saved mark while it
// is drawn, its contrast decided as the measure decides a grid's text --
// and what only a real browser shows:
// F2 putting the keyboard in an editor of the page's own, named for its
// field and record, inside the grid's well; Shift+Tab and Tab moving it
// among the row's editable cells, past the one the record's form edits;
// Escape giving the cell's edit up with the keyboard back on the cell;
// Enter saving the row with the keyboard still on its cell, the line
// saying so and the database holding it; and a save stale because the
// order was changed beside the page, the row's first cell saying Not
// saved, the line saying its changes are kept, the keyboard still on the
// cell -- the record's notice opened without taking it. The gate's measure
// takes the keyboard off the page, which ends an edit as any focus leaving
// the grid does, the engine keeping what was typed: so the editor is
// audited while it is open, and each state puts the keyboard back on its
// cell first. It ends with the draft discarded by the notice's Load the
// saved record, back on the orders' Records, where the filter's states
// begin.
//
// PostgreSQL only, as the gate is. What the engines answer -- invalid,
// declined, refused, lost, a save out holding the next row -- is the jsdom
// suites', on both (grid-editing.test.tsx), and AG Grid's editing without
// a server, cell-editors.test.tsx's. The browsers disagree on nothing this
// module checks as it was written; a difference found is named in
// scripts/browsers.mjs's FACTS and held by one check in every browser
// (0058).

import { audit, decide, describeFocus, focusedOn, until, WITHIN } from './measure.mjs'
import { FORM } from './plane.mjs'
import { carryOn } from './workspace.mjs'

const formLink = (page) => page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Order ${FORM}`, exact: true })
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const grid = (page) => page.getByRole('grid', { name: 'Records', exact: true })
/** The Records grid's line: the first status with no name. */
const status = (page) => records(page).getByRole('status', { name: /^$/ }).first()

/** The cell of `colId` in the row of `record`: by the `col-id` AG Grid writes on it and the row's Id, since the tree names a cell by its value alone. */
const cellOf = (page, record, colId) =>
  grid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: new RegExp(`^${record.slice('k1:'.length)}(Saving…|Not saved|May have been saved)?$`) }) })
    .first()
    .locator(`[role="gridcell"][col-id="${colId}"]`)

/** Whether the keyboard is in the editor named `name`, inside the grid's well. */
const inEditor = (page, name) =>
  page.evaluate(
    (wanted) =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.getAttribute('aria-label') === wanted &&
      document.activeElement.closest('.grid-bench') !== null,
    name,
  )

/** The states, in order; `run` holds this width's pass. */
export function editingJourney(plane, gate, run) {
  const { check } = gate
  const at = { record: '', notes: `edited in its row at width ${String(run.customer)}` }
  const editor = (label) => `${label}, Order ${at.record}`
  const keyIn = async (page, label, problem) => {
    await until(() => inEditor(page, editor(label)), problem).catch(() => null)
    return (await inEditor(page, editor(label))) ? null : `${problem}: the focus is on ${await describeFocus(page)}`
  }
  /** F2 on the open row's Group cell, the keyboard there first: the gate's measure took it off the page. */
  const editGroup = async (page) => {
    await cellOf(page, at.record, 'group').focus()
    await page.keyboard.press('F2')
    await until(() => inEditor(page, editor('Group')), 'no editor on Group')
  }
  return [
    [
      'A cell of the open row in edit',
      async (page) => {
        at.record = await plane.order(0, at.notes)
        await carryOn(page, formLink(page))
        await records(page).getByRole('textbox', { name: 'Search' }).fill(at.notes)
        await records(page).getByRole('button', { name: 'Search' }).click()
        await until(async () => (await status(page).textContent()) === 'Rows 1–1.', 'the search never listed the order')
        await cellOf(page, at.record, 'id').click()
        await page.getByRole('heading', { level: 3, name: `Order ${at.record}`, exact: true }).waitFor(WITHIN)
        await cellOf(page, at.record, 'group').focus()
        await page.keyboard.press('F2')
        check('F2 on the open row’s cell puts the keyboard in its editor, named for its field and record', await keyIn(page, 'Group', 'no editor'))
        await page.keyboard.press('Shift+Tab')
        check('Shift+Tab in it goes to the row’s editable cell before, past the one the form edits', await keyIn(page, 'Amount', 'not on Amount'))
        await page.keyboard.press('Tab')
        check('and Tab back to the one after', await keyIn(page, 'Group', 'not back on Group'))
        await page.keyboard.type('Gate')
        // Audited while it is open, colour contrast and target size among it: the measure after this state closes it.
        const open = await audit(page)
        gate.axe(open.axe)
        check('a cell in edit, its editor open: axe finds nothing at WCAG 2.2 AA', open.violations.length === 0 ? null : open.violations.join('; '))
      },
    ],
    [
      'The open row saved from its cell',
      async (page) => {
        // What was typed is the engine's still: the editor opens on it, and Enter saves the row.
        await editGroup(page)
        const typed = await page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.value : null))
        check('the edit the measure ended kept what was typed', typed?.endsWith('Gate') === true ? null : `the editor holds ${JSON.stringify(typed)}`)
        await page.keyboard.press('Enter')
        await until(async () => (await status(page).textContent()) === `Saved Order ${at.record}.`, 'the line never said the row was saved')
        check('Enter saves the row and leaves the keyboard on its cell', await focusedOn(page, cellOf(page, at.record, 'group')))
        const group = await plane.groupOf(at.record)
        check('and the database holds what the cell typed', group?.endsWith('Gate') === true ? null : `the group is ${JSON.stringify(group)}`)
        const saved = await cellOf(page, at.record, 'group').textContent()
        await page.keyboard.press('F2')
        await until(() => inEditor(page, editor('Group')), 'no editor')
        await page.keyboard.type('X')
        await page.keyboard.press('Escape')
        check('Escape gives the cell’s edit up, the keyboard back on the cell', await focusedOn(page, cellOf(page, at.record, 'group')))
        const shown = await cellOf(page, at.record, 'group').textContent()
        check('and the cell shows what it held before the edit', shown === saved ? null : `it shows "${String(shown)}", not "${String(saved)}"`)
      },
    ],
    [
      'The open row not saved',
      async (page) => {
        await plane.change(at.record, `${at.notes}, changed beside the page`)
        await editGroup(page)
        await page.keyboard.type(' again')
        await page.keyboard.press('Enter')
        const first = cellOf(page, at.record, 'id')
        await until(async () => ((await first.textContent()) ?? '').endsWith('Not saved'), 'the row never said it was not saved')
        const said = (await status(page).textContent()) ?? ''
        check(
          'a stale save: the line says its changes are kept',
          said.endsWith('Load the saved record in its notice discards them.') ? null : `it says "${said}"`,
        )
        check('and the keyboard stays on the cell, the record’s notice taking none of it', await focusedOn(page, cellOf(page, at.record, 'group')))
        // Audited while the row says Not saved: the measure after this state comes once Load the saved record has taken the mark away.
        const marked = await audit(page)
        gate.axe(marked.axe)
        check('a row not saved, its mark drawn: axe finds nothing at WCAG 2.2 AA', marked.violations.length === 0 ? null : marked.violations.join('; '))
        const decided = await decide(page, marked.undecided)
        const short = [
          ...decided.left.slice(0, 4).map((each) => `undecided: ${each}`),
          ...decided.failing.map((entry) => `${entry.name} ${String(entry.ratio)}:1`),
          ...decided.selectsFailing.slice(0, 4),
        ]
        check('and the contrast of every text decided, the grids’ on the pixels at 4.5:1 or more', short.length === 0 ? null : short.join('; '))
        // The draft discarded, as the notice offers: the next states begin from the orders' Records with nothing unsaved.
        const notice = page.getByRole('region', { name: /^(React|Angular) Not saved$/ }).first()
        await notice.getByRole('button', { name: 'Load the saved record', exact: true }).click()
        await notice.waitFor({ state: 'detached', ...WITHIN })
      },
    ],
  ]
}
