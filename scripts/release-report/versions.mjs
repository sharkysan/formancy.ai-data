// The report's "Tested on" (0035): what this run's servers, Node and browser
// said about themselves, beside what the checkout says it is tested on.
//
// Pure over the run's results and testedOn()'s facts. Every image any job
// started is listed under its engine, the default first, with each distinct
// answer its servers gave -- version, update level, edition, digest -- and who
// started it. Under 0003 an image a test starts is part of what is tested,
// for that test, so no image is called a probe: this is 0003's matrix,
// computed per run.

const distinct = (values) => [...new Set(values)]
const byJson = (values) => [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]

/** Every server record of the run, with the results file's key as its job. */
export function serversOf(results) {
  return results.flatMap((result) => (result.servers ?? []).map((server) => ({ ...server, job: result.key })))
}

/** Whether a record is the getting-started journey's composed database rather than a container a test or a gate started. */
export const composed = (server) => server.script === 'getting-started'

/** An engine's images, the default first, each with its answers, its starters and the files that asked for it. */
function enginesInRun(servers, facts) {
  return facts.engines.map((engine) => {
    const own = servers.filter((server) => server.engine === engine)
    const images = distinct([facts.images[engine], ...own.map((server) => server.image).sort()])
      .map((image) => {
        const on = own.filter((server) => server.image === image)
        const tested = on.filter((server) => !composed(server))
        return {
          image,
          default: image === facts.images[engine],
          answers: byJson(on.map(({ version, updateLevel, edition, digest }) => ({ version, updateLevel, edition, digest: digest ?? null }))),
          startedBy: byJson(on.map(({ package: pkg, job }) => ({ package: pkg ?? null, job }))),
          callers: distinct(tested.map((server) => server.caller).filter((caller) => caller !== null)).sort(),
          tested: byJson(tested.map(({ version, updateLevel, edition }) => ({ version, updateLevel, edition }))),
          composed: byJson(on.filter(composed).map(({ version, job }) => ({ version, job }))),
        }
      })
      .filter((entry) => entry.default || entry.answers.length > 0)
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
      pin: browser.name === 'chromium' ? facts.browser.chromium.browserVersion : null,
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
