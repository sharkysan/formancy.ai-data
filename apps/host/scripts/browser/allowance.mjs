// The host page's policy allows one source beyond the examples page's:
// `'unsafe-inline'` in style-src, for the style elements AG Grid creates to
// apply its theme (0083, scripts/web-policies.mjs). Watched being needed in
// every browser the gate runs, once a run: the page under 0069's policy,
// which is the host page's without it, signed in and a form's records
// drawn, and those elements refused. An AG Grid that stopped creating them
// would leave the allowance allowing nothing the page does, and the check
// fails then, so the allowance goes with the need for it.

import { contentSecurityPolicy, POLICY } from '../../../../scripts/demo-headers.mjs'
import { hearPolicy, violationsHeard } from '../../../../scripts/browser-gate.mjs'
import { WITHIN } from './measure.mjs'
import { FORM, TOKENS } from './plane.mjs'

/**
 * What the check that the allowance is needed fails with, or null: the page
 * at `origin` in a page of `browser`'s own, its document sent with 0069's
 * policy in place of its own and every other file as served.
 */
export async function allowanceProblem(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await hearPolicy(page)
    await page.route(`${origin}/`, async (route) => {
      const original = await route.fetch()
      await route.fulfill({ response: original, headers: { ...original.headers(), 'content-security-policy': contentSecurityPolicy(POLICY) } })
    })
    await page.goto(`${origin}/`, { waitUntil: 'load' })
    await page.getByLabel('Host token').fill(TOKENS.clerk)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: `Order ${FORM}` }).click()
    // The grid's line, the Records region's first status with no name (0080): its rows have answered.
    await page.getByRole('region', { name: 'Records', exact: true }).getByRole('status', { name: /^$/ }).first().filter({ hasText: /^Rows 1–/ }).waitFor(WITHIN)
    const refused = await violationsHeard(page)
    return refused.some((violation) => violation.startsWith('style-src-elem refused inline')) ? null : `under 0069's policy the page reported ${refused.length === 0 ? 'nothing refused' : refused.slice(0, 4).join('; ')}, so 'unsafe-inline' allows nothing it does`
  } finally {
    await page.close()
  }
}
