// What a browser gate found, kept for the release report (0035), per browser.
//
// Each apps/*/scripts/browser-test.mjs hands its run to `recordedPerBrowser`,
// which runs it once for each browser the gates run in (scripts/browsers.mjs),
// in turn, each with a recorder of its own and a file of its own,
// `test-results/browser-<browser>.json`. The helper loads Playwright through
// the app's own `load` -- so `import('playwright')` stays in the app's
// script -- launches with the gates' options, records what the browser said
// it was, and decides whether the run failed: a check that failed fails it,
// whether or not the app's run threw.
//
// The gate prints its checks as it always has -- `ok` or `FAIL` and the
// problem -- through `check`, and the recorder keeps each by name under the
// pass it was made in, the failed sentences, the axe it ran and what it
// measured on the way. Each browser's file is written however its run ends,
// with the error that ended it: a gate that left nothing would look, to the
// report, like a gate that was never run, and that is a different problem.
//
// A measurement is an observation on whatever machine ran the gate -- on CI a
// shared runner -- and the report shows it as that, never as a performance
// figure (0034).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserName, gateBrowsers, installCommand, LAUNCH_OPTIONS, launchedBuild, pwdebugOf, ranIn } from '../browsers.mjs'

/** The sentence a run whose checks failed ends with, in its log and its file. */
const checksFailed = (failures) => `${String(failures.length)} browser check(s) failed:\n  ${failures.join('\n  ')}`

/** A recorder for the gate of `gate`, the app's directory (`apps/host`), in `browser` (`chromium`); `env` is where the launch reads PWDEBUG. */
export function gateRecorder(gate, { browser: asked, log = console.log, now = () => new Date(), env = process.env }) {
  const startedAt = now().toISOString()
  const failed = []
  const measurements = []
  const made = []
  let ok = 0
  let browser = null
  let axe = null
  let error = null
  let environment = null

  return {
    /** The browser this recorder's run was asked for, by Playwright's name: what a gate holds 0058's facts to. */
    asked,
    /** One check: `problem` null when it holds, a sentence when it does not. Printed as the gates always printed, and kept by name under the current pass. */
    check(name, problem) {
      if (made.length === 0) made.push({ label: null, width: null, checks: [] })
      made.at(-1).checks.push(name)
      if (problem === null) {
        ok += 1
        log(`  ok    ${name}`)
        return
      }
      log(`  FAIL  ${name}\n          ${problem}`)
      failed.push(`${name}: ${problem}`)
    },
    /** A number observed on this machine, kept with its unit. */
    measure({ name, value, unit }) {
      measurements.push({ name, value, unit })
      log(`  measured: ${name}: ${String(Math.round(value * 100) / 100)} ${unit}`)
    },
    /**
     * The browser launched, as it names itself -- the version the report
     * holds to Playwright's pin -- with the options it was launched with and
     * PWDEBUG, from which the report tells the build it started
     * (launchedBuild), and the platform it ran on. Throws when it is not the
     * browser asked for.
     */
    launched(instance, options) {
      const name = instance.browserType().name()
      browser = {
        name,
        version: instance.version(),
        headless: options.headless,
        options: { ...options },
        pwdebug: pwdebugOf(env),
        platform: process.platform,
        arch: process.arch,
      }
      if (name !== asked) {
        error = `${gate} asked for ${asked}, and the launch gave ${name} ${browser.version}`
        throw new Error(error)
      }
    },
    /** What the browser said it was, and the system it ran on (scripts/browser-gate.mjs's environmentOf and systemOf), once per run. */
    environment(value) {
      environment = value
    },
    /** Whether the run has recorded what the browser said it was. */
    hasEnvironment() {
      return environment !== null
    },
    /** The axe-core version injected into the page, as the page reports it. */
    axe(version) {
      axe = version ?? null
    },
    /** One pass of the gate, at a viewport width: the checks after it are kept under it. */
    pass({ label, width }) {
      made.push({ label, width, checks: [] })
    },
    /** The failed checks so far, as sentences. */
    failures() {
      return [...failed]
    },
    /** What ended the gate early, if anything did. */
    error(thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    },
    /** Writes `<dir>/test-results/browser-<browser>.json` and returns what it wrote. */
    write(dir = process.cwd()) {
      const passes = made.filter((entry) => entry.width !== null)
      const result = {
        gate,
        asked,
        startedAt,
        finishedAt: now().toISOString(),
        browser,
        environment,
        axe,
        widths: [...new Set(passes.map((entry) => entry.width))],
        passes: passes.length,
        made: made.map((entry) => ({ ...entry, checks: [...entry.checks] })),
        checks: { ok, failed: [...failed] },
        measurements,
        ...(error === null ? {} : { error }),
      }
      mkdirSync(join(dir, 'test-results'), { recursive: true })
      writeFileSync(join(dir, 'test-results', `browser-${asked}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
      return result
    },
  }
}

/**
 * Runs the gate of `app` once per browser of `browsers`, in turn: loads
 * Playwright through `load()`, whose own error says what to do when the
 * package is missing; launches each browser with LAUNCH_OPTIONS, naming the
 * command that downloads it when it will not start; hands `run(gate,
 * instance)` a recorder and the browser; fails the browser when a check
 * failed, whether or not `run` threw; closes the browser, and writes that
 * browser's file however the run ends. Throws at the end, naming every
 * browser whose run failed, so that one browser's failure does not hide the
 * next's answer; and before anything, for no browser at all.
 */
export async function recordedPerBrowser(app, { load, run, env = process.env, browsers = gateBrowsers({ env }), dir = process.cwd(), log = console.log, now }) {
  if (browsers.length === 0) throw new Error(`the browser gate of ${app} was given no browser to run in, and a gate run in none measures nothing`)
  log(ranIn(browsers, { env }))
  const failed = []
  for (const asked of browsers) {
    const gate = gateRecorder(app, { browser: asked, log, env, ...(now === undefined ? {} : { now }) })
    const options = { ...LAUNCH_OPTIONS }
    let instance = null
    try {
      const playwright = await load()
      try {
        instance = await playwright[asked].launch(options)
      } catch (error) {
        throw new Error(`could not launch ${browserName(asked)} (${String(error)}).\nIf this machine does not have it, run \`${installCommand(asked)}\`.`, {
          cause: error,
        })
      }
      log(`\n${browserName(asked)} ${instance.version()}, ${launchedBuild({ name: asked, options, pwdebug: pwdebugOf(env) }).how}`)
      gate.launched(instance, options)
      await run(gate, instance)
      const failures = gate.failures()
      if (failures.length > 0) throw new Error(checksFailed(failures))
    } catch (thrown) {
      gate.error(thrown)
      failed.push(`${browserName(asked)}:\n  ${thrown instanceof Error ? thrown.message : String(thrown)}`)
    } finally {
      try {
        await instance?.close()
      } catch (error) {
        log(`  could not close ${browserName(asked)}: ${String(error)}`)
      }
      gate.write(dir)
    }
  }
  if (failed.length > 0) throw new Error(`the browser gate of ${app} failed in ${failed.join('\nand in ')}`)
}
