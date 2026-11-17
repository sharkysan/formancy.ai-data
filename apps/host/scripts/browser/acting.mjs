// An action over the open record in the browser (0162), on the action
// order the plane publishes over the actions schema: its button in the
// record's header; its dialog, drawn by the renderer shown on its own
// paper, with no rule of host.css selecting anything on it, and Escape
// there giving the keyboard back to the action; the confirmation taking
// the keyboard, Keep it the next Tab, its frame against the glass at 3:1
// or more and its two answers one under the other on a phone, Keep it
// first, and Escape there Keep it, the keyboard back on the action; done,
// from the keyboard, with the keyboard on what the server did and the
// order closed in the database; and "Not run" in the deployment's words,
// said as its own -- each measured by the gate's `measured` on the way.
//
// PostgreSQL only, as the gate is. What the engines answer, a save or the
// run out, a stale run, and a run whose answer was lost -- "It may have
// run", before and after its check -- are the jsdom suites', on both
// (page.test.tsx, in-flight.test.tsx, actions.test.tsx), not measured here.

import { frame, landsOn, stacked } from './deleting.mjs'
import { focusedOn, WITHIN } from './measure.mjs'
import { ACTION_ORDER, CLOSE_WORDS, FORM } from './plane.mjs'
import { rulesReaching } from './styles.mjs'
import { carryOn, demo } from './workspace.mjs'

