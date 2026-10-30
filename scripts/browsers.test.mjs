import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { BROWSERS, FACTS, gateBrowsers, installCommand, launchedBuild, ranIn, SYSTEM_PACKAGES, VARIABLE } from './browsers.mjs'
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
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'opera' } })).toThrow(
      'FORMANCY_BROWSERS names opera, which is no browser the gates run in: chromium, firefox, webkit',
    )
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'firefox' }, browsers: ['chromium'] })).toThrow(/names firefox, which is no browser the gates run in/)
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: '' } })).toThrow(
      'FORMANCY_BROWSERS is set and names no browser: unset it for Chromium alone, or name the browsers (chromium, firefox, webkit), or all',
    )
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: ' , ' } })).toThrow(/names no browser/)
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'chromium,chromium' } })).toThrow('FORMANCY_BROWSERS names chromium twice')
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'all,chromium' }, browsers: two })).toThrow(
      'FORMANCY_BROWSERS names all beside a browser: all stands alone',
    )
  })

  // A gate handed no browser loops over nothing and exits green, having
  // measured nothing: a list of browsers without Chromium, with the
  // variable unset, would turn every local `pnpm test:browser` into that.
  test('refuses to leave a gate no browser to run in', () => {
    expect(() => gateBrowsers({ env: {}, browsers: ['firefox', 'webkit'] })).toThrow(
      'FORMANCY_BROWSERS is unset, which runs Chromium alone, and Chromium is no browser the gates run in: name one of firefox, webkit',
    )
    expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'all' }, browsers: [] })).toThrow('FORMANCY_BROWSERS=all names no browser: the gates run in none')
  })

  // Playwright's WebKit on macOS and Windows is another port of WebKit, with
  // another network stack, and 0058's WebKit facts -- the connection a POST
  // takes, whether a lost one is sent again -- were read and measured on
  // Linux's, so a WebKit run there would hold another browser to them.
  // Firefox's facts are Gecko's own code on every platform, and Chromium's
  // were measured on Linux too and run anywhere already.
  test('refuses WebKit off Linux, naming what runs there, and runs Firefox everywhere', () => {
    for (const platform of ['darwin', 'win32']) {
      expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'all' }, platform })).toThrow(
        `FORMANCY_BROWSERS names WebKit, which the gates run on Linux only: Playwright's WebKit on ${platform} is another port, with another network stack, and 0058's WebKit facts were measured on Linux. Here, FORMANCY_BROWSERS=chromium,firefox pnpm test:browser`,
      )
      expect(() => gateBrowsers({ env: { FORMANCY_BROWSERS: 'webkit' }, platform })).toThrow(/WebKit, which the gates run on Linux only/)
      expect(gateBrowsers({ env: { FORMANCY_BROWSERS: 'chromium,firefox' }, platform })).toEqual(['chromium', 'firefox'])
      expect(gateBrowsers({ env: {}, platform })).toEqual(['chromium'])
    }
    expect(gateBrowsers({ env: { FORMANCY_BROWSERS: 'all' }, platform: 'linux' })).toEqual(['chromium', 'firefox', 'webkit'])
  })
})

