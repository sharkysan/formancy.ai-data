// One app's README pictures, walked (0038): the arguments an app's script
// takes, a browser opened with the camera's settings, the app's acts run in
// walk order, and at each scene what the mode asks for -- the text read and
// compared, or the picture taken -- then the record written, or what the
// check found said.
//
// The three apps' apps/<app>/scripts/pictures.mjs hold their plane, their
// routing and one act per scene. This holds what they would otherwise each
// decide again: which scene is shot, that --check aborts the fonts and shoots
// nothing, that nothing is written until every scene of the walk has passed,
// and what each record entry says. Node built-ins only; the app passes in its
// own Playwright.
//
//   node scripts/pictures.mjs                walk every scene; retake those whose text changed, or that have no record or no picture
//   node scripts/pictures.mjs --all          retake every scene of the app
//   node scripts/pictures.mjs --scene <id>   retake those scenes (repeatable)
//   node scripts/pictures.mjs --check        walk every scene, compare each part's text with the record, write nothing
//   node scripts/pictures.mjs --review <dir> also write each new picture, decoded to PNG, into <dir> outside the repository

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../pictures.mjs'
import * as camera from './camera.mjs'
import { announce, checkProblems, entry, IMAGES, lineDiff, pairingProblems, pictureOf, readRecord, readScenes, REPO, stylesheetNotices, withEntry, writeRecord } from './record.mjs'

/** The root runner's arguments, for one app: no --app, and no scene of another app. */
export function appOptions(argv, scenes, app) {
  const script = `apps/${app}/scripts/pictures.mjs`
  if (argv.includes('--app')) throw new Error(`--app is the root runner's option: ${script} takes its own scenes only`)
  const options = parse(argv, scenes)
  for (const id of options.scenes) {
    const { app: other } = scenes.find((scene) => scene.id === id)
    if (other !== app) throw new Error(`--scene ${id} is a ${other} scene, and this is ${script}`)
  }
  return options
}

/**
 * Why scene `id` is shot in this run, or undefined when it is not: what
 * --all and --scene name; by default, a scene whose text is not the
 * record's, or that has no record, no picture, or a picture other than the
 * one its record describes; under --check, none.
 */
export function reasonToShoot({ options, id, record, text, picture }) {
  if (options.check) return undefined
  if (options.all) return '--all'
  if (options.scenes.length > 0) return options.scenes.includes(id) ? '--scene' : undefined
  const recorded = record[id]
  if (recorded === undefined) return 'it has no record'
  if (picture === undefined) return 'it has no picture'
  if (picture.length !== recorded.bytes || camera.digest(picture) !== recorded.sha256) return 'its picture is not the one its record describes'
  if (JSON.stringify(recorded.text) !== JSON.stringify(text)) return 'its text changed'
  return undefined
}

/**
 * What the log says of scene `id` when reasonToShoot gave no reason to shoot
 * it. Under --scene a scene not named was walked and its text read, so it is
 * compared and said either way -- never retaken, since --scene shoots only
 * what it names; by default only a scene whose text is the record's is left.
 */
export function notShot({ options, id, record, text }) {
  if (options.check) return 'walked'
  if (options.scenes.length === 0) return "its text is the record's, so it is not retaken"
  if (JSON.stringify(record[id]?.text) === JSON.stringify(text)) return "not named by --scene; its text is the record's"
  return `not named by --scene, and its text is not the record's: \`pnpm pictures --scene ${id}\` retakes it`
}

/**
 * Waits until `locator`'s accessibility snapshot matches `pattern`, polling
 * it: how an act waits for a state, since it reads the tree the record holds
 * and never a CSS selector. Refuses after `within` ms with what it last said.
 */
