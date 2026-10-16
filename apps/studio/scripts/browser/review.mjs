// Publication under review (0065) in the browser, on a plane under review:
// an author's draft submitted from the Submit step, then the same draft open
// on the publisher's Review step, on its paper, and approved by keyboard.
// Each state is measured on the way by the gate, and the paper is held to
// the same rule as the preview's: nothing of studio.css on it.

import { focusAfterEnter } from './measure.mjs'
import { chooseOrder, fillThePolicy, nav, step } from './journey.mjs'
import { TOKENS } from './plane.mjs'
import { checkThePaper } from './styles.mjs'

/** Signed in with `token` on the sign-in screen in view, once the workbench has put the keyboard on its first step. */
export async function signIn(page, token) {
  const field = page.getByLabel('Host token')
  await field.waitFor()
  await field.fill(token)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('navigation', { name: 'Steps' }).waitFor()
}

/**
 * The states, in order, as `[name, act]`: each act brings the studio to the
 * state it names, checking on the way what only that moment can show.
 * The first starts signed in as the author, on the Connect step.
 */
export function review(check) {
  return [
    ['Submit, a draft submitted', async (page) => {
      await page.getByRole('button', { name: 'Discover fixture', exact: true }).click()
      await chooseOrder(page)
      await step(page, 'Choose').getByRole('button', { name: 'Generate the form' }).click()
      await step(page, 'Generate').waitFor()
      await nav(page, 'Policy').click()
      await fillThePolicy(page)
      await nav(page, 'Submit').click()
      await step(page, 'Submit').getByRole('button', { name: 'Submit version 1 for review' }).click()
      await page.getByText('Draft 1 of sales-order submitted: a publisher other than you approves it.').waitFor()
    }],
    // The publisher, in the same browser: the queue, and the author's draft
    // opened below it, on white paper, with the keyboard on its heading.
    ['Review, a draft open for review', async (page) => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await signIn(page, TOKENS.publisher)
      await nav(page, 'Review').click()
      const queue = step(page, 'Review')
      await queue.getByRole('button', { name: 'Open draft 1 of sales-order' }).click()
      const draft = queue.getByRole('region', { name: 'Draft 1 of sales-order' })
      await draft.getByRole('form', { name: 'Order, draft 1' }).waitFor()
      await page.waitForFunction(() => document.activeElement?.id === 'draft-heading', undefined, { timeout: 15_000 })
      await checkThePaper(page, check, 'a draft open for review')
    }],
    // Approved, the draft is no longer pending and its buttons go with its
    // state: the keyboard goes to the draft's heading, not to the page.
    ['Review, a draft approved by keyboard', async (page) => {
      const draft = step(page, 'Review').getByRole('region', { name: 'Draft 1 of sales-order' })
      const approve = draft.getByRole('button', { name: 'Approve and publish' })
      const heading = draft.getByRole('heading', { name: 'Draft 1 of sales-order' })
      // Settled once the button is gone, which is when the draft has been read again as published.
      const settled = async () => {
        await draft.getByText('Published as version 1.').waitFor()
        await approve.waitFor({ state: 'detached' })
      }
      check('approving a draft leaves the keyboard on its heading', await focusAfterEnter(page, approve, settled, heading))
    }],
  ]
}
