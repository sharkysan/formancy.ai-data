// What a browser gate found, kept for the release report (0035).
//
// Each apps/*/scripts/browser-test.mjs prints its checks as it always has --
// `ok` or `FAIL` and the problem -- through `check`, and the recorder keeps
// the count and the failed sentences beside the browser it launched, the axe
// it ran, the widths it measured and what it measured on the way. `write()`
// runs in the gate's `finally`, so a gate that throws still leaves its file,
// with the error: a gate that left nothing would look, to the report, like a
// gate that was never run, and that is a different problem.
//
// A measurement is an observation on whatever machine ran the gate -- on CI a
// shared runner -- and the report shows it as that, never as a performance
// figure (0034).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A recorder for the gate of `gate`, the app's directory (`apps/host`). */
export function gateRecorder(gate, { log = console.log, now = () => new Date() } = {}) {
  const startedAt = now().toISOString()
  const failed = []
  const measurements = []
  const widths = []
  let ok = 0
  let browser = null
  let axe = null
  let error = null

  return {
    /** One check: `problem` null when it holds, a sentence when it does not. Printed as the gates always printed. */
    check(name, problem) {
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
    /** The browser launched, as it names itself: the version the report holds to Playwright's pin. */
    launched(browserType, instance) {
      browser = { name: browserType.name(), version: instance.version(), headless: true }
    },
    /** The axe-core version injected into the page, as the page reports it. */
    axe(version) {
      axe = version ?? null
    },
    /** One pass of the gate at a viewport width. */
    width(pixels) {
      widths.push(pixels)
    },
    /** The failed checks so far, as sentences. */
    failures() {
      return [...failed]
    },
    /** What ended the gate early, if anything did. */
    error(thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    },
    /** Writes `<dir>/test-results/browser.json` and returns what it wrote. */
    write(dir = process.cwd()) {
      const result = {
        gate,
        startedAt,
        finishedAt: now().toISOString(),
        browser,
        axe,
        widths: [...new Set(widths)],
        passes: widths.length,
        checks: { ok, failed: [...failed] },
        measurements,
        ...(error === null ? {} : { error }),
      }
      mkdirSync(join(dir, 'test-results'), { recursive: true })
      writeFileSync(join(dir, 'test-results', 'browser.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
      return result
    },
  }
}

/** Runs `gate` with a recorder for `app`, and writes what it found to `dir` however it ends. */
export async function recorded(app, gate, dir = process.cwd()) {
  const recorder = gateRecorder(app)
  try {
    await gate(recorder)
  } catch (thrown) {
    recorder.error(thrown)
    throw thrown
  } finally {
    recorder.write(dir)
  }
}