describe('FACTS', () => {
  // A fact the browsers disagree on is a row a gate holds every browser to:
  // a browser missing from its values is a browser whose check has nothing
  // to compare with, and one missing from its sources or its measurements
  // is a claim the report prints with nothing behind it.
  test('name every browser in every fact’s values, sources and measurements, and every connection where a fact is by connection', () => {
    for (const [id, fact] of Object.entries(FACTS)) {
      for (const field of ['values', 'source', 'measured']) expect(Object.keys(fact[field]).sort(), `${id}'s ${field}`).toEqual([...BROWSERS].sort())
      if (fact.connections === undefined) continue
      for (const field of ['values', 'measured']) {
        for (const browser of BROWSERS) expect(Object.keys(fact[field][browser]).sort(), `${id}'s ${field} of ${browser}`).toEqual([...fact.connections].sort())
      }
    }
    for (const [id, fact] of Object.entries(FACTS)) {
      for (const browser of BROWSERS) {
        expect(typeof fact.source[browser], `${id}'s source of ${browser}`).toBe('string')
        const measured = fact.connections === undefined ? [fact.measured[browser]] : fact.connections.map((connection) => fact.measured[browser][connection])
        for (const entry of measured) expect(entry.on === null ? typeof entry.why : typeof entry.by, `${id}'s measurement of ${browser}`).toBe('string')
      }
    }
  })

  // The row was read in AG Grid 36.2.0's code, and its regular expression
  // copied from there: an AG Grid the host pins at another release may test
  // the user agent another way, and the host gate would hold every browser
  // to a row nobody read for it. A bump cannot land until it is read again.
  test('read AG Grid at the release the host page pins', () => {
    const host = JSON.parse(readFileSync(join(repo, 'apps', 'host', 'package.json'), 'utf8'))
    const read = Object.entries(FACTS).filter(([, fact]) => fact.agGrid !== undefined)
    expect(read.map(([id]) => id)).toEqual(['claimsSafari', 'claimsMacOs'])
    for (const [id, fact] of read) expect(fact.agGrid, id).toBe(host.dependencies['ag-grid-community'])
  })

  // The report fails a run whose gate did not make a row's checks; a row
  // naming no check, or a gate that is not one, would hold nothing and
  // still read as held.
  test('name the checks that hold each row, in an app with a browser gate', () => {
    for (const [id, fact] of Object.entries(FACTS)) {
      const manifest = JSON.parse(readFileSync(join(repo, fact.heldBy.gate, 'package.json'), 'utf8'))
      expect(manifest.scripts['test:browser'], `${id}'s gate`).toBe('node scripts/browser-test.mjs')
      expect(fact.heldBy.checks.length, `${id}'s checks`).toBeGreaterThan(0)
      for (const name of fact.heldBy.checks) expect(typeof name, `${id}'s checks`).toBe('string')
    }
  })

  // The report says which of the runner's packages each WebKit fact rested
  // on in the run: a package a fact rests on that the gate never asks
  // dpkg about is a version the report cannot name.
  test('ask the system for every package a fact rests on', () => {
    for (const [id, fact] of Object.entries(FACTS)) {
      for (const [browser, packages] of Object.entries(fact.restsOn ?? {})) {
        for (const name of packages) expect(SYSTEM_PACKAGES[browser]?.map((entry) => entry.name) ?? [], `${id} rests on ${name} in ${browser}`).toContain(name)
      }
    }
  })
})

describe('installCommand', () => {
  // Firefox and WebKit take GTK, GStreamer and, for WebKit, libsoup from the
  // system, which a machine without a desktop lacks: on an Ubuntu 26.04.1
  // with none of them, Playwright's download said GTK's libraries were
  // missing. The command a failed launch names installs them with the
  // browser; Chromium's needs none, and `--with-deps` would run apt through
  // sudo for nothing.
  test('names `--with-deps` for Firefox and WebKit, and not for Chromium', () => {
    expect(installCommand('chromium')).toBe('pnpm --filter @formancy/data-examples exec playwright install chromium')
    expect(installCommand('firefox')).toBe('pnpm --filter @formancy/data-examples exec playwright install --with-deps firefox')
    expect(installCommand('webkit')).toBe('pnpm --filter @formancy/data-examples exec playwright install --with-deps webkit')
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

  // Playwright finds its browsers through PLAYWRIGHT_BROWSERS_PATH where they
  // are not in the user's cache, as in Playwright's own image, which sets it
  // to /ms-playwright. Strict mode dropped it, so `pnpm test:pictures` there
  // failed to launch Chromium while each app's script run directly passed.
  test('lets Playwright find its browsers: turbo.json passes PLAYWRIGHT_BROWSERS_PATH to test:browser and test:pictures', () => {
    const turbo = JSON.parse(readFileSync(join(repo, 'turbo.json'), 'utf8'))
    for (const task of ['test:browser', 'test:pictures']) expect(turbo.tasks[task].passThroughEnv ?? [], task).toContain('PLAYWRIGHT_BROWSERS_PATH')
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
    expect(ranIn(['firefox'], { env: { FORMANCY_BROWSERS: 'firefox' }, browsers: ['chromium', 'firefox'] })).toBe(
      'In Firefox, as FORMANCY_BROWSERS=firefox asks.',
    )
    // Off Linux, `all` is refused for WebKit: the line names what runs there.
    expect(ranIn(['chromium'], { env: {}, platform: 'darwin' })).toBe(
      'In Chromium: FORMANCY_BROWSERS is unset, which on a machine runs Chromium alone; FORMANCY_BROWSERS=chromium,firefox runs Chromium and Firefox, and WebKit runs on Linux only.',
    )
  })
})
