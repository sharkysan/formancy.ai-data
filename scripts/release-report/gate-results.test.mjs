import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { installCommand } from '../browsers.mjs'
import { gateRecorder, recordedPerBrowser } from './gate-results.mjs'

/**
 * The browser gates' recorder (0035): what each gate leaves for the release
 * report, per browser, in a temporary directory, with a browser that is
 * three functions.
 */
let dirs = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'formancy-data-gate-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

const read = (dir, browser) => JSON.parse(readFileSync(join(dir, 'test-results', `browser-${browser}.json`), 'utf8'))

/** A launched browser as the recorder sees it: its type's name, its version, and a close that is counted. */
const instance = (name, version, closed = []) => ({ browserType: () => ({ name: () => name }), version: () => version, close: async () => void closed.push(name) })
const quiet = () => {}
/** Playwright as `load` gives it, whose browser types launch through `launch(name, options)`. */
const playwright = (launch) => async () => Object.fromEntries(['chromium', 'firefox', 'webkit'].map((name) => [name, { launch: (options) => launch(name, options) }]))

describe('a browser gate’s results', () => {
  // The report holds the browser to Playwright's pin and counts the checks;
  // a recorder that dropped a failed sentence would turn a red gate green in
  // the report while the log said FAIL. And each browser's run writes a file
  // of its own: under one name for every browser, a second browser's run
  // would overwrite the first's before the report could read it.
  test('keep every check, the browser as it names itself, axe, the widths and what was measured, in a file of its browser', () => {
    const lines = []
    const gate = gateRecorder('apps/examples', { browser: 'chromium', log: (line) => lines.push(line) })
    gate.launched(instance('chromium', '153.0.8010.12'), { headless: true })
    gate.axe('4.14.0')
    gate.pass({ label: 'reflow, 320', width: 320 })
    gate.pass({ label: 'reflow, 320, web fonts refused', width: 320 })
    gate.pass({ label: 'laptop, 1440', width: 1440 })
    gate.check('the page does not scroll sideways', null)
    gate.check('the first Tab reaches the skip link', 'focus went somewhere else first')
    gate.measure({ name: 'Chromium resent the create after its connection closed', value: 12.345, unit: 'ms' })
    const dir = scratch()
    const written = gate.write(dir)
    expect(readdirSync(join(dir, 'test-results'))).toEqual(['browser-chromium.json'])
    expect(read(dir, 'chromium')).toEqual(written)
    expect(written).toMatchObject({
      gate: 'apps/examples',
      asked: 'chromium',
      browser: { name: 'chromium', version: '153.0.8010.12', headless: true, options: { headless: true }, platform: process.platform, arch: process.arch },
      axe: '4.14.0',
      widths: [320, 1440],
      passes: 3,
      checks: { ok: 1, failed: ['the first Tab reaches the skip link: focus went somewhere else first'] },
      measurements: [{ name: 'Chromium resent the create after its connection closed', value: 12.345, unit: 'ms' }],
    })
    expect(written).not.toHaveProperty('error')
    expect(lines).toContain('  ok    the page does not scroll sideways')
    expect(lines).toContain('  FAIL  the first Tab reaches the skip link\n          focus went somewhere else first')
    expect(gate.failures()).toEqual(written.checks.failed)
  })

  // "Headless" written as a constant says headless of a run that was not;
  // what is recorded is what the browser was launched with.
  test('say headless as the browser was launched', () => {
    const gate = gateRecorder('apps/host', { browser: 'chromium', log: quiet })
    gate.launched(instance('chromium', '153.0.8010.12'), { headless: false })
    expect(gate.write(scratch()).browser).toMatchObject({ headless: false, options: { headless: false } })
  })

  // PWDEBUG makes Playwright launch Chromium headed whatever the options
  // say, which starts the full browser and not the headless shell it is
  // pinned as: the options alone would say headless of a headed run.
  // Playwright reads it as npm's config too, so `pwdebug=1` in an .npmrc,
  // which pnpm hands a script as npm_config_pwdebug, launches headed with
  // PWDEBUG itself unset.
  test('keep PWDEBUG as the launch met it, wherever Playwright reads it from', () => {
    const debugged = (env) => {
      const gate = gateRecorder('apps/host', { browser: 'chromium', log: quiet, env })
      gate.launched(instance('chromium', '153.0.8010.12'), { headless: true })
      return gate.write(scratch()).browser
    }
    expect(debugged({ PWDEBUG: '1' })).toMatchObject({ headless: true, pwdebug: '1' })
    expect(debugged({ npm_config_pwdebug: '1' })).toMatchObject({ pwdebug: '1' })
    expect(debugged({ npm_package_config_pwdebug: 'inspector' })).toMatchObject({ pwdebug: 'inspector' })
    expect(debugged({ PWDEBUG: '0', npm_config_pwdebug: '1' })).toMatchObject({ pwdebug: '0' })
    expect(debugged({})).toMatchObject({ pwdebug: null })
  })

  // A launcher that started another browser than the one asked for -- a
  // typo in a gate's launch, a Playwright that maps a name elsewhere -- would
  // leave Firefox's checks in Chromium's file, and the report would hold
  // them to Chromium's pin.
  test('are an error when the browser launched is not the one asked for', () => {
    const gate = gateRecorder('apps/studio', { browser: 'chromium', log: quiet })
    expect(() => gate.launched(instance('firefox', '155.0'), { headless: true })).toThrow('apps/studio asked for chromium, and the launch gave firefox 155.0')
    expect(gate.write(scratch())).toMatchObject({ asked: 'chromium', browser: { name: 'firefox' }, error: 'apps/studio asked for chromium, and the launch gave firefox 155.0' })
  })

  // Totals say how many checks passed, not which: a browser that skipped one
  // check and made another would count the same. Each check is kept by name
  // under the pass it was made in, so the report can compare them.
  test('keep each check by name under the pass it was made in, and the ones before any pass under a pass without a width', () => {
    const gate = gateRecorder('apps/host', { browser: 'chromium', log: quiet })
    gate.check('the stylesheet’s widths are read', null)
    gate.pass({ label: 'laptop, 1440', width: 1440 })
    gate.check('signed out: no sideways scroll', null)
    gate.check('the first Tab reaches the skip link', 'it went elsewhere')
    expect(gate.write(scratch())).toMatchObject({
      made: [
        { label: null, width: null, checks: ['the stylesheet’s widths are read'] },
        { label: 'laptop, 1440', width: 1440, checks: ['signed out: no sideways scroll', 'the first Tab reaches the skip link'] },
      ],
      widths: [1440],
      passes: 1,
    })
  })
})