export async function untilSnapshot(locator, pattern, { within, what }) {
  const deadline = Date.now() + within
  for (;;) {
    const said = await locator.ariaSnapshot({ timeout: within }).catch(() => '')
    if (pattern.test(said)) return said
    if (Date.now() > deadline) throw new Error(`${what} never came: after ${String(within)} ms its part said\n${said.slice(0, 1500)}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** A field's accessible name as the renderers give it: its label, with the required marker `*` where the field is required. */
export const field = (label) => new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`)

/**
 * `error`'s message with every one of `secrets` taken out: what an app script
 * prints when it fails, since a Playwright message can quote what an action
 * was given and a driver's can quote where it connected.
 */
export function said(error, secrets) {
  const message = error instanceof Error ? error.message : String(error)
  return secrets.filter((secret) => secret !== '').reduce((text, secret) => text.replaceAll(secret, '[a secret]'), message)
}

/**
 * The renderers search a lookup DEBOUNCE_MS after its text changes -- 250 in
 * @formancy/react and @formancy/angular, at 0.3.0 and at 0.4.0, with no minimum
 * length, so a Load that fills a lookup starts one -- and mark its box
 * `aria-busy="true"` while the answer is out (react dist/index.mjs, the
 * typeahead's input; angular fesm2022, both lookup boxes), when they also say
 * "Searching…".
 * Measured: a --check read the host page's Angular pane with "Searching…" in
 * it, which its picture did not show; with every lookup answer delayed by a
 * second, the host's check failed without this wait -- on host-stale in each
 * of two runs, and on host-refused too in one -- and passed with it
 * (2026-10-10). So after every act no element in the parts may have been
 * busy for a window longer than the debounce: a search still to start starts
 * inside the window, and one under way is seen.
 *
 * A DOM read, the one this file makes: `aria-busy` is the state, and the
 * accessibility snapshot does not carry it. The wording is not read, because
 * an upstream reword of "Searching…" makes a wait on it a silent no-op.
 * Measured, with every lookup answer a second late (2026-10-10): a wait on
 * the wording reworded let host-stale and host-refused be read with
 * "Searching…" in them, and the check went red; on `aria-busy` it was green
 * in each of two runs.
 */
const QUIET_MS = 2 * 250

async function quiet(page, parts, within) {
  const deadline = Date.now() + within
  let since = Date.now()
  for (;;) {
    const busy = await Promise.all(Object.values(parts).map((part) => part.locator('[aria-busy="true"]').count()))
    if (busy.some((count) => count > 0)) since = Date.now()
    else if (Date.now() - since >= QUIET_MS) return
    if (Date.now() > deadline) throw new Error(`a lookup was still being searched after ${String(within)} ms`)
    await page.waitForTimeout(50)
  }
}

/** Today, as captured.json dates a picture: the UTC date, which the record's dates are compared in. */
const today = () => new Date().toISOString().slice(0, 10)

/** Every request to Google Fonts, refused: --check compares text, which does not depend on fonts, and must not depend on Google. */
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//

/**
 * Walks `config.app`'s scenes and does what `argv` asks (see the header).
 *
 * `config`:
 *   - `app`, and its `chromium` and `playwright` (the installed version);
 *   - `width`, refused at or below `css`'s widest breakpoint; `css` is
 *     `{ directory, entry }`, the stylesheet as the app's gate inlines it,
 *     and `themes` the `@formancy/themes` version the app pins -- the two
 *     the stylesheet notice is about;
 *   - `origin`, `dist` and `inject`: where the page is served from and what
 *     answers `/v1/`;
 *   - `within`: how long the page may take to arrive, the app's gate's own
 *     bound, which the font wait also takes;
 *   - `secrets`: every token, password and connection URL the plane holds;
 *   - `database`: what the pictures were taken over, or a function that
 *     asks it;
 *   - `open(page)`: from a blank page to where the first act starts;
 *   - `acts`: `{ <scene id>: async (page, scene) => ({ parts, keepFocus }) }`,
 *     in walk order. An act reaches its state by role and name, asserts its
 *     holds, and returns its parts as locators.
 */
export async function pictures(config, argv = process.argv.slice(2)) {
  const { app, chromium, playwright, width, css, themes, origin, dist, inject, within, secrets, acts } = config
  const scenes = readScenes()
  const options = appOptions(argv, scenes, app)
  const actIds = Object.keys(acts)
  // Before the walk, so an act is never run without the scene it reads its step from.
  const unpaired = pairingProblems({ app, scenes, actIds })
  if (unpaired.length > 0) throw new Error(unpaired.join('\n'))
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no built page at apps/${app}/dist: run \`pnpm build\` first`)

  const record = readRecord()
  const sheet = camera.stylesheet(css.directory, css.entry)
  const breakpoint = camera.widestBreakpoint(sheet, css.entry)
  const stylesheet = `sha256 ${camera.digest(sheet)} of src/${css.entry} with its imports, and @formancy/themes ${themes}`
  const families = camera.families(readFileSync(join(dist, 'index.html'), 'utf8'))

  const browser = await chromium.launch()
  let context
  let page
  try {
    context = await camera.context(browser, { width, breakpoint })
    if (options.check) await context.route(FONTS, (route) => route.abort())
    await camera.serve(context, { origin, dist, inject })
    page = await context.newPage()
    page.setDefaultTimeout(within)
    await config.open(page)

    const running = {}
    const shots = {}
    for (const [id, act] of Object.entries(acts)) {
      const scene = scenes.find((candidate) => candidate.id === id)
      let reached
      try {
        reached = await act(page, scene)
      } catch (error) {
        // Named, since the scene that fails is the picture whose caption no longer holds.
        throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
      const { parts, keepFocus = false } = reached
      await quiet(page, parts, within)
      // Still first, in every mode: a blur can change what a field says, and
      // a capture's text and a check's must be read in the same state.
      await camera.still(page, { keepFocus })
      running[id] = await camera.text(parts, { scene: id, secrets })
      const file = join(REPO, pictureOf(id))
      const reason = reasonToShoot({ options, id, record, text: running[id], picture: existsSync(file) ? readFileSync(file) : undefined })
      if (reason === undefined) {
        console.log(`  ${id}: ${notShot({ options, id, record, text: running[id] })}`)
        // The clip measured and its intrusion check run in --check too: text a
        // change draws between or over the parts, outside them all, would
        // otherwise pass every check while the picture no longer shows the page.
        if (options.check) await camera.clip(page, parts, { scene: id, secrets })
        continue
      }
      shots[id] = await camera.take(page, parts, { scene: id, families, within, secrets, keepFocus })
      // The text read before the shot is what --check reads; the text after
      // it is what the record keeps. Two that differ mean the act does not
      // wait for the state it pictures, and a check would compare a moment.
      if (JSON.stringify(shots[id].text) !== JSON.stringify(running[id])) {
        const changed = Object.keys(running[id]).filter((part) => shots[id].text[part] !== running[id][part])
        const diffs = changed.map((part) => `  ${part}:\n    ${lineDiff(running[id][part], shots[id].text[part]).join('\n    ')}`)
        throw new Error(`${id}: ${changed.join(', ')} said something else after the picture was taken than before it, so the act does not wait for the state it pictures:\n${diffs.join('\n')}`)
      }
      console.log(`  ${id}: shot (${reason}), ${String(shots[id].clip.width)}x${String(shots[id].clip.height)} CSS px, settled in ${String(shots[id].shots)} shots`)
    }

    if (options.check) {
      announce(stylesheetNotices({ app, scenes, record, stylesheet }))
      const problems = checkProblems({ app, scenes, record, actIds, running, playwright })
      if (problems.length > 0) throw new Error(`the ${app} pictures no longer show what the page shows:\n  ${problems.join('\n  ')}`)
      const count = Object.keys(running).length
      console.log(`${app}: every part of ${String(count)} ${count === 1 ? 'scene' : 'scenes'} says what its picture was recorded saying`)
      return
    }

    const database = typeof config.database === 'function' ? await config.database() : config.database
    const settings = { ...camera.SETTINGS, width }
    const captured = today()
    let next = record
    const written = {}
    for (const [id, shot] of Object.entries(shots)) {
      const picture = await camera.webp(browser, shot.png)
      if (options.review !== undefined) {
        mkdirSync(options.review, { recursive: true })
        writeFileSync(join(options.review, `${id}.png`), await camera.decodedPng(browser, picture))
      }
      const look = camera.look(browser, { playwright, fonts: shot.fonts })
      // withEntry refuses a misquoting caption and another look before anything is written.
      next = withEntry(next, scenes, id, entry(id, { captured, settings, clip: shot.clip, picture, look, database, stylesheet, text: shot.text }))
      written[id] = picture
    }
    if (Object.keys(written).length === 0) return
    mkdirSync(IMAGES, { recursive: true })
    for (const [id, picture] of Object.entries(written)) writeFileSync(join(REPO, pictureOf(id)), picture)
    writeRecord(next, scenes)
    console.log(`${app}: wrote ${Object.keys(written).join(', ')}${options.review === undefined ? '' : `, and each decoded to PNG in ${options.review}`}`)
  } finally {
    // A request still in its route handler when the walk ends -- a lookup's
    // debounced search -- threw once the browser or the server it awaited was
    // closed (`request.allHeaders` on a closed page, `inject` on a closed
    // server), and the throw ended the process after the check had passed.
    // Measured with every lookup answered a second late, host --check: exit 1
    // in 2 of 2 runs without these two lines, 0 in 2 of 2 with them
    // (2026-10-10). Nothing is answered once the walk is over.
    await page?.unrouteAll({ behavior: 'ignoreErrors' })
    await context?.unrouteAll({ behavior: 'ignoreErrors' })
    await browser.close()
  }
}