const formLink = (page, id) => page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Order ${id}`, exact: true })
const regionNamed = (page, name) => page.getByRole('region', { name, exact: true })
/** The action's region by its name: the action and the record, and a question mark while it confirms. */
const closing = (page, record, confirming = false) => regionNamed(page, `${CLOSE_WORDS.label}: Order ${record}${confirming ? '?' : ''}`)
const action = (page) => page.getByRole('button', { name: CLOSE_WORDS.label, exact: true })
/** The dialog's paper, drawn by whichever renderer the page shows it with: React where both are shown. */
const dialog = (page, record) => closing(page, record).getByRole('form', { name: new RegExp(`^${CLOSE_WORDS.label}, (React|Angular)$`) })

/** The order `record` opened by its token, as the demo's Load opens it, with the demo's controls put back as they were. */
async function open(page, record) {
  const disclosure = page.getByRole('button', { name: 'For the demo', exact: true })
  const shown = (await disclosure.getAttribute('aria-expanded')) === 'true'
  await demo(page, true)
  await page.getByRole('textbox', { name: 'Record token', exact: true }).fill(record)
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await page.getByRole('heading', { level: 3, name: `Order ${record}`, exact: true }).waitFor(WITHIN)
  await demo(page, shown)
}

/** The action asked for, its note typed into its dialog and Continue pressed: the confirmation, once drawn. */
async function confirmation(page, record, note) {
  await action(page).click()
  await dialog(page, record)
    .getByLabel(/^Note\b/)
    .fill(note)
  await dialog(page, record).getByRole('button', { name: 'Continue', exact: true }).click()
  const region = closing(page, record, true)
  await region.waitFor(WITHIN)
  return region
}

/** The states, in order; `run` holds this width's pass. */
export function actionJourney(plane, { check }, run) {
  const at = { record: '', refusing: '', note: `ran at width ${String(run.customer)}` }
  return [
    [
      "An action's dialog",
      async (page) => {
        at.record = await plane.actionOrder()
        await carryOn(page, formLink(page, ACTION_ORDER))
        await open(page, at.record)
        await action(page).click()
        const asking = closing(page, at.record)
        await asking.waitFor(WITHIN)
        check("an action's dialog: the keyboard is on its region", await landsOn(page, asking))
        await dialog(page, at.record)
          .getByLabel(/^Note\b/)
          .waitFor(WITHIN)
        const found = await rulesReaching(dialog(page, at.record))
        check("the action's dialog paper: no rule of host.css selects anything on it", found.reached.length === 0 ? null : found.reached.slice(0, 6).join('; '))
        // A guard on the guard: real rules, matched against a whole form -- its note a textarea, the control a text parameter is given.
        const missing = ['label', 'button'].filter((tag) => !found.tags.includes(tag))
        const control = ['input', 'textarea', 'select'].some((tag) => found.tags.includes(tag))
        check(
          'which matched host.css against the whole dialog',
          found.rules > 0 && missing.length === 0 && control
            ? null
            : `${String(found.rules)} rules, and no ${[...missing, ...(control ? [] : ['control'])].join(', ')} on the paper`,
        )
      },
    ],
    [
      "An action's confirmation",
      async (page) => {
        // The gate's measure took the keyboard off the page: given back to the dialog's region first.
        await closing(page, at.record).focus()
        await page.keyboard.press('Escape')
        check("Escape gives the keyboard back to the action's button", await focusedOn(page, action(page)))
        const region = await confirmation(page, at.record, at.note)
        check("an action's confirmation: the keyboard is on it", await landsOn(page, region))
        await page.keyboard.press('Tab')
        check('the next Tab reaches Keep it, never the button that runs', await focusedOn(page, region.getByRole('button', { name: 'Keep it', exact: true })))
        const ring = await frame(region)
        check("the action's confirmation's frame against the glass at 3:1 or more", ring.problem ?? (ring.ratio >= 3 ? null : `${String(ring.ratio)}:1`))
        const answers = await stacked(region, 'Run it')
        check(
          'its answers stand one under the other, Keep it first, on a phone only',
          answers.problem ??
            (answers.phone
              ? answers.under && answers.wide
                ? null
                : 'beside each other, or of different widths, on a phone'
              : answers.under
                ? 'one under the other where there is room'
                : null),
        )
        await page.keyboard.press('Escape')
        check("Escape in the confirmation gives the keyboard back to the action's button", await focusedOn(page, action(page)))
        const kept = await plane.actionOrderOf(at.record)
        check(
          'and nothing ran: the confirmation is gone, the order still open in the database',
          (await region.count()) !== 0 ? 'the confirmation is still drawn' : kept.status === 'open' ? null : JSON.stringify(kept),
        )
        // Asked again, for the steps after this one.
        await confirmation(page, at.record, at.note)
      },
    ],
    [
      'An action, done',
      async (page) => {
        // From the keyboard: Run it, the Tab after Keep it, and Enter.
        await closing(page, at.record, true).getByRole('button', { name: 'Keep it', exact: true }).focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')
        const done = closing(page, at.record)
        await done.getByText(CLOSE_WORDS.done, { exact: true }).waitFor(WITHIN)
        check('a run that is done: the keyboard is on what the server did', await landsOn(page, done))
        const stored = await plane.actionOrderOf(at.record)
        check(
          'and the order is closed in the database, with the note its dialog asked',
          stored.status === 'closed' && stored.note === at.note ? null : JSON.stringify(stored),
        )
      },
    ],
    [
      'An action, not run',
      async (page) => {
        await closing(page, at.record).getByRole('button', { name: 'Close', exact: true }).click()
        check("Close gives the keyboard back to the action's button", await focusedOn(page, action(page)))
        at.refusing = await plane.actionOrder()
        await open(page, at.refusing)
        const region = await confirmation(page, at.refusing, 'refuse')
        await region.getByRole('button', { name: 'Run it', exact: true }).click()
        const refused = regionNamed(page, 'Not run')
        await refused.waitFor(WITHIN)
        check('a run the deployment refused: the keyboard is on "Not run"', await landsOn(page, refused))
        const said = (await refused.getByRole('paragraph').allTextContents()).join(' ')
        check(
          'which says its reason, and that the words are the database’s own',
          said === "This order cannot be closed now. This reason is the database's own." ? null : `it says "${said}"`,
        )
      },
    ],
    [
      'Back to the orders, after an action',
      async (page) => {
        // The orders the journeys after this one use.
        await carryOn(page, formLink(page, FORM))
        await page.getByRole('region', { name: 'Records', exact: true }).getByRole('grid', { name: 'Records', exact: true }).waitFor(WITHIN)
      },
    ],
  ]
}
