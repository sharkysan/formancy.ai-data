// The report's two matrices (0035).
//
// Shared cases on both engines: one row per id `sharedCases()` gives, one cell
// per engine of DATABASE_KINDS -- `passed`, `failed` or `missing` -- from the
// tests that declared the case with `covers()` on that engine. A case that
// passes through one adapter only is `missing` on the other, which fails the
// run: release gate 1, "both adapters pass the same mandatory behaviour
// suite", as a check on every pull request. What it cannot show is that a
// test which declares a case asserts it; review holds that.
//
// The browser matrix as it is: each environment a suite or gate ran in --
// jsdom, and each browser a gate launched -- per app, with the renderers the
// app draws and the engines its run started. Nothing in it is typed: a
// browser added to a gate later shows up here without a change to this file.

const distinct = (values) => [...new Set(values)]

/** Every test of the run that declares shared cases: its file, name, status, engine and cases. */
export function declarations(results) {
  return results.flatMap((result) =>
    (result.suites ?? []).flatMap((suite) =>
      suite.files.flatMap((file) =>
        file.tests
          .filter((test) => Array.isArray(test.meta?.covers) && test.meta.covers.length > 0)
          .map((test) => ({ file: file.file, name: test.name, status: test.status, engine: test.meta.engine ?? null, covers: test.meta.covers })),
      ),
    ),
  )
}

/** The matrix, and the declarations that name no shared case or no engine. */
export function sharedCaseMatrix({ results, cases, engines }) {
  const declared = declarations(results)
  const known = new Set(cases)
  return {
    rows: cases.map((id) => ({
      id,
      cells: Object.fromEntries(
        engines.map((engine) => {
          const tests = declared.filter((test) => test.engine === engine && test.covers.includes(id))
          return [engine, { state: tests.length === 0 ? 'missing' : tests.every((test) => test.status === 'passed') ? 'passed' : 'failed', tests: tests.length }]
        }),
      ),
    })),
    unknown: declared.flatMap((test) => test.covers.filter((id) => !known.has(id)).map((id) => ({ file: test.file, name: test.name, id }))),
    withoutEngine: declared.filter((test) => !engines.includes(test.engine)).map(({ file, name, engine }) => ({ file, name, engine })),
  }
}

/**
 * Environment x app x renderers x engines. `apps` is each workspace app with
 * the renderers it draws (`[{ name: 'React', version }]`) and the jsdom its
 * suite loads; the engines are the ones its suite's or its gate's servers
 * ran, so an app that renders from a captured snapshot shows none.
 */
export function browserMatrix({ results, apps }) {
  const servers = results.flatMap((result) => result.servers ?? [])
  const engines = (owner) => distinct(servers.filter((server) => server.package === owner).map((server) => server.engine)).sort()
  const suites = new Set(results.flatMap((result) => (result.suites ?? []).map((suite) => suite.package)))
  const rows = []
  for (const app of apps) {
    if (suites.has(app.name)) rows.push({ environment: `jsdom ${app.jsdom ?? '?'}`, app: app.path, renderers: app.renderers, engines: engines(app.name), source: 'suite' })
  }
  for (const result of results) {
    for (const gate of result.browserGates ?? []) {
      const app = apps.find((candidate) => candidate.path === gate.gate)
      const browser = gate.browser === null || gate.browser === undefined ? 'no browser launched' : `${gate.browser.name} ${gate.browser.version}`
      rows.push({ environment: browser, app: gate.gate, renderers: app?.renderers ?? [], engines: engines(gate.gate), source: 'gate' })
    }
  }
  return rows
}