describe('a gate run once per browser', () => {
  // A gate that threw in one browser and stopped there would leave the next
  // browser unmeasured and, to the report, never run; a local run should
  // show every browser's answer at once. Each browser's file is written
  // however its run ends, with what ended it, each browser is closed, and
  // the gate fails at the end naming every browser that failed.
  test('writes a file per browser, runs the next after one failed, and fails naming each that did', async () => {
    const dir = scratch()
    const closed = []
    const launched = []
    const run = recordedPerBrowser('apps/host', {
      browsers: ['chromium', 'firefox'],
      dir,
      log: quiet,
      load: playwright(async (name, options) => {
        launched.push([name, options])
        return instance(name, name === 'chromium' ? '153.0.8010.12' : '155.0', closed)
      }),
      run: async (gate, browser) => {
        gate.pass({ label: 'reflow, 320', width: 320 })
        gate.check('signed out: no sideways scroll', null)
        if (browser.browserType().name() === 'chromium') throw new Error('1 browser check(s) failed:\n  signed out: no sideways scroll: 12px')
      },
    })
    const error = await run.catch((thrown) => thrown)
    expect(error.message).toBe('the browser gate of apps/host failed in Chromium:\n  1 browser check(s) failed:\n  signed out: no sideways scroll: 12px')
    expect(launched).toEqual([
      ['chromium', { headless: true }],
      ['firefox', { headless: true }],
    ])
    expect(closed).toEqual(['chromium', 'firefox'])
    expect(read(dir, 'chromium')).toMatchObject({ asked: 'chromium', error: '1 browser check(s) failed:\n  signed out: no sideways scroll: 12px', checks: { ok: 1, failed: [] } })
    expect(read(dir, 'firefox')).toMatchObject({ asked: 'firefox', browser: { name: 'firefox', version: '155.0' }, checks: { ok: 1 } })
    expect(read(dir, 'firefox')).not.toHaveProperty('error')
  })

  // A run that recorded a FAIL and returned would pass, the file saying
  // failed and the job green, were the gate's own throw the only thing
  // that turned its failures into a failed run: one gate that forgot it
  // would be green on a machine and in its leg.
  test('fails a browser whose run recorded a failed check and returned', async () => {
    const dir = scratch()
    const error = await recordedPerBrowser('apps/host', {
      browsers: ['chromium'],
      dir,
      log: quiet,
      load: playwright(async (name) => instance(name, '153.0.8010.12')),
      run: async (gate) => {
        gate.pass({ label: 'reflow, 320', width: 320 })
        gate.check('signed out: no sideways scroll', '12px')
      },
    }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('the browser gate of apps/host failed in Chromium:\n  1 browser check(s) failed:\n  signed out: no sideways scroll: 12px')
    expect(read(dir, 'chromium')).toMatchObject({ error: '1 browser check(s) failed:\n  signed out: no sideways scroll: 12px', checks: { ok: 0, failed: ['signed out: no sideways scroll: 12px'] } })
  })

  // A gate handed no browser would loop over nothing and resolve: green,
  // with no file written and nothing measured.
  test('refuses to run in no browser', async () => {
    const error = await recordedPerBrowser('apps/host', { browsers: [], dir: scratch(), log: quiet, load: playwright(async () => null), run: async () => {} }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('the browser gate of apps/host was given no browser to run in, and a gate run in none measures nothing')
  })

  // Without the playwright package there is nothing to download a browser
  // with: the command that downloads one would send the reader to a second
  // failure. That error says what to do in its own words.
  test('says a missing playwright package in its own words, without the command that downloads a browser', async () => {
    const dir = scratch()
    const error = await recordedPerBrowser('apps/examples', {
      browsers: ['chromium'],
      dir,
      log: quiet,
      load: async () => {
        throw new Error('playwright is not installed: run `pnpm install`')
      },
      run: async () => {},
    }).catch((thrown) => thrown)
    expect(error.message).toBe('the browser gate of apps/examples failed in Chromium:\n  playwright is not installed: run `pnpm install`')
    expect(read(dir, 'chromium')).toMatchObject({ browser: null, error: 'playwright is not installed: run `pnpm install`' })
  })

  // A browser that would not launch -- not downloaded on this machine, its
  // libraries missing -- leaves its file, with the command that downloads it.
  test('names the command that installs a browser that would not launch, and every browser that failed', async () => {
    const dir = scratch()
    const error = await recordedPerBrowser('apps/examples', {
      browsers: ['chromium', 'firefox'],
      dir,
      log: quiet,
      load: playwright(async (name) => {
        throw new Error(`browserType.launch: Executable doesn't exist for ${name}`)
      }),
      run: async () => {
        throw new Error('the gate ran without a browser')
      },
    }).catch((thrown) => thrown)
    const chromium = `could not launch Chromium (Error: browserType.launch: Executable doesn't exist for chromium).\nIf this machine does not have it, run \`${installCommand('chromium')}\`.`
    expect(read(dir, 'chromium')).toMatchObject({ asked: 'chromium', browser: null, error: chromium })
    expect(read(dir, 'firefox')).toMatchObject({ asked: 'firefox', browser: null, error: expect.stringContaining(installCommand('firefox')) })
    expect(error.message).toBe(`the browser gate of apps/examples failed in Chromium:\n  ${chromium}\nand in Firefox:\n  ${read(dir, 'firefox').error}`)
  })
})
