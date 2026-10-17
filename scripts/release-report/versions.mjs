// The report's "Tested on" (0035): what this run's servers, Node and browsers
// said about themselves, beside what the checkout says it is tested on.
//
// Pure over the run's results and testedOn()'s facts. Every image of the
// engine's matrix (MATRIX_IMAGES, 0067) is listed under it, the default
// first, whether or not it answered, and after them every other image any
// job started, with each distinct answer its servers gave -- version, update
// level, edition, digest -- who started it, and the suites that ran on it.
// The matrix is what the release is tested on; an image outside it that one
// file names is what that file showed (0067 narrows 0003), and is never
// called a probe. An image of the matrix off the default is answered by its
// own legs alone -- a test-images leg whose variant it is -- and a file that
// names it in another leg, as discovery-pg18 names 18 in every PostgreSQL
// leg, is said apart, as what that file ran.

const distinct = (values) => [...new Set(values)]
const byJson = (values) => [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]

/**
 * Every server record of the run, with the results file's key as its job
 * and, for a leg of the test-images job, the image that leg ran on.
 */
export function serversOf(results) {
  return results.flatMap((result) => (result.servers ?? []).map((server) => ({ ...server, job: result.key, leg: result.job === 'test-images' ? (result.variant ?? null) : null })))
}

/** Whether a record is the getting-started journey's composed database rather than a container a test or a gate started. */
export const composed = (server) => server.script === 'getting-started'

/** The files that asked for `records`' servers, once each. */
const callersOf = (records) => distinct(records.map((server) => server.caller).filter((caller) => caller !== null)).sort()
/** What `records`' servers answered, once each. */
const answersOf = (records) => byJson(records.map(({ version, updateLevel, edition }) => ({ version, updateLevel, edition })))

/**
 * An engine's images, its matrix first, the default leading, each with its
 * answers, its starters, the files that asked for it and the packages whose
 * suites ran on it -- for an image of the matrix off the default, from its
 * own legs, with what other legs' files ran on it `aside`.
 */
function enginesInRun(servers, facts) {
  return facts.engines.map((engine) => {
    const own = servers.filter((server) => server.engine === engine)
    const matrix = facts.matrix[engine]
    if (!Array.isArray(matrix) || matrix[0] !== facts.images[engine]) throw new Error(`testedOn() gives ${engine} no matrix led by its default image`)
    const images = distinct([facts.images[engine], ...matrix, ...own.map((server) => server.image).sort()])
      .map((image) => {
        const on = own.filter((server) => server.image === image)
        const started = on.filter((server) => !composed(server))
        const legged = matrix.includes(image) && image !== facts.images[engine]
        const tested = legged ? started.filter((server) => server.leg === image) : started
        const aside = started.filter((server) => !tested.includes(server))
        return {
          image,
          default: image === facts.images[engine],
          matrix: matrix.includes(image),
          answers: byJson(on.map(({ version, updateLevel, edition, digest }) => ({ version, updateLevel, edition, digest: digest ?? null }))),
          startedBy: byJson(on.map(({ package: pkg, job }) => ({ package: pkg ?? null, job }))),
          callers: callersOf(tested),
          // A suite's records carry its package's npm name; a browser gate's, the app's path.
          suites: distinct(tested.map((server) => server.package).filter((name) => typeof name === 'string' && name.startsWith('@'))).sort(),
          tested: answersOf(tested),
          aside: { callers: callersOf(aside), tested: answersOf(aside) },
          composed: byJson(on.filter(composed).map(({ version, job }) => ({ version, job }))),
        }
      })
      .filter((entry) => entry.matrix || entry.answers.length > 0)
    return { engine, defaultImage: facts.images[engine], images }
  })
}

/** The version a clean install resolved for `entry`, or null when the install gate did not report it. */
function freshFor(install, entry) {
  const found = (install?.resolved ?? []).find((resolved) => resolved.name === entry.name && (resolved.under ?? null) === (entry.under ?? null))
  return found?.version ?? null
}

/** The run's Tested on: engines and images, dependencies range -> loaded -> fresh, Node, browsers, axe, tools and snapshots. */
export function testedOnInRun({ results, facts }) {
  const servers = serversOf(results)
  const install = results.map((result) => result.install).find((entry) => entry != null) ?? null
  const container = results.map((result) => result.container).find((entry) => entry != null) ?? null
  const gates = results.flatMap((result) => result.browserGates ?? [])
  const engines = enginesInRun(servers, facts)
  return {
    engines,
    runtime: facts.runtime.map((entry) => ({ ...entry, fresh: freshFor(install, entry) })),
    upstream: facts.upstream.map((entry) => ({ ...entry, fresh: freshFor(install, entry) })),
    installedAt: install?.startedAt ?? null,
    node: {
      ...facts.node,
      ran: distinct(results.map((result) => result.runner?.node).filter((node) => node != null)).sort(),
      image: container?.node ?? null,
    },
    runners: byJson(results.map((result) => ({ image: result.runner?.image ?? null, imageVersion: result.runner?.imageVersion ?? null, docker: result.runner?.docker ?? null }))),
    browsers: byJson(gates.filter((gate) => gate.browser != null).map((gate) => ({ name: gate.browser.name, version: gate.browser.version }))).map((browser) => ({
      ...browser,
      // Null for a browser no gate here runs, which problems.mjs fails.
      pin: facts.browser.pins.find((pin) => pin.browser === browser.name)?.browserVersion ?? null,
      gates: gates.filter((gate) => gate.browser?.name === browser.name && gate.browser?.version === browser.version).map((gate) => gate.gate),
    })),
    playwright: facts.browser,
    axe: distinct(gates.map((gate) => gate.axe).filter((version) => version != null)),
    tooling: facts.tooling,
    snapshots: facts.snapshots.map((snapshot) => ({
      ...snapshot,
      answered: distinct(
        (engines.find((entry) => entry.engine === snapshot.kind)?.images.find((image) => image.default)?.tested ?? []).map((answer) => answer.version),
      ),
    })),
  }
}
