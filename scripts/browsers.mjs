// The browsers the gates run in, and how a gate is told which.
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
// BROWSERS, and a comma list runs those. CI names each leg's browser. What
// keeps the variable from being a skip is the report, which fails a run in
// which an app's gate left no results in one of BROWSERS, and collect.mjs
// --local, which expects every one.
//
// It imports nothing: collect.mjs imports it, and collect runs in jobs that
// install nothing (workflows.test.mjs follows the imports).

/** Every browser the gates run in, by Playwright's name for it, in the order the legs and the report list them. */
export const BROWSERS = Object.freeze(['chromium'])

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

/**
 * The browsers a gate runs in, from FORMANCY_BROWSERS in `env`. Throws, with
 * the sentence a person acts on, for a browser not in `browsers`, an empty
 * list, a repeat, `all` beside a name, and a choice that leaves no browser:
 * a gate run in none measures nothing and passes.
 */
export function gateBrowsers({ env = process.env, browsers = BROWSERS } = {}) {
  const value = env[VARIABLE]
  if (value === undefined) {
    const chosen = UNSET.filter((browser) => browsers.includes(browser))
    if (chosen.length === 0) throw new Error(`${VARIABLE} is unset, which runs ${prose(UNSET.map(browserName))} alone, and ${prose(UNSET.map(browserName))} is no browser the gates run in: name one of ${browsers.join(', ')}`)
    return chosen
  }
  const named = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (named.length === 0) throw new Error(`${VARIABLE} is set and names no browser: unset it for Chromium alone, or name the browsers (${browsers.join(', ')}), or all`)
  if (named.includes('all')) {
    if (named.length > 1) throw new Error(`${VARIABLE} names all beside a browser: all stands alone`)
    if (browsers.length === 0) throw new Error(`${VARIABLE}=all names no browser: the gates run in none`)
    return [...browsers]
  }
  for (const [at, browser] of named.entries()) {
    if (!browsers.includes(browser)) throw new Error(`${VARIABLE} names ${browser}, which is no browser the gates run in: ${browsers.join(', ')}`)
    if (named.indexOf(browser) !== at) throw new Error(`${VARIABLE} names ${browser} twice`)
  }
  return named
}

/** The line a gate prints first: which browsers it measures in, and, with the variable unset, how to run every one. */
export function ranIn(chosen, { env = process.env, browsers = BROWSERS } = {}) {
  const names = prose(chosen.map(browserName))
  if (env[VARIABLE] !== undefined) return `In ${names}, as ${VARIABLE}=${env[VARIABLE]} asks.`
  return `In ${names}: ${VARIABLE} is unset, which on a machine runs Chromium alone; ${VARIABLE}=all runs ${prose(browsers.map(browserName))}, as CI does.`
}

/** The command that downloads `browser` for the gates, from anywhere in the workspace: what a failed launch names. */
export const installCommand = (browser) => `pnpm --filter @formancy/data-examples exec playwright install ${browser}`
