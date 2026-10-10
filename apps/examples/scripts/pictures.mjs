// The examples page's README picture (0038): scene examples-order of
// scripts/pictures/scenes.json, taken -- or, with --check, walked and its
// text compared -- by scripts/pictures/session.mjs. Its header says the
// arguments; the camera's says what it reads from the DOM and why.
//
// The page as `vite build` made it, answered from dist on
// http://examples.invalid by the camera's `serve`: no server, because the
// page has none -- it runs the generator in the browser over the committed
// snapshot -- and nothing listens on a port. Elements are found by role and
// accessible name; the act waits by polling its parts' snapshots.
//
// `pnpm --filter @formancy/data-examples pictures`, after `pnpm build`; the
// root's `pnpm pictures` runs it with the others. Chromium comes from
// `pnpm exec playwright install chromium`, once per machine.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { field, pictures, said, untilSnapshot } from '../../../scripts/pictures/session.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ORIGIN = 'http://examples.invalid'

/** How long the page may take to arrive: the gate's MOUNTED_WITHIN_MS, for Angular, which loads on demand. */
const WITHIN = 20_000

/** Five decimals for a numeric(18,4) column: one more than its scale allows, so both renderers refuse it with "pattern". */
const AMOUNT = '12.34567'

/**
 * Until every preview has its Validate button, as the gate's `mounted()`
 * waits -- half of them are Angular. The gate's own function cannot be
 * imported, because its module runs the gate when it is loaded.
 */
async function open(page) {
  await page.goto(`${ORIGIN}/`)
  const forms = await page.getByRole('navigation', { name: 'Forms on this page' }).getByRole('link').count()
  const deadline = Date.now() + WITHIN
  while ((await page.getByRole('button', { name: 'Validate' }).count()) !== forms * 2 || forms === 0) {
    if (Date.now() > deadline) throw new Error(`not every form was previewed by both renderers within ${String(WITHIN)} ms`)
    await page.waitForTimeout(100)
  }
}

const acts = {
  // §3, scene 2: both sales.order previews after Validate, with a status
  // given and an amount one decimal past the column's scale.
  'examples-order': async (page) => {
    const parts = { React: page.getByRole('region', { name: 'sales.order React', exact: true }), Angular: page.getByRole('region', { name: 'sales.order Angular', exact: true }) }
    for (const part of Object.values(parts)) {
      await part.getByRole('textbox', { name: 'Status', exact: true }).fill('placed')
      await part.getByRole('textbox', { name: field('Amount') }).fill(AMOUNT)
      await part.getByRole('button', { name: 'Validate' }).click()
    }
    for (const [name, part] of Object.entries(parts)) {
      await untilSnapshot(part, /\[invalid\]/, { within: WITHIN, what: `the ${name} preview's refusal` })
      // The customer list is filled after the form is drawn, Angular's later
      // than React's (measured: --check, with the fonts refused, read
      // Angular's empty); the picture is of the form with its list.
      await untilSnapshot(part, /option "Muster AG"/, { within: WITHIN, what: `the ${name} preview's customer list` })
      // A renderer that rounded or cut the amount would refuse something else than the caption says.
      const amount = await part.getByRole('textbox', { name: field('Amount') }).inputValue()
      if (amount !== AMOUNT) throw new Error(`the ${name} preview holds the amount ${amount}, not ${AMOUNT}`)
    }
    return { parts }
  },
}

const snapshot = JSON.parse(readFileSync(join(app, 'src', 'fixture-snapshot.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))

try {
  const { chromium } = await import('playwright')
  await pictures({
    app: 'examples',
    chromium,
    playwright: require('playwright/package.json').version,
    width: 1300,
    css: { directory: join(app, 'src'), entry: 'app.css' },
    themes: manifest.dependencies['@formancy/themes'],
    origin: ORIGIN,
    dist: join(app, 'dist'),
    within: WITHIN,
    secrets: [],
    database: `the captured snapshot apps/examples/src/fixture-snapshot.json (PostgreSQL ${snapshot.serverVersion})`,
    open,
    acts,
  })
} catch (error) {
  console.error(`examples pictures: ${said(error, [])}`)
  process.exitCode = 1
}
