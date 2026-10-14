// The browsers the gates run in, how a gate is told which, and what the
// browsers disagree on (0058).
//
// One list, BROWSERS, read by every gate through recordedPerBrowser
// (release-report/gate-results.mjs), by collect.mjs for the files a leg
// leaves, and by tested-on.mjs for the build of each that Playwright pins,
// which the report holds every launched browser to: its version, and the
// build its launch options start (launchedBuild). The browser job of
// .github/workflows/gates.yml runs one leg per browser of it, and
// browsers.test.mjs fails when the two lists differ.
//
// FORMANCY_BROWSERS chooses for a run: unset, a gate runs Chromium alone --
// decided on 2026-10-13 for a machine's memory, since the host gate starts a
// PostgreSQL of its own for each browser -- `all` runs every browser of
// BROWSERS, and a comma list runs those. CI names each leg's browser. WebKit
// is refused off Linux: Playwright's WebKit there is another port, with
// another network stack, from the one 0058's facts were measured on. What
// keeps the variable from being a skip is the report, which fails a run in
// which an app's gate left no results in one of BROWSERS, and collect.mjs
// --local, which expects every one.
//
// FACTS is the table of what the browsers disagree on, 0026's "name every
// column fact the engines disagree on" applied to browsers: each row a value
// per browser, the source it was read in at the version that runs, how it
// was measured, and the system packages it rests on where the runner, not
// Playwright, supplies them. Each row is held by the checks its `heldBy`
// names, which its gate makes in every browser under one name, so a browser
// that changes turns its leg red by name rather than its check going
// missing; and the report fails a run in which that gate did not make one
// of them in a browser (release-report/problems.mjs), so a check taken out
// of a gate in every browser at once is missed too.
//
// It imports nothing: collect.mjs imports it, and collect runs in jobs that
// install nothing (workflows.test.mjs follows the imports).

/** Every browser the gates run in, by Playwright's name for it, in the order the legs and the report list them. */
export const BROWSERS = Object.freeze(['chromium', 'firefox', 'webkit'])

/** What a gate runs on a machine when FORMANCY_BROWSERS is unset. */
const UNSET = Object.freeze(['chromium'])

/** The variable a gate reads, and turbo.json passes to test:browser (browsers.test.mjs holds the two). */
export const VARIABLE = 'FORMANCY_BROWSERS'

