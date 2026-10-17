// Download CSV in the browser (0080), on the workspace a delete's states
// left open: a file in the making -- the button aria-disabled with the
// keyboard on it, and pressing it again sending nothing -- the file made,
// which Playwright's download event gives as `<form id>.csv`, the
// byte-order mark first and every byte the server's for the request the
// page sent; a refusal in the server's words; and a line's file, under its
// order. Each state is measured by the gate's `measured` on the way: the
// line's and the button's colours, their target size, and no sideways
// scroll, down to 320 px.
//
// What only a browser can show here is the save itself: an object URL, an
// `<a download>` clicked, the URL revoked a task later (save-file.ts). The
// same combination in every browser, so no row of 0058's FACTS: if a browser
// needed the anchor elsewhere or the URL longer, its download would fail
// here, by these checks' names, and the difference would become one.

import { FORM, LINES, TOKENS } from './plane.mjs'
import { focusedOn, until, WITHIN } from './measure.mjs'

const EXPORTS = '**/v1/forms/*/records/export'
const records = (page) => page.getByRole('region', { name: 'Records', exact: true })
const lines = (page) => page.getByRole('region', { name: 'Order line', exact: true })
const button = (region) => region.getByRole('button', { name: 'Download CSV', exact: true })
/** Download CSV's line: the status its button names. */
const line = (region) => region.getByRole('status', { name: 'Download CSV', exact: true })
/** The grid's own line: the section's first status with no name. */
const gridLine = (region) => region.getByRole('status', { name: /^$/ }).first()

/** Download CSV pressed from the keyboard: focused, then Enter, as journey.mjs presses Save and for its reason. */
async function press(page, region) {
  await button(region).focus()
  await page.keyboard.press('Enter')
}

/** Until the line says `text`. */
const saying = (region, text) => until(async () => (await line(region).textContent()) === text, `Download CSV's line never said "${text}"`)

/** What Playwright's download event gave: the name the browser saved it under, and its bytes, or why it failed. */
async function downloaded(download) {
  const failure = await download.failure()
  if (failure !== null) return { name: download.suggestedFilename(), bytes: null, failure }
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks), failure: null }
}

/**
 * A file the page made, held to the server's: its name, its byte-order
 * mark, and every byte the server answers the gate's clerk with for the
 * body the page sent -- the same rows, since nothing writes between them.
 * One name per check in every browser (0058).
 */
async function heldToTheServer({ plane, check }, what, formId, body, file) {
  check(`${what}: the browser saved a download`, file.failure === null ? null : `the download failed: ${file.failure}`)
  check(`${what}: saved under its form's id and .csv`, file.name === `${formId}.csv` ? null : `it was saved as ${file.name}`)
  const bom = file.bytes?.subarray(0, 3).toString('hex')
  check(`${what}: its bytes start with the byte-order mark`, bom === 'efbbbf' ? null : `they start with ${String(bom)}`)
  const reply = await plane.server.inject({ method: 'POST', url: `/v1/forms/${formId}/records/export`, headers: { authorization: `Bearer ${TOKENS.clerk}`, 'content-type': 'application/json' }, payload: body ?? '{}' })
  const same = reply.statusCode === 200 && file.bytes !== null && reply.rawPayload.equals(file.bytes)
  check(`${what}: every byte the server's`, same ? null : `the server answered ${String(reply.statusCode)} with ${String(reply.rawPayload.length)} bytes; the download has ${String(file.bytes?.length)}`)
}

/** Nothing of the save is left in the document: the anchor is taken out once clicked. A DOM read: an anchor with no text has no role or name to find it by. */
const anchorsLeft = (page) => page.evaluate(() => document.querySelectorAll('a[download]').length)

/** The states, in order; `run` holds this width's record, which has lines. */
export function exportJourney(plane, { check }, run) {
  /** The export the page sent in 'A file in the making', held until 'A file made'. */
  const held = []
  return [
    ['A file in the making (Records)', async (page) => {
      // Every record: the search a delete's states left is cleared first.
      await records(page).getByRole('textbox', { name: 'Search' }).fill('')
      await records(page).getByRole('button', { name: 'Search', exact: true }).click()
      await until(async () => /^Rows 1–/.test((await gridLine(records(page)).textContent()) ?? ''), 'the cleared search never listed the records')
      await page.route(EXPORTS, (route) => void held.push(route))
      await press(page, records(page))
      await saying(records(page), `Making ${FORM}.csv.`)
      check('a file in the making: Download CSV is aria-disabled', (await button(records(page)).getAttribute('aria-disabled')) === 'true' ? null : 'it is not')
      check('a file in the making: the keyboard stays on Download CSV', await focusedOn(page, button(records(page))))
      // Pressed again, by both keys: nothing sent. Two frames, by when a press would have been sent.
      await page.keyboard.press('Enter')
      await page.keyboard.press('Space')
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      check('a file in the making: pressing again sends nothing', held.length === 1 ? null : `${String(held.length)} requests were sent`)
    }],
    ['A file made (Records)', async (page) => {
      const [request] = held
      if (request === undefined) throw new Error('no export was held')
      const waiting = page.waitForEvent('download', WITHIN)
      const body = request.request().postData()
      await request.continue()
      await page.unroute(EXPORTS)
      const file = await downloaded(await waiting)
      await heldToTheServer({ plane, check }, 'a file made', FORM, body, file)
      await saying(records(page), `Made ${FORM}.csv; your browser saves it.`)
      check('a file made: Download CSV can be pressed again', (await button(records(page)).getAttribute('aria-disabled')) === null ? null : 'it is still aria-disabled')
      check('a file made: no anchor of it is left in the document', (await anchorsLeft(page)) === 0 ? null : 'an <a download> is still there')
    }],
    ['A file refused (Records)', async (page) => {
      // The export answered by the real server with its database out of reach.
      await page.route(EXPORTS, async (route) => {
        plane.refuseNext()
        await route.continue()
      })
      try {
        await press(page, records(page))
        await saying(records(page), 'The database cannot be reached. Nothing was saved.')
      } finally {
        await page.unroute(EXPORTS)
      }
      check('a file refused: the keyboard stays on Download CSV, which can be pressed again', (await focusedOn(page, button(records(page)))) ?? ((await button(records(page)).getAttribute('aria-disabled')) === null ? null : 'it is still aria-disabled'))
    }],
    ["A line's file made", async (page) => {
      const row = page.getByRole('grid', { name: 'Records', exact: true }).getByRole('row').filter({ has: page.getByRole('gridcell', { name: run.record.slice(3), exact: true }) }).first()
      await row.getByRole('gridcell').first().focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { level: 3, name: `Order ${run.record}` }).waitFor(WITHIN)
      // Two of its lines are plane.order's; 'An order line alone, created' may have added one.
      await until(async () => /^Order line rows 1–\d+\./.test((await gridLine(lines(page)).textContent()) ?? ''), `the lines of ${run.record} were never listed`)
      const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`/v1/forms/${LINES}/records/export`), WITHIN)
      const waiting = page.waitForEvent('download', WITHIN)
      await press(page, lines(page))
      const body = (await sent).postData()
      check("a line's file: the request names its order as the parent", JSON.parse(body ?? '{}').parent?.record === run.record ? null : `it sent ${String(body)}`)
      await heldToTheServer({ plane, check }, "a line's file made", LINES, body, await downloaded(await waiting))
      await saying(lines(page), `Made ${LINES}.csv; your browser saves it.`)
      check("a line's file made: the keyboard stays on its Download CSV", await focusedOn(page, button(lines(page))))
    }],
  ]
}
