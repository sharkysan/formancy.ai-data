import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { BROWSERS, gateBrowsers, launchedBuild, ranIn, VARIABLE } from './browsers.mjs'
import { readWorkflow } from './release-report/workflows.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The browsers the gates run in, and how a gate is told which: held to the
 * gates workflow, which runs one leg of the browser job per browser, and to
 * FORMANCY_BROWSERS, which narrows a run on a machine and never widens one
 * past what the report can hold to a pin.
 */

describe('BROWSERS', () => {
  // The report expects a result from every browser of BROWSERS, and CI
  // produces one per leg of the browser job's matrix. A browser in one and
  // not the other is a leg whose results the report reads as missing, or a
  // browser the report requires that no job ever runs.
  test('is the browser job’s matrix, in its order', () => {
    expect(readWorkflow().jobs.browser.strategy.matrix.browser).toEqual([...BROWSERS])
  })
})

describe('gateBrowsers', () => {
  const two = ['chromium', 'firefox']

  // The user's decision: on a machine, a gate runs Chromium alone unless the
  // variable names more, and CI names each leg's browser. Widened to every
  // browser by default, a laptop would start one PostgreSQL per browser for
  // the host gate unasked.
  test('runs Chromium alone when FORMANCY_BROWSERS is unset, and every browser for `all`', () => {
    expect(gateBrowsers({ env: {} })).toEqual(['chromium'])
    expect(gateBrowsers({ env: {}, browsers: two })).toEqual(['chromium'])
    expect(gateBrowsers({ env: { FORMANCY_BROWSERS: 'all' }, browsers: two })).toEqual(two)
    expect(gateBrowsers({ env: { FORMANCY_BROWSERS: 'all' } })).toEqual([...BROWSERS])
    expect(gateBrowsers({ env: { FORMANCY_BROWSERS: ' firefox , chromium ' }, browsers: two })).toEqual(['firefox', 'chromium'])
  })

  // A name the gates do not run in would launch a browser no pin holds, or
  // fail deep inside Playwright; an empty value is a leg whose matrix value
  // went missing, which must not quietly run the default; a repeat runs one
  // browser twice and overwrites its own results.
  test('refuses an unknown browser, an empty list, a repeat and `all` among names', () => {
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'opera' } })).toThrow('FORMANCY_BROWSERS names opera, which is no browser the gates run in: chromium')
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'firefox' } })).toThrow(/names firefox, which is no browser the gates run in/)
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: '' } })).toThrow('FORMANCY_BROWSERS is set and names no browser: unset it for Chromium alone, or name the browsers (chromium), or all')
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: ' , ' } })).toThrow(/names no browser/)
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'chromium,chromium' } })).toThrow('FORMANCY_BROWSERS names chromium twice')
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'all,chromium' }, browsers: two })).toThrow('FORMANCY_BROWSERS names all beside a browser: all stands alone')
  })

  // A gate handed no browser loops over nothing and exits green, having
  // measured nothing: a list of browsers without Chromium, with the
  // variable unset, would turn every local `pnpm test:browser` into that.
  test('refuses to leave a gate no browser to run in', () => {
    expect(() => gateBrowsers({ env: {}, browsers: ['firefox', 'webkit'] })).toThrow('FORMANCY_BROWSERS is unset, which runs Chromium alone, and Chromium is no browser the gates run in: name one of firefox, webkit')
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'all' }, browsers: [] })).toThrow('FORMANCY_BROWSERS=all names no browser: the gates run in none')
  })
})

describe('FORMANCY_BROWSERS through turbo', () => {
  // turbo runs test:browser in strict mode, where a variable it is not told
  // to pass never reaches the gate: CI's leg would then run the machine's
  // default, and the leg of any browser but Chromium would measure
  // Chromium under its name.
  test('reaches the gates: turbo.json passes it to test:browser', () => {
    const turbo = JSON.parse(readFileSync(join(repo, 'turbo.json'), 'utf8'))
    expect(turbo.tasks['test:browser'].passThroughEnv ?? []).toContain(VARIABLE)
  })
})

describe('launchedBuild', () => {
  // Playwright 1.63.0 pins the headless shell and the full Chromium at one
  // version, so a version alone cannot tell them apart: a gate launched
  // headed, on a channel, from an executable of its own or under PWDEBUG,
  // which makes Playwright launch headed, starts another build than the
  // one it is held to. What a launch starts is read from its options, as
  // Playwright reads them.
  test('says which build of Playwright’s a launch started, from its options', () => {
    expect(launchedBuild({ name: 'chromium', options: { headless: true } })).toEqual({ build: 'chromium-headless-shell', how: 'headless' })
    expect(launchedBuild({ name: 'chromium', options: {} })).toEqual({ build: 'chromium-headless-shell', how: 'headless' })
    expect(launchedBuild({ name: 'chromium', options: { headless: false } })).toEqual({ build: 'chromium', how: 'headed' })
    expect(launchedBuild({ name: 'chromium', options: { headless: true }, pwdebug: '1' })).toEqual({ build: 'chromium', how: 'headed, as PWDEBUG=1 makes it' })
    expect(launchedBuild({ name: 'chromium', options: { headless: true }, pwdebug: 'console' })).toEqual({ build: 'chromium-headless-shell', how: 'headless' })
    expect(launchedBuild({ name: 'chromium', options: { headless: true, channel: 'chromium' } })).toEqual({ build: null, how: 'on its chromium channel' })
    expect(launchedBuild({ name: 'chromium', options: { headless: true, executablePath: '/opt/chrome' } })).toEqual({ build: null, how: 'from /opt/chrome' })
    expect(launchedBuild({ name: 'firefox', options: { headless: true } })).toEqual({ build: 'firefox', how: 'headless' })
  })
})

describe('ranIn', () => {
  // A person who ran `pnpm test:browser` with nothing set must not read a
  // green run as every browser's: the gate says which ran, and how to run
  // the others.
  test('says which browsers a run measured, and with the variable unset how to run every one', () => {
    expect(ranIn(['chromium'], { env: {}, browsers: ['chromium', 'firefox'] })).toBe(
      'In Chromium: FORMANCY_BROWSERS is unset, which on a machine runs Chromium alone; FORMANCY_BROWSERS=all runs Chromium and Firefox, as CI does.',
    )
    expect(ranIn(['firefox'], { env: { FORMANCY_BROWSERS: 'firefox' }, browsers: ['chromium', 'firefox'] })).toBe('In Firefox, as FORMANCY_BROWSERS=firefox asks.')
  })
})