/** Each browser as a reader knows it; a browser without one is shown by its own name. */
export const BROWSER_NAMES = Object.freeze({ chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' })

export const browserName = (browser) => BROWSER_NAMES[browser] ?? browser

/** `a`, `a and b`, `a, b and c`. */
export const prose = (items) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** The options every gate launches its browser with (recordedPerBrowser). */
export const LAUNCH_OPTIONS = Object.freeze({ headless: true })

/**
 * PWDEBUG in `env` as Playwright 1.63.0 finds it (getFromENV in its utils'
 * env.ts): the variable, or else npm's config of that name, which pnpm hands
 * a script from an .npmrc; null when none is set.
 */
export const pwdebugOf = (env) => env.PWDEBUG ?? env.npm_config_pwdebug ?? env.npm_package_config_pwdebug ?? null

/** PWDEBUG as Playwright 1.63.0 reads it (debugMode in its utils' debug.ts): anything but unset, empty, `console`, `0` or `false` opens the inspector. */
const inspects = (pwdebug) => pwdebug != null && !['', 'console', '0', 'false'].includes(pwdebug)

/**
 * Which build of Playwright's browsers.json a launch recorded as
 * `{ name, options, pwdebug }` started, and how it was launched, as
 * Playwright 1.63.0 decides it (getExecutableName in its server's
 * chromium.ts and browserType.ts, _validateLaunchOptions): an executable
 * named outright, or a channel, is none of the builds it pins; PWDEBUG
 * launches headed whatever the options say; and Chromium headless starts the
 * headless shell, headed the full browser, which Playwright pins at the same
 * version -- so the version alone does not tell them apart.
 */
export function launchedBuild({ name, options = {}, pwdebug = null }) {
  if (options.executablePath !== undefined) return { build: null, how: `from ${String(options.executablePath)}` }
  if (options.channel !== undefined) return { build: null, how: `on its ${String(options.channel)} channel` }
  const headed = options.headless === false ? 'headed' : inspects(pwdebug) ? `headed, as PWDEBUG=${String(pwdebug)} makes it` : null
  if (name === 'chromium') return headed === null ? { build: 'chromium-headless-shell', how: 'headless' } : { build: 'chromium', how: headed }
  return { build: name, how: headed ?? 'headless' }
}

/**
 * The build of Playwright's browsers.json that each browser of BROWSERS
 * starts with the gates' LAUNCH_OPTIONS: for Chromium headless the headless
 * shell, not the full Chromium the `chromium` entry names. Derived, so the
 * pin the report holds a browser to is the build its gates launch.
 */
export const PINNED_AS = Object.freeze(Object.fromEntries(BROWSERS.map((browser) => [browser, launchedBuild({ name: browser, options: LAUNCH_OPTIONS }).build])))

/** The platforms each browser's gates run on; one not named runs on any. */
const ONLY_ON = Object.freeze({ webkit: 'linux' })

/**
 * The browsers a gate runs in, from FORMANCY_BROWSERS in `env`, on
 * `platform`. Throws, with the sentence a person acts on, for a browser not
 * in `browsers`, an empty list, a repeat, `all` beside a name, a choice that
 * leaves no browser -- a gate run in none measures nothing and passes -- and
 * WebKit off Linux, naming the browsers that run there.
 */
export function gateBrowsers({ env = process.env, browsers = BROWSERS, platform = process.platform } = {}) {
  const value = env[VARIABLE]
  if (value === undefined) {
    const chosen = UNSET.filter((browser) => browsers.includes(browser))
    if (chosen.length === 0) throw new Error(`${VARIABLE} is unset, which runs ${prose(UNSET.map(browserName))} alone, and ${prose(UNSET.map(browserName))} is no browser the gates run in: name one of ${browsers.join(', ')}`)
    return onThisPlatform(chosen, browsers, platform)
  }
  const named = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (named.length === 0) throw new Error(`${VARIABLE} is set and names no browser: unset it for Chromium alone, or name the browsers (${browsers.join(', ')}), or all`)
  if (named.includes('all')) {
    if (named.length > 1) throw new Error(`${VARIABLE} names all beside a browser: all stands alone`)
    if (browsers.length === 0) throw new Error(`${VARIABLE}=all names no browser: the gates run in none`)
    return onThisPlatform([...browsers], browsers, platform)
  }
  for (const [at, browser] of named.entries()) {
    if (!browsers.includes(browser)) throw new Error(`${VARIABLE} names ${browser}, which is no browser the gates run in: ${browsers.join(', ')}`)
    if (named.indexOf(browser) !== at) throw new Error(`${VARIABLE} names ${browser} twice`)
  }
  return onThisPlatform(named, browsers, platform)
}

/** `chosen`, or a refusal naming the first that does not run on `platform` and the command that runs the rest there. */
function onThisPlatform(chosen, browsers, platform) {
  const refused = chosen.find((browser) => ONLY_ON[browser] !== undefined && ONLY_ON[browser] !== platform)
  if (refused === undefined) return chosen
  const here = browsers.filter((browser) => ONLY_ON[browser] === undefined || ONLY_ON[browser] === platform)
  throw new Error(
    `${VARIABLE} names ${browserName(refused)}, which the gates run on Linux only: Playwright's ${browserName(refused)} on ${platform} is another port, with another network stack, and 0058's ${browserName(refused)} facts were measured on Linux. Here, ${VARIABLE}=${here.join(',')} pnpm test:browser`,
  )
}

/** The line a gate prints first: which browsers it measures in, and, with the variable unset, how to run every one this platform runs. */
export function ranIn(chosen, { env = process.env, browsers = BROWSERS, platform = process.platform } = {}) {
  const names = prose(chosen.map(browserName))
  if (env[VARIABLE] !== undefined) return `In ${names}, as ${VARIABLE}=${env[VARIABLE]} asks.`
  const here = browsers.filter((browser) => ONLY_ON[browser] === undefined || ONLY_ON[browser] === platform)
  const elsewhere = browsers.filter((browser) => !here.includes(browser))
  if (elsewhere.length === 0) return `In ${names}: ${VARIABLE} is unset, which on a machine runs Chromium alone; ${VARIABLE}=all runs ${prose(browsers.map(browserName))}, as CI does.`
  return `In ${names}: ${VARIABLE} is unset, which on a machine runs Chromium alone; ${VARIABLE}=${here.join(',')} runs ${prose(here.map(browserName))}, and ${prose(elsewhere.map(browserName))} runs on Linux only.`
}

/**
 * The command that downloads `browser` for the gates, from anywhere in the
 * workspace: what a failed launch names. Firefox and WebKit take GTK,
 * GStreamer and, for WebKit, libsoup from the system, which a machine
 * without a desktop lacks: on 2026-10-13, on an Ubuntu 26.04.1 with none of
 * them, Playwright's download of the two said the host was missing GTK's
 * libraries, and `install-deps firefox webkit` installed 262 packages
 * through sudo.
 */
export const installCommand = (browser) => `pnpm --filter @formancy/data-examples exec playwright install ${browser === 'chromium' ? '' : '--with-deps '}${browser}`

/**
 * The system packages, by Debian name, that a browser's gates take from the
 * runner rather than from Playwright's download, each with what it gives the
 * browser: every package a fact below rests on, and WebKit's TLS and EGL,
 * which decide whether it reaches the web fonts and draws at all. The gate
 * records each one's version through dpkg-query (scripts/browser-gate.mjs's
 * systemOf), and the report names them.
 */
export const SYSTEM_PACKAGES = Object.freeze({
  webkit: Object.freeze([
    { name: 'libsoup-3.0-0', gives: 'networking' },
    { name: 'glib-networking', gives: 'TLS' },
    { name: 'libegl-mesa0', gives: 'EGL' },
  ]),
})

/** A measurement no run has made: why the row stands on its source alone. */
const unmeasured = (why) => Object.freeze({ on: null, why })

/** The committed gates' run on a machine, FORMANCY_BROWSERS=all, one browser at a time: what a row was measured by until CI's runs replace it. */
const SANDBOX = Object.freeze({
  on: '2026-10-13',
  by: 'the committed gates, FORMANCY_BROWSERS=all, one browser at a time, on a Docker Sandbox VM: Ubuntu 26.04.1, x86_64, 20 CPUs, Node v22.22.1, Playwright 1.63.0, libsoup-3.0-0 3.6.6-1ubuntu0.1',
})

/** Nothing in the browser's code was read for this row: it is what the gates measured. */
const NOT_READ = 'nothing read in its code: the row is what the gates measured'

/**
 * What the browsers disagree on, each row held by the checks `heldBy` names,
 * which its gate makes in every browser under one name (0058). `values` is
 * each browser's answer -- for a row that is `by connection`, one per
 * connection a POST can take -- `source` where it was read, at the revision
 * Playwright 1.63.0 builds the browser from or the release of the library
 * that decides it, and `measured` how the gates measured it: `{ on, by }`,
 * or `{ on: null, why }` for a row that stands on its source alone.
 * `restsOn` names the system packages of SYSTEM_PACKAGES a browser's answer
 * depends on.
 */
export const FACTS = Object.freeze({
  clickThenTab: Object.freeze({
    says: 'after a click on the page’s corner, the first Tab reaches the page’s first tab stop, an off-screen skip link',
    heldBy: Object.freeze({ gate: 'apps/studio', checks: Object.freeze(['a click on the workbench’s corner, then Tab: as 0058’s table says of this browser']) }),
    values: Object.freeze({ chromium: true, firefox: false, webkit: true }),
    source: Object.freeze({
      chromium: `${NOT_READ}; Chromium starts sequential navigation from the node clicked`,
      firefox: `${NOT_READ}; Firefox starts it from the caret the click leaves, which is past a skip link drawn off-screen until it is focused`,
      webkit: NOT_READ,
    }),
    measured: Object.freeze({ chromium: SANDBOX, firefox: SANDBOX, webkit: SANDBOX }),
  }),
  postConnection: Object.freeze({
    says: 'the connection a browser sends a POST on: an idle kept-alive one where there is one (`idle`), or always a new one (`fresh`)',
    heldBy: Object.freeze({ gate: 'apps/host', checks: Object.freeze(['the lost create went out on the connection 0058’s table says of this browser']) }),
    values: Object.freeze({ chromium: 'idle', firefox: 'idle', webkit: 'fresh' }),
    source: Object.freeze({
      chromium: NOT_READ,
      firefox: NOT_READ,
      webkit:
        'WebKit 4d05d73 (Playwright 1.63.0’s base), Source/WebKit/NetworkProcess/soup/NetworkDataTaskSoup.cpp:166-173, flags a message NO_REDIRECT, COLLECT_METRICS and sometimes DO_NOT_USE_AUTH_CACHE, never IDEMPOTENT; libsoup 3.4.4 and 3.6.6, libsoup/soup-connection-manager.c:407-411, give a message neither flagged idempotent nor of an idempotent method a new connection',
    }),
    measured: Object.freeze({ chromium: SANDBOX, firefox: SANDBOX, webkit: SANDBOX }),
    restsOn: Object.freeze({ webkit: Object.freeze(['libsoup-3.0-0']) }),
  }),
  resendsLostPost: Object.freeze({
    says: 'a browser sends a POST again on its own when, over HTTP/1.1, the connection closes after the server read it and before any byte of an answer',
    heldBy: Object.freeze({
      gate: 'apps/host',
      checks: Object.freeze(['the browser sent the lost create as often as 0058’s table says for that connection', 'the run measured 0058’s row for the connection this browser takes when it can choose']),
    }),
    connections: Object.freeze(['reused', 'fresh']),
    values: Object.freeze({
      chromium: Object.freeze({ reused: true, fresh: false }),
      firefox: Object.freeze({ reused: true, fresh: false }),
      webkit: Object.freeze({ reused: false, fresh: false }),
    }),
    source: Object.freeze({
      chromium: `${NOT_READ}, and 0031's P7 (2026-10-09): a GET then a POST on one kept-alive connection was seen twice, and with Connection: close on every answer, once`,
      firefox:
        'Firefox d065a04 (Playwright 1.63.0’s base), netwerk/protocol/http/nsHttpTransaction.cpp:1546-1553 and 1594-1595: Close restarts a transaction on NS_ERROR_NET_RESET or NS_OK when it received nothing and its method is safe, it sent nothing, or its connection was reused',
      webkit:
        'libsoup 3.4.4 and 3.6.6, libsoup/http1/soup-client-message-io-http1.c:693-711: a request is restarted only when its connection was used before and its method is idempotent (soup-misc.h:59-65: GET, HEAD, OPTIONS, PROPFIND, TRACE, PUT, DELETE); a POST is neither, and is sent on a new connection (postConnection)',
    }),
    measured: Object.freeze({
      chromium: Object.freeze({ reused: SANDBOX, fresh: Object.freeze({ on: '2026-10-09', by: '0031’s P7, a page’s fetch through a server answering Connection: close, in Playwright’s Chromium' }) }),
      firefox: Object.freeze({ reused: SANDBOX, fresh: unmeasured('by source; no run has reached it: the host page’s create travels on a connection its earlier requests used') }),
      webkit: Object.freeze({ reused: unmeasured('by source; no run can reach it: WebKit sends no POST on a reused connection (postConnection)'), fresh: SANDBOX }),
    }),
    restsOn: Object.freeze({ webkit: Object.freeze(['libsoup-3.0-0']) }),
  }),
  claimsSafari: Object.freeze({
    says: 'AG Grid’s `_isBrowserSafari()` is true, so the host page’s grids take AG Grid’s Safari code paths',
    heldBy: Object.freeze({ gate: 'apps/host', checks: Object.freeze(['the browser names itself to AG Grid as 0058’s table says']) }),
    agGrid: '36.2.0',
    /** ag-stack 36.2.0's test, copied: dist/package/main.esm.mjs:2652-2657, on navigator.userAgent. */
    pattern: Object.freeze({ source: '^((?!chrome|android).)*safari', flags: 'i' }),
    values: Object.freeze({ chromium: false, firefox: false, webkit: true }),
    source: Object.freeze({
      chromium: 'ag-stack 36.2.0, dist/package/main.esm.mjs:2652-2675, tests navigator.userAgent; Chromium’s names Chrome',
      firefox: 'ag-stack 36.2.0, dist/package/main.esm.mjs:2652-2675; Firefox’s names Firefox, which turns on ag-grid-community 36.2.0’s Firefox branches (dist/package/main.esm.mjs:41450, 51417, 52925)',
      webkit:
        'ag-stack 36.2.0, dist/package/main.esm.mjs:2652-2675; Playwright’s Linux WebKit names itself Safari on a Mac, which turns on ag-grid-community 36.2.0’s Safari branches (dist/package/main.esm.mjs:29439 and 31565, forced browser focus, and 41380, 41565, 42263, 43272, 53390); its platform is claimsMacOs’s',
    }),
    measured: Object.freeze({ chromium: SANDBOX, firefox: SANDBOX, webkit: SANDBOX }),
  }),
  claimsMacOs: Object.freeze({
    says: 'AG Grid’s `_isMacOsUserAgent()` or `_isIOSUserAgent()` is true, so the host page’s grids take AG Grid’s macOS or iOS code paths',
    heldBy: Object.freeze({ gate: 'apps/host', checks: Object.freeze(['the browser names its platform to AG Grid as 0058’s table says']) }),
    agGrid: '36.2.0',
    /**
     * ag-stack 36.2.0's tests, copied: dist/package/main.esm.mjs:2664-2675,
     * on navigator.platform -- macOS by the first, iOS by the second or by
     * MacIntel with more than one touch point, an iPad asking for the
     * desktop site.
     */
    tests: Object.freeze({
      macOs: Object.freeze({ source: '(Mac|iPhone|iPod|iPad)', flags: 'i' }),
      iOS: Object.freeze({ source: 'iPad|iPhone|iPod', flags: '' }),
      iPadAsMac: Object.freeze({ platform: 'MacIntel', moreTouchPointsThan: 1 }),
    }),
    values: Object.freeze({ chromium: false, firefox: false, webkit: false }),
    source: Object.freeze({
      chromium: 'ag-stack 36.2.0, dist/package/main.esm.mjs:2664-2675, tests navigator.platform and navigator.maxTouchPoints; Chromium’s on Linux names Linux',
      firefox: 'ag-stack 36.2.0, dist/package/main.esm.mjs:2664-2675; Firefox’s on Linux names Linux',
      webkit:
        'ag-stack 36.2.0, dist/package/main.esm.mjs:2664-2675; Playwright’s Linux WebKit names a Mac in its user agent and Linux in navigator.platform, with no touch points, so ag-grid-community 36.2.0’s macOS and iOS branches (dist/package/main.esm.mjs:9084 ag-apple-scrollbar, 9630, 29527, 29549, 29614, 29975, 47865) stay off',
    }),
    measured: Object.freeze({ chromium: SANDBOX, firefox: SANDBOX, webkit: SANDBOX }),
  }),
})
